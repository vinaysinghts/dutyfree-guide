-- Security audit fixes (docs/security.md, problems log #20).
--
-- The app talks to Postgres through Supabase's Data API (PostgREST) with a public
-- key, so every table, view and function in `public` is reachable by anyone who
-- unpacks the APK. Row Level Security is the boundary for tables; for functions the
-- boundary is the EXECUTE privilege, and that is where the hole was.

-- 1. claim_issue_report was callable by anyone ---------------------------------
--
-- 20261110010000 ran `revoke execute ... from public`, which looks like "nobody but
-- service_role". But Supabase's default privileges also grant EXECUTE on every new
-- function in `public` *directly* to `anon` and `authenticated`, and revoking from
-- PUBLIC doesn't touch those direct grants. The function is SECURITY DEFINER (it
-- bypasses RLS), so any visitor could POST /rest/v1/rpc/claim_issue_report and
--   * read any user's problem report (description, device context, reporter id),
--   * lease it as 'filing' and burn its 5 attempts, so it never reaches GitHub.
revoke execute on function public.claim_issue_report(bigint) from public, anon, authenticated;

-- Trigger functions are never called directly (Postgres refuses), and triggers
-- don't check EXECUTE when they fire. Revoking keeps them out of the API surface
-- and out of the audit query in supabase/tests/60_access_control.sql.
revoke execute on function public.issue_reports_before_insert() from public, anon, authenticated;
revoke execute on function public.price_submissions_check_location() from public, anon, authenticated;

-- Reviewing needs a signed-in admin; signed-out visitors have no reason to call it.
-- (The function also checks is_admin() itself, so this is belt and braces.)
revoke execute on function public.review_submission(bigint, boolean, text, bigint) from public, anon;

-- 2. Price reports: server-owned fields, own-folder photo, sane dates, rate limit --
--
-- The insert policy checked `submitted_by = auth.uid() and status = 'pending'`, but
-- a client could still send reviewed_by / reviewed_at / review_note / created_at,
-- point photo_path at someone else's photo, or date a price in 2099 so that once
-- approved it would stay "latest" forever. Nothing capped how many reports one
-- session could send. Same pattern as issue_reports_before_insert.
create or replace function public.price_submissions_before_insert()
returns trigger
language plpgsql
-- SECURITY INVOKER on purpose: current_user is then the API role, and the rate-limit
-- count runs under RLS ("read own"), which is exactly the user's own rows.
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  recent int;
begin
  -- Only end-user requests are policed. The service role (scrapers, Edge Functions),
  -- migrations and SQL tests run as other roles and are trusted.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  new.submitted_by := uid;
  new.status       := 'pending';
  new.reviewed_by  := null;
  new.reviewed_at  := null;
  new.review_note  := null;
  new.created_at   := now();

  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> uid::text then
    raise exception 'the photo must be in your own folder' using errcode = '42501';
  end if;

  -- A day of slack either side covers time zones (the traveller's "today" can be
  -- tomorrow in UTC). A year back is generous for "I saw this on my last trip".
  if new.observed_on > current_date + 1 or new.observed_on < current_date - 366 then
    raise exception 'observed_on must be within the last year' using errcode = '23514';
  end if;
  if new.photo_taken_at > now() + interval '1 day' then
    raise exception 'photo_taken_at is in the future' using errcode = '23514';
  end if;

  -- 30 an hour is far above a real shopper photographing shelf tags, and caps a
  -- script per session. Anonymous sign-ins are themselves capped per IP by Supabase
  -- Auth, so the per-IP ceiling is (sign-ins/hour) x 30. See docs/security.md §6.
  select count(*) into recent from public.price_submissions
   where submitted_by = uid and created_at > now() - interval '1 hour';
  if recent >= 30 then
    raise exception 'too many price reports in the last hour, please try again later'
      using errcode = 'P0429';
  end if;
  return new;
end;
$$;

revoke execute on function public.price_submissions_before_insert() from public, anon, authenticated;

-- Fires before price_submissions_check_location (triggers run in name order).
create trigger price_submissions_before_insert
  before insert on public.price_submissions
  for each row execute function public.price_submissions_before_insert();

create index if not exists price_submissions_by_user_recent
  on public.price_submissions (submitted_by, created_at desc);

-- 3. Storage: size and type limits, and an upload rate limit ----------------------
--
-- Both buckets accepted any file type up to the project-wide limit (50 MiB), so a
-- script with an anonymous session could fill storage with arbitrary files.
update storage.buckets
   set file_size_limit = 15 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 where id = 'submission-photos';
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'issue-screenshots';

-- How many files the caller uploaded to a bucket in the last hour. Runs as the
-- caller (SECURITY INVOKER), so RLS limits the count to their own folder anyway.
create or replace function public.my_recent_uploads(p_bucket text)
returns int
language sql
stable
set search_path = public, storage
as $$
  select count(*)::int from storage.objects
   where bucket_id = p_bucket
     and name like auth.uid()::text || '/%'
     and created_at > now() - interval '1 hour';
$$;

drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'submission-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.my_recent_uploads('submission-photos') < 30);

drop policy if exists "upload own issue screenshots" on storage.objects;
create policy "upload own issue screenshots" on storage.objects for insert to authenticated
  with check (bucket_id = 'issue-screenshots'
              and (storage.foldername(name))[1] = auth.uid()::text
              -- 5 reports an hour x 4 screenshots each (see issue_reports).
              and public.my_recent_uploads('issue-screenshots') < 20);
