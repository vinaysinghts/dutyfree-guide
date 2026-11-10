# Problems and resolutions log

A running record of the non-obvious problems hit while building this, how they were diagnosed and
fixed, and the lesson. Newest first. Each entry is written so it can be told as a story in an
interview: **situation → investigation → fix → what I'd do differently**.

---

## #9: First contact with the live shop sites (2026-11-09)

**Situation.** The adapters had been written blind (#4). A new `dutyfree-scrape probe` command,
run by the **Scraper live check** workflow from GitHub's runners, fetched every category page and
logged what came back. Three rounds, about five minutes each, because BLR's robots.txt asks for
30 s between requests.

**What we learned.**
1. **BLR (Avolta, Magento):** every guessed category URL was a 404. The probe also logs the
   home page's liquor links, which showed the real listing: `/en/92/wines-spirits/view-all-liquor`
   (92 is the store id).
2. That page had 40 product cards, but we parsed 0. Logging one card's HTML showed why:
   `[data-product-id]`, our first card selector, sits on the *price box*, not the card, so no
   "card" had a name. Fix: select `li.product-item`, read the `finalPrice` amount (the sale price,
   not the crossed-out one), and take the product link rather than the first `<a>` (a wishlist
   button with `href="#"`). Sizes missing from a name come from the URL slug (`…-20cl`).
3. **AMS (Schiphol):** every request got `403` with `cf-mitigated: challenge`, Cloudflare's
   JavaScript bot check. Getting past it would mean pretending to be a browser to defeat a
   deliberate block, which ADR-0004 rules out. AMS needs another source (crowd reports, the
   operator's own shop, or a data partnership).
4. **Then BLR started refusing us too.** About 25 minutes and four probe runs later (roughly 25
   requests, 30 s apart), Akamai (`server: AkamaiGHost`) answered `403 Access Denied` to every
   request, robots.txt included. That exposed a bug: `PoliteClient` treated a 403 on robots.txt as
   "no rules, allow all". The convention (Python's `robotparser`, Google) is that 401/403 means
   **disallow all**, and it does now. The live check also runs only when adapter code changes, since
   every run is real traffic to the shop.

**Lesson.** When you can't see the target, build the instrument first. A probe that logs status,
bot-wall headers, real links and one sample of markup turned "0 products" into three specific,
fixable causes. Also read headers before guessing: `cf-mitigated` says "blocked on purpose",
which is a policy question, not a bug.

---

## #8: Basel airport couldn't be found (2026-11-09)

**Situation.** A user searched for Basel and got nothing.

**Investigation.** Two separate causes:
1. The APK has no Supabase keys, so it ran in **demo mode**, which only knew 10 hard-coded airports.
2. Even against the database, search only matched IATA + name + city, as typed. Looking at the
   OurAirports row for Basel shows why that's fragile: it's `BSL`, in France, named
   "EuroAirport Basel–Mulhouse–Freiburg" (en dashes), city "Bâle / Mulhouse", with `MLH, EAP, Basle`
   only in `keywords`. The same pattern hits common searches: "Bangalore" (BLR) and "Bombay" (BOM)
   exist only in keywords, "Sao Paulo" missed "São Paulo", "basel mulhouse" missed the dashes.

**Fix.**
- Keep `icao` and `keywords` from OurAirports, and **fold** accents and punctuation on both the data
  and the query (SQL `search_fold()` via `unaccent`, and the same `fold()` in TypeScript).
- Require every query word to match, and rank exact codes first (§3.7 of the LLD).
- Bundle the full list (3,245 airports) with the app and search it on the device in every mode.
- Tests cover Basel by 12 different queries, plus Bangalore, Bombay, Zürich and São Paulo.

**Lesson.** Real-world identifiers have aliases, and users type the one *they* know. Test search
with the queries people actually type, taken from the real data, not just the canonical name.
A generated column can't call a STABLE function like `unaccent()`; the standard fix is an
IMMUTABLE wrapper that pins the dictionary.

---

## #7: APK build failed before compiling anything (2026-11-09)

**Situation.** The first runs of the new Android APK workflow failed early, for reasons that had
nothing to do with our code.

1. **`setup-java` with `cache: gradle` errored.** It looks for `**/*.gradle*` to build a cache key,
   but with Continuous Native Generation `android/` doesn't exist until `expo prebuild` runs, later
   in the job. **Fix:** drop the cache option there and add `gradle/actions/setup-gradle` *after* prebuild.
2. **The Gradle wrapper got HTTP 504** downloading `gradle-9.4.1-bin.zip`. It failed again on a re-run
   a minute later. Tracing the URL: `services.gradle.org` redirects to a GitHub release asset, and that
   hop was timing out intermittently (the same URL returned 206 when probed later from elsewhere).
   **Fix:** a dedicated "Download Gradle" step that retries `./gradlew --version` up to 5 times with
   growing back-off, before the real build. `setup-gradle` then caches the distribution, so later runs
   don't depend on that download at all.
3. **Then the build itself got a 504** fetching `kotlin-compiler-embeddable-2.2.0.jar`: Maven Central
   redirected to a JetBrains GitHub release asset, the same flaky host. **Fix:** raise Gradle's
   per-download retries (`org.gradle.internal.repository.max.retries=8`, 2 s initial back-off) and
   re-run the build up to 3 times. Completed downloads stay in Gradle's cache, so each retry only
   fetches what's still missing.
4. **Retries weren't enough.** After merge, the build hit the same 504 on
   `kotlin-compiler-embeddable-2.2.10.jar` (a different Kotlin version pulled in by
   `react-native-screens` and `react-native-safe-area-context`) on every retry. Retrying a host that's
   down for minutes doesn't help; going around it does. From a different network, Maven Central served the 56 MB jar
   directly, but from GitHub's runners it redirected large JetBrains jars to GitHub release assets.
   **Fix:** a Gradle init script (`.github/gradle/maven-mirror.gradle`, installed into
   `~/.gradle/init.d/`) puts Google's Maven Central mirror
   (`maven-central.storage-download.googleapis.com`, served from Google Cloud Storage, no redirect)
   *first* in every project's repository list. Gradle tries repositories in order, so Maven Central
   is only a fallback. Verified locally: the jar resolves from the mirror URL.

**Lesson.** Order matters in CI: a step can't key a cache on files a later step generates. And any
build that downloads tools at runtime needs retries *and* a cache, because the download is a network
dependency like any other. When one upstream keeps failing, retries only add delay: add a second
source (a mirror) so the build doesn't depend on that host at all.

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
