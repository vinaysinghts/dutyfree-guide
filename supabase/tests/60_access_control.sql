-- Access control as the Data API roles see it (docs/security.md, problems log #20).
-- The other tests run as the superuser, which bypasses RLS and every grant. Here we
-- `set role anon` / `set role authenticated`, the same roles PostgREST switches to,
-- with Supabase's default grants recreated in 00_supabase_stubs.sql.
\set ON_ERROR_STOP 1
reset role;
insert into auth.users values ('33333333-3333-3333-3333-333333333333'), ('44444444-4444-4444-4444-444444444444')
on conflict do nothing;

-- Guardrail 1: every table in public has RLS on. A table without it is readable and
-- writable by anyone holding the public key, because the API roles have table grants.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then raise exception 'tables without RLS: %', missing; end if;
  raise notice 'every public table has RLS: ok';
end $$;

-- Guardrail 2: SECURITY DEFINER functions bypass RLS, so each one the API roles may
-- call must be on this list, with a reason. Adding one means reviewing it here.
do $$
declare offenders text;
begin
  select string_agg(format('%s (%s)', p.oid::regprocedure, r.role), ', ') into offenders
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated')) r(role)
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege(r.role, p.oid, 'execute')
     and (p.proname, r.role) not in (
       ('is_admin', 'anon'), ('is_admin', 'authenticated'),  -- returns only "am I an admin"
       ('review_submission', 'authenticated')                 -- checks is_admin() first
     );
  if offenders is not null then raise exception 'SECURITY DEFINER functions open to API roles: %', offenders; end if;
  raise notice 'SECURITY DEFINER allowlist: ok';
end $$;

-- Every view runs with the caller's rights, so it can't leak around RLS.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false);
  if bad is not null then raise exception 'views without security_invoker: %', bad; end if;
  raise notice 'views are security_invoker: ok';
end $$;

-- A problem report owned by user 3, to attack.
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into issue_reports (description, context) values ('private bug report', '{"device": "Pixel 8"}');
reset request.jwt.claim.sub;

-- The hole: a signed-out visitor could claim (read + lease) anyone's report.
set role anon;
do $$ begin
  perform * from claim_issue_report((select max(id) from issue_reports));
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'anon cannot claim reports: ok';
end $$;
-- ...and neither can a signed-in user.
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  perform * from claim_issue_report(1);
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'users cannot claim reports: ok';
end $$;
reset role;
select status, attempts from issue_reports where description = 'private bug report';

-- Signed-out visitors read the public catalogue and nothing else.
set role anon;
reset request.jwt.claim.sub;
select (select count(*) from airports) > 0 as anon_reads_airports,
       (select count(*) from price_submissions) as anon_sees_submissions,
       (select count(*) from issue_reports) as anon_sees_issue_reports,
       (select count(*) from admins) as anon_sees_admins;
do $$ begin
  insert into fx_rates values ('XXX', 1, current_date);
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'anon cannot write prices or rates: ok';
end $$;
do $$ begin
  perform review_submission(1, true);
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'anon cannot call review_submission: ok';
end $$;

-- Signed-in user 4: sees only their own rows.
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select count(*) as user4_sees_others_reports from issue_reports;
select count(*) as user4_sees_others_submissions from price_submissions;

-- Forged review fields are reset by the server.
insert into price_submissions (submitted_by, airport_iata, product_name, price, currency,
                               reviewed_by, reviewed_at, review_note, created_at)
values ('44444444-4444-4444-4444-444444444444', 'BLR', 'Black Label 1L', 3000, 'INR',
        '22222222-2222-2222-2222-222222222222', now(), 'looks right', '2020-01-01');
select status, reviewed_by, reviewed_at, review_note, created_at > now() - interval '1 minute' as fresh_created_at
  from price_submissions;

-- Can't self-approve: a report sent as 'approved' is stored as 'pending'.
insert into price_submissions (submitted_by, airport_iata, product_name, price, currency, status)
values ('44444444-4444-4444-4444-444444444444', 'BLR', 'Self approved?', 1, 'INR', 'approved');
select status as sent_as_approved_stored_as from price_submissions where product_name = 'Self approved?';

-- Can't attach someone else's photo.
do $$ begin
  insert into price_submissions (submitted_by, airport_iata, photo_path)
  values ('44444444-4444-4444-4444-444444444444', 'BLR', '33333333-3333-3333-3333-333333333333/a.jpg');
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'foreign photo blocked: ok';
end $$;

-- Can't date a price in the future to keep it "latest" forever.
do $$ begin
  insert into price_submissions (submitted_by, airport_iata, product_name, price, currency, observed_on)
  values ('44444444-4444-4444-4444-444444444444', 'BLR', 'Black Label 1L', 1, 'INR', '2099-01-01');
  raise exception 'should have failed';
exception when check_violation then raise notice 'future price date blocked: ok';
end $$;

-- Can't edit or delete a report once sent (no update/delete policy for non-admins).
update price_submissions set price = 1;
delete from price_submissions;
select product_name, price from price_submissions order by id;

-- Rate limit: 30 an hour (2 sent above).
insert into price_submissions (submitted_by, airport_iata, product_name, price, currency)
select '44444444-4444-4444-4444-444444444444', 'BLR', 'Report ' || g, 100 + g, 'INR' from generate_series(3, 30) g;
do $$ begin
  insert into price_submissions (submitted_by, airport_iata, product_name, price, currency)
  values ('44444444-4444-4444-4444-444444444444', 'BLR', 'Thirty-first', 1, 'INR');
  raise exception 'should have failed';
exception when others then
  if sqlstate = 'P0429' then raise notice 'price report rate limit: ok'; else raise; end if;
end $$;

-- Storage: own folder only, and 30 photos an hour.
insert into storage.objects (bucket_id, name) values ('submission-photos', '44444444-4444-4444-4444-444444444444/1.jpg');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('submission-photos', '33333333-3333-3333-3333-333333333333/x.jpg');
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'upload to foreign folder blocked: ok';
end $$;
insert into storage.objects (bucket_id, name)
select 'submission-photos', '44444444-4444-4444-4444-444444444444/' || g || '.jpg' from generate_series(2, 30) g;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('submission-photos', '44444444-4444-4444-4444-444444444444/31.jpg');
  raise exception 'should have failed';
exception when insufficient_privilege then raise notice 'photo upload rate limit: ok';
end $$;
reset role;
reset request.jwt.claim.sub;

select id, file_size_limit / 1024 / 1024 as max_mib, allowed_mime_types from storage.buckets order by id;
