# Problems and resolutions log

A running record of the non-obvious problems hit while building this, how they were diagnosed and
fixed, and the lesson. Newest first. Each entry is written so it can be told as a story in an
interview: **situation → investigation → fix → what I'd do differently**.

---

## #14: The partner wouldn't answer, so we found who else had the data (2026-11-13)

**Situation.** BLR's shop (shopdutyfree.com, run by Avolta) intermittently blocks our scraper, and
the email asking Avolta for a feed went nowhere. No affiliate programme covers India.

**Investigation.** We stopped treating it as a technical problem and asked who else legitimately has
this data, and why. The public record showed BLR duty free is a 50:50 joint venture of Avolta and BIAL, the airport.
The airport's website lists the same catalogue. The browser's Network tab showed it loads from BIAL's own product API, and
`merchantId: "dufry"` plus Avolta's SAP numbers proved the catalogue is synced into BIAL's platform
rather than scraped. The JSON was ideal, but it also returned staff names, phone numbers and emails on every
product, and the API host's robots.txt appears to turn crawlers away.

**Fix.** ADR-0012: don't use the API yet. Write down the gates it must pass (robots, terms, no header spoofing,
PII-free field whitelist, two calls a day), report the data leak to BIAL, and make crowd and admin photo
reports the primary BLR source so nothing waits on a partner.

**Lesson.** When a source fights you, map who owns and distributes the data before engineering around it.
Decide the "is this allowed?" criteria *before* you see how convenient the data is. A clean JSON API is
exactly when you're most tempted to rationalise.

---

## #13: The daily scrape "failed" because Akamai refused GitHub's runner (2026-11-11)

**Situation.** The first scheduled run saved 0 BLR prices and went red. The log said
`robots.txt disallows …` for all 9 categories, which reads as if the shop had banned crawling.

**Investigation.** The earlier live-check logs print the robots.txt response body. Every 403 was
Akamai's "Access Denied" page (`errors.edgesuite.net` reference), not a robots file. Lining up
yesterday's runs showed 403 and 200 alternating hour by hour (15:13 403, 15:34 200, 15:58 403,
16:17 200, …), with a different runner IP each time. So it is an edge block that scores some
datacenter IPs (or our traffic from them) as bots, not a rule the shop wrote. I couldn't test
from the dev sandbox: the network policy doesn't allow that host there.

**Fix.** A refusal is now its own error, `SiteBlocked`, named after the bot wall's fingerprints.
We stop asking that site for the rest of the run, log one clear line, and show a warning
annotation on the run page. A blocked site no longer fails the job; only our own bugs do. We
don't retry or switch IPs to get through (ADR-0011).

**Lesson.** One status code can mean two things: "no robots.txt" (RFC 9309: crawl) versus "the
edge is refusing you" (stop). Read the body before deciding what a 403 means. Logs should say
what happened in the outside world, not which branch the code took.

---

## #12: Every BLR category was fetched twice (2026-11-10)

**Situation.** A healthy run saved 218 prices, but the log showed `page 2` returning exactly the
same count as `page 1` in all 9 categories (whisky 42/42, vodka 38/38, …). Spotted while another
thread was reading the deploy log.

**Cause.** The adapter always built `?p=N` for the next page. BLR shows a whole subcategory on one
page and ignores `?p`, so page 2 was page 1 again. The crawl's "no new products" check did stop
there, so no data was wrong, but each run made 9 wasted requests. At the shop's 30 s crawl delay
that is about 4.5 extra minutes and twice the traffic, which can't help with the Akamai rate-limit
block in #9. The log line also counted products before de-duplication, which hid what happened.

**Fix.** Only follow a pager the page actually renders (`rel="next"` or Magento's
`.pages-item-next a`). No pager means one page. The log now prints `N products, M new`.

**Lesson.** A guard that stops a loop ("no new items") is a safety net, not a design: it still
pays for one wasted request per loop. Ask the page whether there is a next page instead of guessing
the URL. And log the number that the decision is based on.

---


## #11: The full BLR crawl fetched 230 bottles, then the save failed with a 500 (2026-11-10)

**Situation.** After switching BLR to per-category crawling, a run fetched all 9 categories and
then `POST /products?on_conflict=match_key` returned **500**. The log had no detail.

**Cause.** The crawl de-duplicated against products *from earlier pages*, but not *within* a
page. When two listings normalize to the same `match_key` (the same bottle listed twice, say
plain and gift-boxed), both went into one upsert. Postgres refuses an `INSERT … ON CONFLICT DO
UPDATE` that touches the same row twice (`21000 cardinality_violation`), and PostgREST maps that
error class to HTTP 500.

**Fix.** De-duplicate per page in the crawl loop and again in `save_prices` (defence in depth),
and include PostgREST's error body in the exception so the next 500 is diagnosable from the log.

**Lesson.** Upserts need unique keys *within the batch*, not just against the table. And an
error without its body costs a full re-run (here, 10 minutes of polite crawling) to diagnose:
always log what the server said.

---

## #10: The auto-screenshot vanished before the form could show it (2026-11-10)

**Situation.** The "Report a problem" button takes a screenshot, parks it in a module variable,
then navigates to the form, which takes it with `takeCapture()` (read once, then cleared, so an
old picture can't leak into a later report). In the browser test the form always showed no
screenshot, and nothing was logged, so the capture itself had worked.

**Investigation.** No warning from `captureCurrentScreen()` meant it returned an image. So the
hand-off was the suspect. The form read the capture inside a `useState` initializer. A log line
in that initializer printed **four times** for one tap, even in the production web build: Expo
Router mounts the modal screen more than once while it sets up the route, and each mount runs the
initializer again. The first mount took the screenshot and cleared it; the mount that stayed on
screen found nothing.

**Fix.** Make the read idempotent: `recentCapture()` returns the stashed screenshot without
clearing it, and it expires 30 seconds after the tap instead. The stale-picture risk is still
covered, but by time rather than by "read once". A unit test pins the behaviour, and the browser
check now shows the screenshot.

**Lesson.** "Consume on read" is a hidden side effect, and React is allowed to run initializers and
mount components more often than you expect (Strict Mode does it on purpose in development). Make
reads pure and put the expiry somewhere explicit. It's the same reasoning as idempotent HTTP GETs.

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
   "no rules, allow all". Python's `robotparser` treats 401/403 as **disallow all**, and so do we
   now. (Correction, 2026-11-11: Google and RFC 9309 actually treat any 4xx as "allow". See #13
   and ADR-0011 for why our case is different.) The live check also runs only when adapter code changes, since
   every run is real traffic to the shop.
5. **Pagination:** Magento ignores `?p=2` without JavaScript, so page 2 repeats page 1 and the
   crawl stops (by design). Each subcategory page already lists all its bottles (whisky has 42),
   so crawling subcategories rather than "view all" is what gets the full catalogue.

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
