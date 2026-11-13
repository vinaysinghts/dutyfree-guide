# ADR-0010: Reporting problems from inside the app, as GitHub issues

**Status:** accepted, 2026-11-10

## Context
When something looks wrong in the app (an empty price list, a wrong price, a crash), the fastest
fix starts with a good bug report: what the user saw (a screenshot), which screen, which app
version and device, and what errored just before. Today that means describing it in chat and
reproducing it by hand. We want a **"Report a problem" button on every screen** that produces a
ready-to-fix ticket where the code lives: GitHub issues on this repo.

Constraints:
- The app is public (APK, website). **Anything shipped in it is public**, so it can't hold a GitHub
  token. A token in the APK can be extracted in minutes and used to spam or vandalise the repo.
- The repo is **public**, so issues, and anything linked from them, are public.
- Free tier only; one developer.

## Options considered

| Option | How it works | Why not (or why) |
|---|---|---|
| A. Open GitHub's "new issue" page, prefilled | App builds `github.com/…/issues/new?title=&body=` | Needs a GitHub account; can't attach screenshots automatically. **Kept as the demo-mode fallback.** |
| B. GitHub token in the app | App calls the GitHub API directly | Token leaks with the APK. Rejected outright. |
| C. Third-party feedback SDK (Sentry user feedback, Instabug, Shake) | SDK captures screen + device info, sends to their dashboard | Good product, but another account, paid tiers for screenshots, and issues land outside GitHub. Revisit if we add crash reporting (Sentry), which would pair well. |
| D. **Our backend files the issue** | App → Supabase (row + screenshots) → Edge Function holding the token → GitHub API | Token stays server-side; uses what we already run; free. **Chosen.** |
| D′. Database trigger calls GitHub (`pg_net`) | Insert fires an HTTP call from Postgres | Puts a secret and retry logic inside SQL, harder to test and debug. |

## Decision
1. **Capture.** A bug icon in every screen's header. On tap the app **first** takes a screenshot of
   the current screen (`react-native-view-shot`: native capture on phones, `html2canvas-pro` on
   web), then opens the form, so the picture shows the problem, not the form. The user can remove it
   or add up to 4 from the gallery.
2. **Context.** App version/build, platform/OS, device model, window size, locale, the screen's
   route, the trip's airports (opt-out), and the last 25 console errors/warnings (opt-out; kept in
   memory only, tokens redacted). No user id, location or name. The form shows **exactly** what will
   be sent.
3. **Outbox, then side effect.** The app uploads screenshots to a private bucket
   (`issue-screenshots/<uid>/…`), then inserts an `issue_reports` row. That row is the durable
   record. Only then does it call the `file-issue` Edge Function, which creates the GitHub issue and
   writes the issue number back. If GitHub or the network fails, the report is still saved, and an
   **hourly GitHub Action** calls the function in "sweep" mode to file what's left.
4. **No duplicates from concurrency.** Before filing, the function **leases** the row
   (`claim_issue_report()`: one atomic `UPDATE … WHERE status IN ('pending','failed') RETURNING`).
   The app's call and the sweep can't both win. A lease older than 5 minutes counts as a crashed
   attempt; after 5 attempts a report stops retrying and waits for a human.
5. **Trust boundaries.** The database trigger overwrites server-owned fields (`status`,
   `github_issue_*`), checks screenshots are in the reporter's own folder, and rate-limits each
   user to 5 reports an hour. The function verifies the caller's session and that they own the
   report. User text is neutralised before it reaches GitHub (no `@mentions`, no breaking out of
   code blocks or the marker comment).
6. **Screenshots in the issue** are **signed URLs valid for one year** to the private bucket.
   GitHub's image proxy caches them on first view.

## Consequences
- 👍 One tap from "this looks wrong" to an issue with a screenshot, screen, version and errors.
- 👍 The GitHub token only exists in Supabase's function secrets and GitHub's repo secrets.
- 👍 Nothing is lost when GitHub is down, and nothing is filed twice by two concurrent callers.
- 👎 **At-least-once, not exactly-once.** If GitHub creates the issue but the function dies before
  saving the number, the next attempt files it again. Each body carries `<!-- app-report:<id> -->`,
  so a duplicate is easy to spot and close. True exactly-once would need GitHub to support
  idempotency keys, which it doesn't.
- 👎 **Public.** The repo is public, so reports and screenshots are visible to anyone with the link.
  The form says so and lets the user remove the screenshot. If that becomes a problem: post issues
  to a private repo, or keep screenshots private and put only an admin link in the issue.
- 👎 Signed screenshot links stop working after a year (fine for bug reports).
- 👎 Anonymous sessions are free to create, so the per-user rate limit slows spam rather than
  stopping it. Next steps if abused: a global hourly cap, or CAPTCHA (Supabase supports Turnstile
  for anonymous sign-ins).

## Revisit when
- We add crash reporting (Sentry etc.): consider moving feedback to the same tool (option C).
- Reports start containing personal data, or volume makes GitHub noisy.

## Update 2026-11-13 (problems log #11)
- GitHub 401/403/404 are **setup errors** (our token or repo), not report errors: they don't use up
  a report's attempts, and the report stays `pending` until the token works.
- The deploy workflow sweeps right after setting secrets and fails if GitHub rejects the token.
- GitHub runs the "hourly" schedule every few hours on a quiet repo, so the sweep is a slow safety
  net, not a promise. The app now says "shortly".
