/**
 * file-issue: turns rows of public.issue_reports into GitHub issues.
 *
 *   POST { "report_id": 12 }   Authorization: Bearer <user's access token>
 *     The app calls this right after inserting its report. Files that report
 *     (only if the caller wrote it) and returns { status, issue_url? }.
 *
 *   POST { "sweep": true }     Authorization: Bearer <SYNC_TOKEN>
 *     The hourly GitHub Action calls this to file anything still unfiled
 *     (GitHub was down, the app lost its connection, ...).
 *
 * The GitHub token never leaves this function. Design: docs/adr/0010-in-app-issue-reporting.md
 *
 * Secrets (set by the Supabase deploy workflow):
 *   GITHUB_ISSUES_TOKEN  fine-grained PAT, this repo only, Issues: read & write
 *   SYNC_TOKEN           shared secret for sweep mode
 *   GITHUB_REPO          optional, defaults to vinaysinghts/dutyfree-guide
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { buildIssue, isSetupError, type IssueReportRow } from './issue.ts';

const BUCKET = 'issue-screenshots';
// Screenshots are shown in the issue through signed URLs. A year covers the
// life of any bug report; after that the image link stops working.
const SCREENSHOT_URL_TTL_S = 365 * 24 * 3600;
const SWEEP_BATCH = 20;

const env = (k: string) => Deno.env.get(k) ?? '';
const REPO = env('GITHUB_REPO') || 'vinaysinghts/dutyfree-guide';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Outcome =
  | { status: 'filed'; issue_url: string; issue_number: number }
  | { status: 'pending' | 'failed' | 'skipped'; reason: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let body: { report_id?: unknown; sweep?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (body.sweep === true) {
    if (!env('SYNC_TOKEN') || !timingSafeEqual(token, env('SYNC_TOKEN'))) return json({ error: 'forbidden' }, 403);
    return json(await sweep(db));
  }

  const reportId = Number(body.report_id);
  if (!Number.isInteger(reportId) || reportId <= 0) return json({ error: 'report_id required' }, 400);

  // We verify the caller ourselves (verify_jwt is off in config.toml) so this
  // works with anonymous sessions and with Supabase's newer API keys alike.
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'sign in first' }, 401);

  const { data: owner } = await db.from('issue_reports').select('reporter').eq('id', reportId).maybeSingle();
  if (!owner || owner.reporter !== auth.user.id) return json({ error: 'report not found' }, 404);

  return json(await fileReport(db, reportId));
});

async function sweep(db: SupabaseClient) {
  // Leave fresh reports to the app's own call; pick up anything older than 2 minutes.
  const { data, error } = await db
    .from('issue_reports')
    .select('id')
    .neq('status', 'filed')
    .lt('attempts', 5)
    .lt('created_at', new Date(Date.now() - 2 * 60_000).toISOString())
    .order('created_at')
    .limit(SWEEP_BATCH);
  if (error) return { error: error.message };
  const results: Record<number, Outcome> = {};
  for (const { id } of data ?? []) results[id] = await fileReport(db, id);
  return { checked: data?.length ?? 0, results };
}

async function fileReport(db: SupabaseClient, id: number): Promise<Outcome> {
  const { data: existing } = await db
    .from('issue_reports')
    .select('status, github_issue_url, github_issue_number')
    .eq('id', id)
    .single();
  if (existing?.status === 'filed') {
    return { status: 'filed', issue_url: existing.github_issue_url, issue_number: existing.github_issue_number };
  }

  if (!env('GITHUB_ISSUES_TOKEN')) {
    // Not configured yet: the report is safe in the table and the sync job
    // files it once the secret is added.
    return { status: 'pending', reason: 'GitHub filing is not configured yet' };
  }

  // Lease the row so two callers can't create two issues for it.
  const { data: claimed, error: claimError } = await db.rpc('claim_issue_report', { p_id: id });
  if (claimError) return { status: 'failed', reason: claimError.message };
  const report = (claimed as (IssueReportRow & { attempts: number })[] | null)?.[0];
  if (!report) return { status: 'skipped', reason: 'already being filed, or out of retries' };

  try {
    const urls: string[] = [];
    for (const path of report.screenshot_paths) {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SCREENSHOT_URL_TTL_S);
      if (!error && data) urls.push(data.signedUrl);
    }

    const issue = await createGitHubIssue(buildIssue(report, urls));
    await db
      .from('issue_reports')
      .update({
        status: 'filed',
        github_issue_number: issue.number,
        github_issue_url: issue.html_url,
        filed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', id);
    return { status: 'filed', issue_url: issue.html_url, issue_number: issue.number };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (e instanceof GitHubError && isSetupError(e.status)) {
      // Our token is wrong, not the report: give the attempt back and keep it
      // pending, so it files as soon as the token is fixed (problems log #11).
      await db
        .from('issue_reports')
        .update({ status: 'pending', attempts: Math.max(0, report.attempts - 1), last_error: reason.slice(0, 500) })
        .eq('id', id);
      return { status: 'pending', reason };
    }
    await db.from('issue_reports').update({ status: 'failed', last_error: reason.slice(0, 500) }).eq('id', id);
    return { status: 'failed', reason };
  }
}

class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function createGitHubIssue(issue: { title: string; body: string; labels: string[] }) {
  const post = (payload: object) =>
    fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('GITHUB_ISSUES_TOKEN')}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dutyfree-guide-file-issue',
      },
      body: JSON.stringify(payload),
    });

  let res = await post(issue);
  // A label the token can't create shouldn't lose the report: retry without labels.
  if (res.status === 422) res = await post({ title: issue.title, body: issue.body });
  if (!res.ok) throw new GitHubError(res.status, `GitHub ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { number: number; html_url: string };
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
