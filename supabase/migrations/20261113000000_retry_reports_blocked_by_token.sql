-- One-off repair (problems log #11). The first GitHub token couldn't create
-- issues (403 "Resource not accessible by personal access token"), so reports
-- used up their 5 attempts on a setup problem. Give them their attempts back.
-- The file-issue function no longer counts 401/403/404 as attempts.
update public.issue_reports
   set status = 'pending', attempts = 0, claimed_at = null
 where status <> 'filed'
   and (last_error like 'GitHub 401%' or last_error like 'GitHub 403%' or last_error like 'GitHub 404%');
