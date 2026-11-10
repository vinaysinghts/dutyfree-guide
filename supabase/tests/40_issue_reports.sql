-- In-app problem reports: server-owned fields, own-folder screenshots, rate limit, single claim.
\set ON_ERROR_STOP 1
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- The client can't pretend a report is already filed: the trigger resets server-owned fields.
insert into issue_reports (category, description, screenshot_paths, status, github_issue_number)
values ('bug', 'Prices tab is empty', array['11111111-1111-1111-1111-111111111111/r1/1.jpg'], 'filed', 42);
select category, status, attempts, github_issue_number, reporter from issue_reports;

-- Screenshots in someone else's folder are rejected.
do $$ begin
  insert into issue_reports (description, screenshot_paths)
  values ('look at this', array['22222222-2222-2222-2222-222222222222/x.jpg']);
  raise exception 'should have failed';
exception when others then
  if sqlerrm like 'screenshots must be%' then raise notice 'foreign screenshot blocked: ok'; else raise; end if;
end $$;

-- Too short a description is rejected.
do $$ begin
  insert into issue_reports (description) values ('  ');
  raise exception 'should have failed';
exception when check_violation then raise notice 'empty description blocked: ok';
end $$;

-- Rate limit: 5 per hour per user (1 already sent above).
insert into issue_reports (description) select 'report ' || g from generate_series(2, 5) g;
do $$ begin
  insert into issue_reports (description) values ('sixth');
  raise exception 'should have failed';
exception when others then
  if sqlstate = 'P0429' then raise notice 'rate limit: ok'; else raise; end if;
end $$;

-- Claiming is exclusive: the second claim of the same report gets nothing.
select count(*) as first_claim from claim_issue_report((select min(id) from issue_reports));
select count(*) as second_claim from claim_issue_report((select min(id) from issue_reports));

-- A stale 'filing' lease (crashed attempt) can be claimed again.
update issue_reports set claimed_at = now() - interval '10 minutes' where id = (select min(id) from issue_reports);
select count(*) as reclaim_after_crash, max(attempts) as attempts from claim_issue_report((select min(id) from issue_reports));

-- After 5 attempts the report stops being retried.
update issue_reports set status = 'failed', attempts = 5 where id = (select min(id) from issue_reports);
select count(*) as claim_after_5_attempts from claim_issue_report((select min(id) from issue_reports));
