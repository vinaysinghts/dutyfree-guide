# ADR-0017: The database is the security boundary; function grants are tested, not assumed

**Status:** Accepted (2026-11-13). Details and threat model: [docs/security.md](../security.md).

## Context

The app has no API server (ADR-0002): it calls Supabase's Data API with a publishable key that
ships in the APK. Anyone can unpack the APK and call the same endpoints with any parameters. So
the database must refuse everything the app doesn't need, for every role, on its own.

A security audit found that `claim_issue_report`, a `SECURITY DEFINER` function meant only for
the Edge Function, was callable by everyone (problems log #20). The migration had revoked EXECUTE
from `PUBLIC`, but Supabase also grants EXECUTE on new `public` functions directly to `anon` and
`authenticated`, and our tests (run as superuser, without those grants) couldn't see it.

## Options

1. **Hide the key** (obfuscation, a proxy that adds it). Doesn't work: whatever the app can send,
   an attacker can send. It only adds latency and a server to run.
2. **Add an API server** that holds the service-role key and enforces rules in code. Real
   boundary, but gives up the main reason for choosing Supabase and adds a service to operate.
3. **Change Postgres default privileges** so new functions aren't executable by API roles.
   Removing the `PUBLIC` default must be done globally, which also affects extension functions;
   and it fails silently the other way (a new app RPC just doesn't work).
4. **Keep the database as the boundary, and test it as the API roles see it.** RLS on every
   table, server-owned fields set by triggers, explicit REVOKE on every privileged function, and
   CI tests that run as `anon`/`authenticated` with Supabase's real grants, including an
   allowlist of `SECURITY DEFINER` functions open to API roles.

## Decision

Option 4. Concretely:

- Every table: RLS on; policies per operation and role.
- Server-owned columns: set in `BEFORE INSERT` triggers (status, reviewer, timestamps), not just
  checked in `WITH CHECK`.
- Every `SECURITY DEFINER` function: checks the caller, pins `search_path`, and is revoked from
  `public, anon, authenticated` unless it's on the allowlist in `supabase/tests/60_access_control.sql`.
- Anything strangers can insert has a per-user rate limit and, for files, size and type limits.
- The secret key stays in CI and Edge Function secrets; only `EXPO_PUBLIC_*` reaches the app.

## Consequences

- Good: one place for every rule; a new definer function or a table without RLS fails CI
  instead of shipping; the APK holds nothing worth stealing.
- Bad: rules in SQL are harder to read than app code, and tests must recreate Supabase's grants
  in plain Postgres (the stubs can drift from the hosted platform).
- Per-user limits are weak while anonymous sign-ins are cheap; CAPTCHA on sign-in is the
  follow-up (security.md R1).

## Revisit when

- We add real accounts or anything personal (then: MFA for admins, data retention, deletion).
- Abuse shows up despite the limits (then: CAPTCHA, or an Edge Function in front of inserts).
- Supabase changes its default grants (the stubs and the allowlist test need updating).
