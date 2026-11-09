# Problems and resolutions log

A running record of the non-obvious problems hit while building this, how they were diagnosed and
fixed, and the lesson. Newest first. Each entry is written so it can be told as a story in an
interview: **situation → investigation → fix → what I'd do differently**.

---

## #7: APK build failed before compiling anything (2026-11-09)

**Situation.** The first runs of the new Android APK workflow failed in under a minute, twice, for
two unrelated reasons.

1. **`setup-java` with `cache: gradle` errored.** It looks for `**/*.gradle*` to build a cache key,
   but with Continuous Native Generation `android/` doesn't exist until `expo prebuild` runs, later
   in the job. **Fix:** drop the cache option there and add `gradle/actions/setup-gradle` *after* prebuild.
2. **The Gradle wrapper got HTTP 504** downloading `gradle-9.4.1-bin.zip`. It failed again on a re-run
   a minute later. Tracing the URL: `services.gradle.org` redirects to a GitHub release asset, and that
   hop was timing out intermittently (the same URL returned 206 when probed later from elsewhere).
   **Fix:** a dedicated "Download Gradle" step that retries `./gradlew --version` up to 5 times with
   growing back-off, before the real build. `setup-gradle` then caches the distribution, so later runs
   don't depend on that download at all.

**Lesson.** Order matters in CI: a step can't key a cache on files a later step generates. And any
build that downloads tools at runtime needs retries *and* a cache, because the download is a network
dependency like any other.

---

## #6: OCR engine couldn't be downloaded from public CDNs (2026-11-09)

**Situation.** Tesseract.js by default downloads its WebAssembly core from `cdn.jsdelivr.net` and the
English model from `tessdata.projectnaptha.com` the first time it runs. Both were blocked in the
build environment, and the same would happen behind a corporate or airport firewall.

**Fix.** Self-host the assets. `scripts/copy-ocr-assets.js` (runs on `postinstall`) copies the worker,
the WASM core and the model from npm packages into `public/ocr`, and `ocr.web.ts` points
`workerPath` / `corePath` / `langPath` there. Only the two LSTM builds of the core are copied (with
and without SIMD), cutting the folder from 33 MB to 17 MB; a browser downloads ~7 MB once.

**Lesson.** Runtime downloads from third-party CDNs are hidden dependencies: they're a privacy leak,
an outage risk and a firewall problem. Bundle what you can version.

---

## #5: Real OCR output broke assumptions the unit tests didn't (2026-11-09)

**Situation.** The shelf-tag parser passed hand-written tests on clean text. Rendering two sample tags
and running real Tesseract on them showed what OCR actually produces:
- `₹ 4,300` came back as `¥ 4,300`, and the `1000 ml` line disappeared;
- `€ 32,99 / L` came back as `€3299/L` (decimal comma lost).

The rupee tag produced **no price at all**: `¥` wasn't a known currency, and `4,300` without decimals
looked like a bare integer, which the parser skips to avoid ABVs, years and article numbers.

**Fix.**
1. Treat any currency-like symbol (including `¥`) as "this is money", even if we can't map it, and
   fall back to the airport's currency.
2. Accept a bare integer when its line says it's a price (`Now`, `Was`, `Our price`).
3. The per-litre amount was already excluded by its `/L` suffix, so the lost comma didn't matter.
4. Captured the real OCR strings as regression tests.

**Lesson.** Test parsers on the *actual* upstream output, not on what you imagine it looks like.
Cheap way to get it: render synthetic inputs and run the real engine once.

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
