# Problems and resolutions log

A running record of the non-obvious problems hit while building this, how they were diagnosed and
fixed, and the lesson. Newest first. Each entry is written so it can be told as a story in an
interview: **situation → investigation → fix → what I'd do differently**.

---

## #20: The function we "revoked from public" was callable by anyone (2026-11-13)

**Situation.** Asked "if someone decompiles the APK, can they hack the backend?" The quick answer
(the key is public by design, RLS is the boundary) is true but untested, so we audited it: pulled
the live APK apart, and checked every table, policy, function and bucket as the API roles see them.

**Investigation.** The APK held only the URL and the publishable key (the `sb_secret_` and
`github_pat_` hits were supabase-js's guard and our own redaction regex). Every table had RLS. The
interesting part was functions. `claim_issue_report`, which leases a problem report for the Edge
Function, is `SECURITY DEFINER` (it bypasses RLS), and its migration said
`revoke execute ... from public`. That reads like "only the service role can call it". It isn't:
Supabase's default privileges grant EXECUTE on every new `public` function **directly** to `anon`
and `authenticated`, and revoking from `PUBLIC` doesn't remove a direct grant. Recreating those
grants in a scratch Postgres, `set role anon; select * from claim_issue_report(1)` returned another
user's report and set it to `filing`. Looping over ids every 5 minutes would have burned every
report's 5 attempts in ~25 minutes, silently stopping all problem reports from reaching GitHub.

Why CI missed it: the SQL tests ran as the superuser (which ignores grants and RLS), and the test
stubs had none of Supabase's grants. The test environment couldn't express the bug.

The same pass found smaller gaps: a price report could carry forged reviewer fields, someone
else's photo path, or a 2099 date (an approved price would then stay "latest" forever); and
nothing rate-limited price reports or photo uploads, which took any file type up to 50 MiB.

**Fix.** Migration `20261113030000_harden_data_api_access.sql`: revoke the function from `anon`
and `authenticated`; a `BEFORE INSERT` trigger on price reports that resets server-owned fields,
checks the photo folder and dates, and allows 30 reports/hour; bucket size and image-type limits;
upload rate limits in the storage policies. The test stubs now recreate Supabase's grants, and
`60_access_control.sql` runs as `anon`/`authenticated` with three guardrails: RLS on every table,
an allowlist of `SECURITY DEFINER` functions the API roles may call, and `security_invoker` on
every view. Run against the old migrations, it fails and names `claim_issue_report`.

**Lesson.** "Revoke from public" is not "nobody else": privileges are additive, so check what was
granted *directly*, and know your platform's default grants. More generally, a security test that
runs as superuser proves nothing; test as the role the attacker gets. Writeup:
[docs/security.md](security.md), decision: [ADR-0017](adr/0017-data-api-access-model.md).

---

## #17: "Remind me when I'm at the airport" turned out to need the scariest permission (2026-11-13)

**Situation.** In review, the obvious improvement came up: fire the reminder when the phone is
*at* the airport, not at a time we guessed from the flight. It's more accurate, and it works with
no dates entered.

**Investigation.** To wake an app that isn't running when you enter a place, you need an OS
geofence, and that needs "Allow all the time" location. Tracing it through: Android 11+ won't even
show that as a dialog (we'd have to send people to Settings). Declaring the permission puts the
app through Google Play's background-location review, which requires the use to be "core
functionality", and it would apply to every install, not only those who opt in. A 3 km circle also
fires at the kerb, an hour before the traveller reaches the shop. I had started building it (a
background task, plus merging the reminder history from two writers) before the trade-off was
clear. The product owner then made the call: *don't ask for Always; check location whenever the
app is opened.*

**Fix.** While-in-use location on every open or foreground, matched against **all** ~3,200
airports. If one is within 5 km, show "📍 You're at DXB". The time-based reminder is what gets the
app opened, and location confirms where they are. A one-time explainer card asks for permission.
Someone who lives next to an airport stops seeing it after two "Not this time" taps on different
days. The half-built geofence code was thrown away, not merged "for later".

**Lesson.** List the permission and store-review costs *before* the code: the platform's
permission model can rule out an idea that is technically easy. And the cheaper design kept most
of the value: the reminder gets people to open the app, and a while-in-use check covers the rest.

---

## #16: The reminder history could forget it had already asked (2026-11-13)

**Situation.** Travel-day reminders keep a small history on the phone: what was scheduled, and
whether each one was opened or ignored. Two rules depend on it: "one reminder per airport per
date, ever" and "stop after three ignored in a row". The first draft of `recordScheduled` replaced
the pending entries with whatever the planner returned this time.

**Investigation.** I walked through a timeline. BLR's reminder fires at 08:00. At 08:30 the
traveller opens the app and edits the trip. The planner leaves BLR out, correctly, because its time
has passed. But `settle` only marks a reminder "ignored" two hours after it fires. So at 08:30 the
BLR entry was still `pending` and not in the new plan, and it got deleted. Result: the back-off
never counted it, and if the traveller then moved the flight time later, BLR would be asked
*again*. That's the nagging the limits exist to prevent. A second trap was in the React wiring: the
effect that reconciles reminders writes the history, so making it depend on `history` would re-run
it forever.

**Fix.** `recordScheduled(history, planned, now)` now drops only *future* pending entries that
are no longer planned. Anything whose time has passed is kept until `settle` judges it. A unit
test reproduces the 08:30 edit. The effect depends on just the parts of history a person changes
(number of reports, number of dismissals), with a comment saying why.

**Lesson.** When state has a lifecycle (`pending → opened | ignored`), list the transitions and ask
what happens in the gap between two of them. Bugs live in the windows: here, the two hours between
"fired" and "judged". Pure functions made this cheap to find and to pin with a test: no simulator,
no waiting for a real notification.

---

## #15: "09:40 at Dubai" while the phone is on India time (2026-11-13)

**Situation.** Travel-day reminders need an exact instant: "75 minutes before your DXB flight".
People type their flight in local airport time, usually days before, at home. JavaScript's `Date`
only understands the phone's own zone and UTC. Reading 09:40 as phone time would fire 1.5 hours
late for Dubai, and 4.5 hours early for Amsterdam. Our airport data had no time zones at all.

**Investigation.**
- *Where to get zones.* OurAirports (our airport source) has no zone column. Working out a zone
  from latitude and longitude needs zone-boundary maps (megabytes). The MIT-licensed
  `airportsdata` package maps IATA → IANA zone. It covered 3,192 of our 3,245 airports by IATA,
  and 15 more by ICAO. The 38 left were mostly small Chinese fields. China has one zone, so "if
  every known airport in the country shares one zone, use it" fixed 35. The last 3 are in
  multi-zone countries: we leave them blank and fall back to the phone's zone, rather than guess.
- *Converting without a library.* `Intl.DateTimeFormat` can show an instant in any zone but can't
  build one. Inverting it takes two passes, because the offset depends on the answer around DST
  (LLD §3.9). I wrote tests for the DST gap and overlap in Amsterdam, plus India's +5:30 and
  Nepal's +5:45.
- *My own test was wrong.* I asserted that 23:30 UTC on the 19th is "still the 19th in
  Amsterdam". It's 00:30 on the 20th there. The code was right and the test was wrong, which is
  exactly the mistake this feature exists to prevent. The test script now pins `TZ=Asia/Kolkata`,
  so every run has phone zone ≠ airport zone, as in real use.
- *Rebuilding the bundle.* The dev sandbox can't reach OurAirports (proxy 403). So the time-zone
  column was added to the existing `airports.json` with the same `TimeZoneLookup` that
  `dutyfree-scrape airports --export` now uses. The next full export produces the same column.

**Fix.** Bundle column 10 = IANA zone. `airportTimeZone(iata)` looks it up. Trip dates and times
are stored as airport-local strings and turned into instants only when scheduling. A scheduled
reminder is an absolute instant, so the phone switching zones on landing doesn't move it.

**Still to verify on a device.** Hermes (React Native's JS engine) must support `Intl` with
`timeZone` on both platforms. If it doesn't, `offsetMinutes` falls back to the phone's zone. That
fails safe (no crash), but reminders would be off by the zone difference. First check on the next
APK: set a DXB time from India and look at the scheduled time.

**Lesson.** Store human time as the human said it (local date, local time, *and where*), and convert
at the edge where you need an instant. A UTC timestamp throws away the "where", and you need the
"where" again the moment you show it back to the traveller.

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

**Fix.** ADR-0013: don't use the API until it passes written gates. It then failed them: the gateway answers "Unknown Origin" to anything but BIAL's own site, so using it would mean spoofing the Origin header. The gates were robots, terms, no header spoofing,
a PII-free field whitelist and two calls a day. We report the data leak to BIAL and make crowd and admin photo
reports the primary BLR source, so nothing waits on a partner.

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

## #11: Problem reports never reached GitHub, and the retry budget hid why (2026-11-13)

**Situation.** A report sent from a phone never turned into a GitHub issue, even after the
`ISSUES_GITHUB_TOKEN` secret was added. The app had said "saved", and every sync run was green.

**Investigation.** We read the sync job's output (it prints the function's JSON) run by run:
1. 2026-11-10/11: `"status":"pending","reason":"GitHub filing is not configured yet"`. Expected:
   the secret wasn't set at deploy time, and only a deploy copies it to the function.
2. 2026-11-11 18:41, after a deploy with the token: `GitHub 403: Resource not accessible by personal
   access token`. The token existed but couldn't create issues on this repo (a fine-grained token
   needs this repository selected **and** Issues: Read and write).
3. From then on: `{"checked":0}`. The reports had used up their 5 attempts on the 403 and dropped
   out of the sweep. The job stayed green because there was nothing left to try.

Also visible: the "hourly" schedule actually ran every 4 to 8 hours (GitHub delays scheduled
workflows on quiet repos), so "posted within the hour" in the app was wrong too.

**Fix.**
- The function now tells **setup errors** (GitHub 401/403/404: our token or repo is wrong) from
  **report errors**. A setup error gives the attempt back and leaves the report `pending`, so it files
  as soon as the token is fixed. Only other failures count towards the 5-attempt limit.
- A one-off migration resets reports that burned their attempts on those errors.
- The deploy workflow now sweeps right after setting the secrets and **fails loudly** if GitHub
  rejects the token, so a bad token shows up the moment it's configured instead of days later.
- The app says "shortly" instead of "within the hour".

**Lesson.** A retry budget is for transient failures. Spending it on a configuration error turns a
loud, fixable problem into silent data loss. Classify errors before retrying (who is at fault:
us, the input, or the network?), and check configuration where it's set (fail the deploy), not
where it's first used. Also, "green" only means something if the job fails when work is stuck.

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
