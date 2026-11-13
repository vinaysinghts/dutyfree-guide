# Security: how the app reaches Supabase, and what an attacker can do

*Written for the audit of 2026-11-13 (problems log #20, [ADR-0017](adr/0017-data-api-access-model.md)).
It answers one question in depth: **if someone pulls the APK apart and finds how it talks to
Supabase, can they hack us?***

## 1. The short answer

They will find two things in the APK: the project URL and the **publishable key**. Both are
public on purpose, and the same values are in this repo's `client/.env.example`. Holding them
lets anyone do exactly what the app does: read prices, sign in anonymously, send a price report,
send a problem report. That's the same power as installing the app.

What protects the data is not the secrecy of the key but **what the database lets each role do**:
table grants, Row Level Security (RLS) policies, function EXECUTE privileges, and triggers. The
real master key (the **secret / service-role key**, which bypasses RLS) is only in GitHub Actions
secrets and Supabase's Edge Function environment. It is not in the app.

So the threat isn't "they found the key". It's "**is there something the public key can do that
the app never intended?**" The audit found one such thing (§5, finding F1) and fixed it.

### Evidence, not assumption

We downloaded the live APK (`android-latest`, built from `2862297`) and searched its JavaScript
bundle (`assets/index.android.bundle`, Hermes bytecode, whose string table is plain text):

| Looked for | Found | Meaning |
|---|---|---|
| `https://pkywwbvqpwomvbldgbyw.supabase.co` | yes | Project URL. Public by design. |
| `sb_publishable_4OVA…` | yes | Publishable key. Public by design. |
| `sb_secret_` | 1 hit | supabase-js's own check that **refuses** a secret key in a client. Not a key. |
| `github_pat_` | 2 hits | The redaction regex in `lib/diagnostics.ts` that scrubs tokens from problem reports. Not a token. |
| `service_role`, `eyJhbGci` (a JWT) | none | No legacy service-role JWT. |

A decompiler is not even needed: `unzip app.apk assets/index.android.bundle && strings` shows
the same. Assume anything in a client is public: obfuscation only slows a reader down.

How the key gets there: `EXPO_PUBLIC_*` variables are inlined into the bundle at build time
(`client/lib/supabase.ts`). That prefix is the line between "may ship to users" and "must not".
`SUPABASE_SERVICE_ROLE_KEY` never has that prefix and is only read by the scrapers
(`scrapers/dutyfree_scrapers/store.py`), the deploy workflow, and the Edge Function.

## 2. The request flow

```
 Phone / browser                     Supabase edge                          Postgres
 ───────────────                     ─────────────                          ────────
 supabase-js
   │  HTTPS
   │  apikey: sb_publishable_…            ┌─────────────────────┐
   │  Authorization: Bearer <user JWT>  ─▶│ API gateway          │ 1. Is the apikey one of this
   │  (or no Authorization if signed out) │ (Kong / Envoy)       │    project's keys? No → 401.
   │                                      │                      │ 2. Route by path:
   │                                      └──┬──────┬──────┬────┘
   │                       /auth/v1/*        │      │      │  /functions/v1/*
   │                 ┌───────────────────────┘      │      └────────────────────┐
   │                 ▼                              │ /rest/v1/*                 ▼
   │        ┌──────────────────┐                    │ /storage/v1/*     ┌──────────────────┐
   │        │ Auth (GoTrue)    │                    ▼                   │ Edge Function    │
   │        │ signInAnonymously│           ┌──────────────────┐         │ file-issue (Deno)│
   │        │ → issues a JWT:  │           │ PostgREST /      │         │ verify_jwt=false;│
   │        │  sub=<uuid>      │           │ Storage API      │         │ checks the user  │
   │        │  role=authenticated          │ 3. Verify JWT    │         │ itself, then uses│
   │        │  is_anonymous=true│          │    signature     │         │ the SERVICE ROLE │
   │        │  exp=+1h         │           │    (no JWT → anon)│        │ key server-side  │
   │        └──────────────────┘           │ 4. BEGIN;        │         └────────┬─────────┘
   │                                       │  SET LOCAL ROLE  │                  │
   │                                       │   authenticated; │                  │ bypasses RLS
   │                                       │  set request.jwt │                  ▼
   │                                       │   .claims = {…}; │         (service_role)
   │                                       │ 5. SQL from URL  │
   │                                       └────────┬─────────┘
   │                                                ▼
   │                                ┌─────────────────────────────────────────────┐
   │                                │ Postgres, as role anon / authenticated       │
   │                                │  6. GRANT check: may this role touch this    │
   │                                │     table / EXECUTE this function at all?    │
   │                                │  7. RLS: USING filters rows it can see;      │
   │                                │     WITH CHECK rejects rows it may not write │
   │                                │     (auth.uid() reads `sub` from the claims) │
   │                                │  8. BEFORE triggers: overwrite server-owned  │
   │                                │     fields, rate-limit, validate             │
   │                                │  9. CHECK / FK constraints                   │
   │                                └─────────────────────────────────────────────┘
   ◀────────────────────────── JSON rows (only those RLS let through) ─────────────
```

Things worth internalising from this picture:

- **The apikey is not authentication.** The gateway checks it to know *which project* and to
  stop random traffic, nothing more. Who you are comes from the **JWT**, signed by Supabase Auth
  with a key the client never sees. You can't forge `sub` or `role` without that key.
- **Signed-out requests run as `anon`; signed-in ones as `authenticated`.** An anonymous sign-in
  is a real user (a row in `auth.users`) with `role=authenticated` and `is_anonymous=true`. It
  gives a stable `auth.uid()` for RLS without email. It is *not* proof of a real person: anyone
  can mint as many as Auth's per-IP rate limit allows.
- **PostgREST turns the URL into SQL and runs it as that role.** There's no app server in
  between deciding what's allowed (ADR-0002), so every rule must live in the database. That is
  why grants, RLS and triggers are the whole security model, not a backup for one.
- **`SECURITY DEFINER` functions run as their owner** (the `postgres` superuser in Supabase) and
  so skip step 7. They are the sharpest tool: each one must check the caller itself, *and* its
  EXECUTE privilege must be limited to the roles that should call it. F1 is what happens when
  the second half is missed.
- **Storage is the same model.** Files are rows in `storage.objects`; upload and download
  permissions are RLS policies on that table. Bucket settings add size and MIME-type limits.

## 3. Roles and keys

| Credential / role | Where it lives | What it can do |
|---|---|---|
| Publishable key (`sb_publishable_…`) | App bundle, repo, workflows | Lets a request in. Without a user JWT, the request runs as `anon`. |
| User JWT (`role=authenticated`) | Phone's AsyncStorage / browser localStorage, 1h, auto-refreshed | Runs as `authenticated` with that user's `auth.uid()`. |
| Secret key / service role | GitHub Actions secrets; Edge Function env | Runs as `service_role`: **bypasses RLS**. Scrapers, deploy, `file-issue`. |
| DB password, access token | GitHub Actions secrets | Migrations (`supabase db push`). Full control. |
| `GITHUB_ISSUES_TOKEN` | Edge Function env only | Create issues in this repo. |
| Admin | A row in `public.admins` | `is_admin()` is true: review queue, all photos. |

## 4. What each table allows (the audit matrix)

All tables have RLS enabled (now enforced by a test, §7). "—" means no policy, so denied.

| Table | anon (signed out) | authenticated (incl. anonymous sign-in) | admin | Writes by |
|---|---|---|---|---|
| `airports`, `retailers`, `products`, `prices`, `fx_rates` | read all | read all | read all | service role (scrapers) or `review_submission` |
| `latest_prices` (view) | read | read | read | `security_invoker`, so the table policies above apply |
| `price_submissions` | — | insert own as `pending`; read own | read all, update all, review via `review_submission()` | |
| `issue_reports` | — | insert own (5/hour); read own | read all | status columns only by the Edge Function (service role) |
| `admins` | — | read only if you are one | read | DB owner by hand |
| `trips`, `trip_airports` | — | full access to own | own | |
| storage `submission-photos` | — | upload to `<uid>/…`; read own | read all | |
| storage `issue-screenshots` | — | upload to `<uid>/…`; read own | read all | Edge Function signs URLs for the GitHub issue |

Functions callable through `/rest/v1/rpc/…`:

| Function | Runs as | Who may call | Guard |
|---|---|---|---|
| `is_admin()` | definer | anyone | Returns only "am I an admin". |
| `review_submission(…)` | definer | authenticated | Raises unless `is_admin()`. |
| `claim_issue_report(id)` | definer | **service_role only** (was: everyone, F1) | — |
| `nearest_airports`, `distance_km`, `search_fold`, `my_recent_uploads` | invoker | anyone | Reads public data / own rows only. |
| trigger functions | — | nobody (revoked; triggers don't need EXECUTE) | |

## 5. Findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | **High** (availability + data exposure) | `claim_issue_report` was executable by `anon` and `authenticated`. It's `SECURITY DEFINER`, so a signed-out visitor could call it for any id, read that problem report (description, device context, reporter id) and lease it, burning its 5 attempts so it never reached GitHub. A loop over ids would have shut the whole problem-report pipeline down in about 25 minutes. Reproduced locally with Supabase's grants. | Revoke from `anon, authenticated` (migration `20261113030000`). |
| F2 | Medium (integrity) | A price report's insert policy checked only `submitted_by` and `status`. A client could set `reviewed_by` / `reviewed_at` / `review_note` / `created_at`, point `photo_path` at another user's photo, or date the price in 2099 so that once approved it would stay "latest" forever. | `price_submissions_before_insert` trigger resets server-owned fields, requires the photo in your own folder, and bounds the dates. |
| F3 | Medium (abuse / cost) | No rate limit on price reports, and both photo buckets took any file type up to 50 MiB. One script could fill storage or flood the review queue. | 30 reports/hour/user (trigger), 30 photos and 20 screenshots/hour/user (storage policy), 15 MiB / 10 MiB size limits, images only. |
| F4 | Low (process) | The SQL tests ran as the superuser, which bypasses RLS and all grants, and the test stubs had none of Supabase's default grants, so F1 was invisible to CI. | Stubs now recreate Supabase's grants; `60_access_control.sql` runs as `anon`/`authenticated` and adds guardrails (§7). |
| — | OK | Service-role key is absent from the app, `.env.example` files and logs; only `EXPO_PUBLIC_*` reach the bundle. | — |
| — | OK | Every table has RLS; the one view is `security_invoker`; `review_submission` and `is_admin` check the caller; `issue_reports` already reset its server-owned fields and rate-limited. | — |
| — | OK | `file-issue` checks the caller's JWT itself (`auth.getUser`) and that they own the report; sweep mode uses a constant-time token compare. | — |

## 6. Threat model

Assets, in order of what would hurt most: (1) **trust in prices** (the product is worthless if
they can be faked), (2) the service-role key and DB password, (3) travellers' report data
(locations of photos, device context), (4) the problem-report → GitHub pipeline and the repo's
issue tracker, (5) storage and Supabase quota (cost).

Actors: a curious user with the APK; a scripted spammer; a competitor wanting to scrape or
poison prices; someone who gets hold of a CI secret.

| Threat (STRIDE) | Example | Mitigation | Residual risk |
|---|---|---|---|
| **Spoofing** | Pretend to be another user | JWT signed by Auth; `auth.uid()` from verified claims | A stolen device session (1h token + refresh token) acts as that user. Low value: anonymous users own little. |
| **Spoofing** | Pretend to be an admin | Admin = row in `admins`, only writable by the DB owner | Admin accounts should use a strong sign-in (email + MFA), not an anonymous session. |
| **Tampering** | Publish a fake low price | Nothing is public until an admin approves (ADR-0006); server-side location check (ADR-0008); dates bounded (F2) | A careful liar with a real-looking photo still relies on the reviewer. |
| **Tampering** | Write to `prices`/`fx_rates` directly | No write policy for API roles | — |
| **Repudiation** | "I didn't submit that" | `submitted_by`, `created_at` set by the server | Anonymous users are unlinkable to a person, by design. |
| **Information disclosure** | Read other users' reports or photos | RLS "own or admin"; private buckets; F1 fixed | Filed problem reports become **public** GitHub issues with 1-year signed screenshot URLs (ADR-0010). The form says so. |
| **Information disclosure** | Service-role key leaks | Only in CI/Function secrets; never `EXPO_PUBLIC_` | The hourly sync sends it as `SYNC_TOKEN`; see recommendation R2. |
| **Denial of service** | Flood reports / uploads | Per-user rate limits (F3); Auth caps anonymous sign-ins per IP (30/hour in `config.toml`) | Per-user limits are per *anonymous user*, so the ceiling per IP is about 30 users × 30 reports. CAPTCHA (R1) closes that. |
| **Denial of service** | Kill the problem-report pipeline | F1 fixed | — |
| **Elevation of privilege** | Call a privileged function | EXECUTE allowlist test; definer functions check `is_admin()` | A future `SECURITY DEFINER` function without a REVOKE now fails CI. |
| **Scraping our data** | Pull every price via `/rest/v1/latest_prices` | It's public data, the same the app shows | Acceptable. If it costs too much, add caching or move reads behind a function with limits. |

## 7. Guardrails that keep this true

`supabase/tests/60_access_control.sql` runs in CI as the real API roles and fails the build if:

1. any table in `public` has RLS off;
2. any `SECURITY DEFINER` function is executable by `anon`/`authenticated` without being on the
   allowlist (with a reason) in the test;
3. any view is not `security_invoker`;

and it proves the specific behaviours: anon can't claim reports, users can't read each other's
rows, forged review fields are reset, foreign photos and future dates are rejected, and the rate
limits trigger. Ran against the old migrations, check 2 fails and names `claim_issue_report`.

**Why not just change the default privileges?** Supabase grants EXECUTE on new `public`
functions to the API roles, and Postgres also grants it to `PUBLIC` (every role). Removing the
`PUBLIC` default can only be done globally, which would also hit functions that extensions
create. A test that names each exception is narrower and teaches the reviewer why.

### Checklist for a new table or function

- Table: `enable row level security` in the same migration, then one policy per operation and
  role you actually need. No policy = denied, which is the safe default.
- Columns the server owns (status, reviewer, timestamps, counters): set them in a `BEFORE INSERT`
  trigger. A `WITH CHECK` only sees the final row, so it can't tell "client sent it" from "default".
- Function: prefer `SECURITY INVOKER`. If it must be `DEFINER`: `set search_path`, check the
  caller inside, `revoke execute … from public, anon, authenticated`, grant back only what's
  needed, and add it to the test allowlist with a reason.
- Anything a stranger can insert: think about the rate limit and the size limit on day one.

## 8. Recommendations not done in this PR

| # | What | Why not now |
|---|---|---|
| R1 | **CAPTCHA on anonymous sign-in** (Cloudflare Turnstile, supported natively by Supabase Auth). | Needs a Cloudflare site key and a product decision on friction. It's the one control that ties a session to a likely-human, so per-user limits become meaningful. |
| R2 | **Separate `SYNC_TOKEN`** instead of reusing the service-role key for the hourly sweep. | Needs a new repo secret. Today the master key is sent (over TLS) to our own function every hour; a narrower token limits the blast radius if a function log ever captured headers. |
| R3 | **Run Supabase's Security Advisor** (Dashboard → Advisors) after each deploy, or `supabase db lint` in CI. | It would have flagged F1-style issues. Needs the CLI linked in CI with the DB password; the deploy workflow already has it. |
| R4 | **Check hosted Auth settings match `config.toml`.** The deploy workflow runs `db push`, not `config push`, so rate limits, anonymous sign-in and CAPTCHA live in the dashboard. | Dashboard-only; worth a 2-minute look. |
| R5 | Admin accounts: email sign-in with MFA; never mark an anonymous user as admin. | Process. |
| R6 | Key rotation drill: rotate the secret key once, confirm scrapers, deploy and the function still work. | Do it before the app has many users, not during an incident. |
