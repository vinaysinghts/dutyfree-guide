-- In-app problem reports ("Report a problem" in the app). See ADR 0010.
--
-- The table is an outbox: the app inserts a row (the durable record), then
-- asks the file-issue Edge Function to turn it into a GitHub issue. If GitHub
-- or the function is down, the row stays 'pending' and the hourly sync job
-- files it later. The GitHub token lives only in the function's secrets.

create table public.issue_reports (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  reporter            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category            text not null default 'bug'
                        check (category in ('bug', 'wrong_price', 'idea', 'other')),
  description         text not null check (length(btrim(description)) between 3 and 4000),
  -- Object names in the issue-screenshots bucket, each under the reporter's folder.
  screenshot_paths    text[] not null default '{}' check (cardinality(screenshot_paths) <= 4),
  -- Device, app version, screen, recent errors. Shown in the issue for debugging.
  context             jsonb not null default '{}' check (pg_column_size(context) <= 16384),

  -- Owned by the Edge Function (service role). Whatever a client sends is overwritten on insert.
  status              text not null default 'pending'
                        check (status in ('pending', 'filing', 'filed', 'failed')),
  attempts            int not null default 0,
  claimed_at          timestamptz,
  last_error          text,
  github_issue_number int,
  github_issue_url    text,
  filed_at            timestamptz
);

create index issue_reports_unfiled on public.issue_reports (created_at) where status <> 'filed';
create index issue_reports_reporter_recent on public.issue_reports (reporter, created_at desc);

-- Every screenshot must sit in the reporter's own folder: "<uid>/...".
create or replace function public.issue_reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recent int;
begin
  new.reporter            := coalesce(auth.uid(), new.reporter);
  new.status              := 'pending';
  new.attempts            := 0;
  new.claimed_at          := null;
  new.last_error          := null;
  new.github_issue_number := null;
  new.github_issue_url    := null;
  new.filed_at            := null;
  new.created_at          := now();

  if exists (select 1 from unnest(new.screenshot_paths) p
             where split_part(p, '/', 1) <> new.reporter::text) then
    raise exception 'screenshots must be in your own folder';
  end if;

  -- Rate limit: each report becomes a public GitHub issue, so cap spam per user.
  select count(*) into recent from public.issue_reports
   where reporter = new.reporter and created_at > now() - interval '1 hour';
  if recent >= 5 then
    raise exception 'too many reports in the last hour, please try again later'
      using errcode = 'P0429';
  end if;
  return new;
end;
$$;

create trigger issue_reports_before_insert
  before insert on public.issue_reports
  for each row execute function public.issue_reports_before_insert();

alter table public.issue_reports enable row level security;

create policy "insert own issue reports" on public.issue_reports for insert to authenticated
  with check (reporter = auth.uid());
create policy "read own issue reports" on public.issue_reports for select to authenticated
  using (reporter = auth.uid() or public.is_admin());
-- No update/delete policy: only the service role (the Edge Function) changes rows.

-- Lease a report for filing. Returns the row only if this caller won it, so the
-- app's call and the hourly sync can't both create a GitHub issue for the same
-- report. A 'filing' lease older than 5 minutes is treated as a crashed attempt.
create or replace function public.claim_issue_report(p_id bigint)
returns setof public.issue_reports
language sql security definer set search_path = public as $$
  update public.issue_reports
     set status = 'filing', attempts = attempts + 1, claimed_at = now()
   where id = p_id
     and attempts < 5
     and (status in ('pending', 'failed')
          or (status = 'filing' and claimed_at < now() - interval '5 minutes'))
  returning *;
$$;

-- Only the Edge Function (service role) may claim.
revoke execute on function public.claim_issue_report(bigint) from public;
do $$ begin
  grant execute on function public.claim_issue_report(bigint) to service_role;
exception when undefined_object then null; end $$;

-- Screenshots: private bucket, one folder per user. The Edge Function signs
-- long-lived read URLs for the GitHub issue.
insert into storage.buckets (id, name, public) values ('issue-screenshots', 'issue-screenshots', false)
on conflict (id) do nothing;

create policy "upload own issue screenshots" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own issue screenshots or admin" on storage.objects for select to authenticated
  using (bucket_id = 'issue-screenshots'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
