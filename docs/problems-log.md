# Problems and resolutions log

A running record of the non-obvious problems hit while building this, how they were diagnosed and
fixed, and the lesson. Newest first. Each entry is written so it can be told as a story in an
interview: **situation → investigation → fix → what I'd do differently**.

---

## #4: Retailer sites unreachable from the build environment (2026-11-09)

**Situation.** The first adapters (BLR shopdutyfree.com, Schiphol) had to be written without being
able to load the real pages: the cloud build environment's network policy refused both hosts, and
a page fetcher only returned extracted text (no HTML, no robots.txt).

**Approach.** Designed the parser to be **resilient to unknown markup** rather than guessing one structure:
1. Parse schema.org JSON-LD first. Retailers publish it for Google Shopping, so it's the most likely-to-exist and most stable source.
2. Fall back to a list of candidate CSS selectors per field.
3. Made the crawl loop stop when a page yields nothing new, so a wrong pagination guess can't loop 30 times.
4. Fixture-based tests pin the behaviour; a `parse` CLI command lets anyone save a real page and test offline.
5. The daily schedule is **off by default** (`SCRAPE_ENABLED` repo variable) until the adapters are verified live.

**Lesson.** When you can't observe the system, push the uncertainty to a seam you can verify cheaply
later (`dutyfree-scrape parse page.html`) and make the dangerous part (the scheduled job) opt-in.

---

## #3: Expo static web export rendered a blank page (2026-11-09)

**Situation.** `npx expo export --platform web` with `web.output: "static"` succeeded, but the page
showed only the header. Headless Chromium reported **no JS errors**.

**Investigation.** No errors + no content pointed at JS not running at all rather than crashing.
Checked network responses: only the HTML loaded. `grep '<script' dist/index.html` showed just the
hydration flag and **no bundle `<script src>` tags**, though the bundles existed in `dist/_expo`.

**Fix.** Switched to `web.output: "single"` (SPA). Script tags were emitted and the app rendered.
SEO-oriented static rendering is deferred anyway (ADR-0001).

**Lesson.** "Blank page, no errors" → check whether code was *delivered* before debugging whether it *ran*.
Follow-up: re-test `static` on the next Expo SDK upgrade.

---

## #2: Screenshot test clicked the wrong "Add" (2026-11-09)

**Situation.** The browser test searched for an airport and clicked `getByText('Add')`, but nothing was added.

**Cause.** Playwright text matching is substring by default; the intro copy "**Add** every airport on
your route…" matched first.

**Fix.** `getByText('Add', { exact: true })`. Longer term, give interactive elements accessibility
labels and select by role (`getByRole('button', { name: … })`), which is better for screen-reader users too.

---

## #1: PL/pgSQL "column reference is ambiguous" in the review function (2026-11-09)

**Situation.** `review_submission(submission_id, approve, note, …)` compiled fine but failed the first
time it ran: `column reference "note" is ambiguous`.

**Cause.** PL/pgSQL resolves identifiers in SQL statements against both function parameters and table
columns. `price_submissions` has a `note` column and the function had a `note` parameter, so
`review_note = note` could mean either. PL/pgSQL only checks this at execution time, not at `CREATE FUNCTION`.

**Fix.** Prefixed all parameters with `p_` (`p_note`, `p_submission_id`, …) and added an SQL test that
actually executes the function (`supabase/tests/10_review_flow.sql`), which also checks that non-admins
are blocked and double approval is rejected.

**Lesson.** Function bodies in Postgres are late-bound: a migration applying cleanly proves little.
Test by **executing** functions in CI.
