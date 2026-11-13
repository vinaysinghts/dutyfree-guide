# Low-level design (LLD)

> **What an LLD is for:** the next level down from the [HLD](hld.md): data model, module
> boundaries, interfaces and algorithms, at the level where a reviewer can spot a bug before it's
> written. When the code and this doc disagree, fix one of them in the same PR.

## 1. Repository layout

```
client/            Expo app (web + iOS + Android)
  app/             screens; Expo Router maps files to routes
  components/      UI building blocks (no data access)
  lib/             types, data access (api.ts), pure logic (compare.ts), state (trip.tsx)
scrapers/          Python package `dutyfree_scrapers`
  adapters/        one class per retailer platform
supabase/
  migrations/      schema as SQL, applied in filename order
  tests/           SQL tests run against plain Postgres in CI
docs/              HLD, LLD, ADRs, problems log
```

**Dependency rule:** `app/` → `components/` + `lib/`; `components/` never call Supabase; only
`lib/api.ts` knows Supabase exists. That single seam is what lets the app run on demo data, and
later lets us swap the backend without touching screens.

## 2. Data model

```
airports (iata PK) ──< retailers (airport_iata) ──< prices >── products (match_key UNIQUE)
                                                        │
                    price_submissions ──(approved)──────┘   fx_rates (currency PK)
trips ──< trip_airports (trip_id, position) >── airports
admins (user_id)
issue_reports (reporter → auth.users)   storage: issue-screenshots/<uid>/<report folder>/<n>.jpg
```

| Table | Why it exists / notable choices |
|---|---|
| `airports` | From OurAirports, with `icao` and `keywords` (alternate names and codes). `search_text` is a **generated column** (`search_fold`: accents and punctuation removed) + trigram index. The app searches its bundled copy of the same list (§3.7). |
| `retailers` | A shop at an airport. `adapter` says which scraper collects it; null = crowd-only. Many airports share an adapter (Avolta's platform). |
| `products` | Canonical bottle. `match_key` = normalized brand+name+volume; UNIQUE so upserts dedupe. |
| `prices` | **Append-only** history (never updated). Gives price charts later for free and makes scrape runs idempotent-ish. |
| `latest_prices` (view) | `DISTINCT ON (product_id, retailer_id) … ORDER BY observed_at DESC` = the newest row per pair, converted to INR. `security_invoker` so RLS still applies. |
| `fx_rates` | INR per 1 unit. One row per currency, overwritten daily. |
| `price_submissions` | Review queue. Typed fields are optional when `photo_path` is set (CHECK `photo_or_details`). Stores `ocr_text`, `ocr_draft`, capture coordinates, `photo_taken_at`, and the trigger-computed `distance_km` / `location_check`. `via` (`manual` / `nudge_card` / `nudge_notification`) records what started the report, to measure travel-day nudges (§3.10). Partial index on `status='pending'` keeps the queue query fast. |
| `admins` | Membership table read by `is_admin()`. |
| `issue_reports` | In-app problem reports, used as an **outbox** for GitHub issues (§3.8). Client writes `category`, `description`, `screenshot_paths`, `context` (jsonb, ≤ 16 KB). The function owns `status` (`pending → filing → filed`/`failed`), `attempts`, `claimed_at`, `last_error`, `github_issue_number/url`. Partial index on unfiled rows for the sweep. |

### Row level security (RLS)

The app talks to the database directly with a **public** anon key, so RLS is the authorization layer:

| Table | anon/authenticated can… |
|---|---|
| catalogue tables, `prices`, `fx_rates` | read |
| `price_submissions` | insert own rows (status forced to `pending`), read own; admins read all |
| `trips`, `trip_airports` | full access to own rows only |
| storage `submission-photos` | upload into `<uid>/…`, read own; admins read all |
| `issue_reports` | insert own (trigger forces server fields, 5/hour), read own; admins read all; no update/delete (service role only) |
| storage `issue-screenshots` | upload into `<uid>/…`, read own; admins read all |

Writes to the catalogue only happen with the scraper's **service-role** key (bypasses RLS) or via
`review_submission()` (`SECURITY DEFINER`, checks `is_admin()` first).

## 3. Key algorithms

### 3.1 Product matching: `normalize.match_key(name, brand, volume_ml)`
1. Remove volume text ("70cl", "1 Ltr").
2. ASCII-fold, lowercase, split into words; drop category noise words (`whisky`, `blended`, `scotch`…) and repeats.
3. Normalize age statements: "12 Year Old" / "12 years" / "12yo" → `12yo`.
4. Append `|<volume_ml>` so 70cl and 1L never match.

`"Johnnie Walker Black Label 1L"` and brand `JOHNNIE WALKER` + `"Black Label Blended Scotch Whisky 100cl"` → both `johnnie walker black label|1000`.
Known limits: see [ADR-0005](adr/0005-product-matching.md).

### 3.2 Ranking: `client/lib/compare.ts → rankProducts(rows)`
- Group rows by `product_id`.
- Per product, keep **one offer per airport** (the cheapest of shop vs traveller report).
- Sort offers by `price_inr` ascending; tie → scraped beats crowd → fresher wins; unknown INR sorts last.
- `savingInr` = dearest priced offer − cheapest (null if < 2 priced airports).
- `missing` = trip airports with no price for the bottle, so the card can list every airport (ADR-0010).
- `minAirports` (UI: "Only bottles at 2+ airports") hides bottles that can't be compared.
- Sort products by their best offer.
- Complexity O(n log n) in rows; pure function, unit tested (`npm test`).

### 3.3 Scraper crawl loop: `Adapter.crawl(client)`
```
for each category URL:
  page = 1
  while page ≤ max_pages:
    html = client.get(url)          # robots.txt checked, ≥5 s between requests
    products = JSON-LD first, else adapter CSS fallback
    new = products not seen yet
    if no new products: stop        # handles sites that ignore ?page=N
    yield new
    url = rel=next link or ?page=N+1
```
**Why JSON-LD first:** schema.org `Product` data exists for Google Shopping, so retailers keep it
stable; CSS class names change with every redesign.

### 3.4 Shelf-tag parsing: `client/lib/shelfTag.ts → parseShelfTag(ocrText, {defaultCurrency})`
1. Split OCR text into lines.
2. Find every money-looking amount: an optional currency symbol or code, a number in any common
   format (`32,99`, `3,450`, `3.450,00`), and an optional trailing symbol. Skip bare integers unless the
   line says it's a price (`Now 4,300`), and skip amounts followed by `%`, `ml`, `cl` or `years`.
3. Classify each amount by its neighbours: `per_unit` (`/L`, `per 100ml`), `multibuy` (`2 for`),
   `was` (`was`, `RRP`, `MRP`, `high street`), `now` (`now`, `our price`), else `price`.
4. Choose: the lowest `now`; otherwise the lowest plain `price`, preferring ones with a currency
   (a duty-free tag that shows two plain prices is nearly always "high street vs ours").
5. Size: the last volume token. Brand: the longest known-brand match, ignoring accents and apostrophes.
   Product: the text after the brand on its line, else the next line.
6. Confidence = 0.45 price + 0.15 currency + 0.15 size + 0.15 brand + 0.1 product. Under 0.6, the form opens for review.

Platform OCR sits behind one function, `readText(uri)`: `ocr.ts` (ML Kit) and `ocr.web.ts`
(Tesseract); Metro picks the file by platform extension. The parser never knows which engine ran.

### 3.5 Location check (DB trigger `price_submissions_check_location`)
On insert, or when the airport or coordinates change: haversine distance from the capture point
to the airport, giving `at_airport` ≤ 5 km, `near` ≤ 50 km, else `far`; no coordinates gives `unknown`.
The trigger also fires when a client tries to write `location_check` directly, so the client can't
choose the verdict. `nearest_airports(lat, lon)` filters to a ±1° latitude band before computing
distances, then sorts.

### 3.6 Review: `review_submission(p_submission_id, p_approve, p_note, p_existing_product_id)`
Refuses to approve until product, price and currency are filled in (OCR may have left gaps). Locks the row (`FOR UPDATE`) so two admins can't double-approve; rejects non-pending; on approve,
links to the given product or creates one, upserts the airport's "Reported by travellers"
retailer and inserts a `prices` row with `source='crowd'`.

### 3.7 Airport search: `client/lib/airportSearch.ts → searchAirportList(airports, query)`
Airports go by several names and codes: Basel's EuroAirport is BSL, MLH and EAP and "Bâle" in French;
Bengaluru is "Bangalore" to most travellers. So:
1. **Fold** both sides: NFKD, strip accents, lowercase, punctuation → spaces (`Basel–Mulhouse` → `basel mulhouse`).
   SQL `search_fold()` does the same, so the database and the app agree.
2. Search text = IATA + ICAO + name + city + OurAirports `keywords`.
3. **Every** query word must appear (`basel airport` works; word order doesn't matter).
4. Score: exact IATA 1000, other code (ICAO, MLH) 600, word starts the city 60, starts any word 40,
   substring 10; large airports +5 on ties.

**Where it runs:** on the device, over the bundled list (`assets/airports.json`, 3,245 airports,
320 KB, 130 KB gzipped). Airports are static reference data, so a local search is instant, works
offline at the gate, and has no per-keystroke API cost. Regenerate with
`dutyfree-scrape airports --export ../client/assets/airports.json`. Trade-off: a new airport needs
an app update; acceptable, since airports open a few times a year.

### 3.8 Problem reports → GitHub issues (ADR-0010)

**Client** (`components/ReportIssueButton.tsx` → `app/report-issue.tsx` → `lib/api.ts submitIssueReport`)
1. Button: `captureCurrentScreen()` *before* navigating; `stashCapture({uri, screen: pathname})`.
   The form reads it with `recentCapture()` (not consumed on read, expires after 30 s; see problem #10).
2. `collectContext(screen, tripIatas)` (`lib/deviceContext.ts`) → `shareableContext()` applies the
   user's opt-outs. The form renders the exact JSON that will be sent.
3. `submitIssueReport`: upload screenshots → `insert … returning id` → `functions.invoke('file-issue',
   {report_id})`. Returns `filed` (with the issue URL) or `pending` (saved, sweep will file it).
   Order matters: the row is written before the side effect, so a failure after step 2 loses nothing.

**Database** (`20261110010000_issue_reports.sql`)
- `issue_reports_before_insert` trigger: resets server-owned fields, rejects screenshots outside
  `<reporter>/`, raises `P0429` after 5 reports in an hour.
- `claim_issue_report(id)`: the lease. One `UPDATE … SET status='filing', attempts+1 WHERE id=$1 AND
  attempts<5 AND (status IN ('pending','failed') OR (status='filing' AND claimed_at < now()-5 min))
  RETURNING *`. Row-level locking makes it atomic: of two concurrent callers, exactly one gets a row.
  Executable by `service_role` only.

**Edge Function** (`supabase/functions/file-issue/`, Deno)
- `index.ts`: `POST {report_id}` with the user's token → `auth.getUser(token)` → owner check →
  `fileReport`. `POST {sweep:true}` with `SYNC_TOKEN` → up to 20 unfiled reports older than 2 min.
  `fileReport`: already filed? return it → no token? `pending` → claim → sign screenshot URLs (1 year)
  → `buildIssue` → GitHub `POST /repos/{repo}/issues` (retry without labels on 422) → `filed` or
  `failed` + `last_error`.
- `issue.ts` (pure, unit-tested under both Node and Deno): title `[App] Bug (/prices): first line…`;
  body = description, screenshots as `<img width=320>`, context table, recent logs in a
  `<details>` block with a fence longer than any backtick run inside, and the
  `<!-- app-report:<id> -->` marker. `neutralize()` breaks `@mentions` with a zero-width space.

### 3.9 Airport time → instant: `client/lib/zonedTime.ts → zonedToInstant(date, time, tz)`

The problem: "09:40 on 20 Nov at DXB" must become an exact instant while the phone sits in India
time. JS can *display* an instant in any zone (`Intl.DateTimeFormat({timeZone})`) but can't
*construct* one from a zone, so we invert the display function:

```
wall   = Date.UTC(2026, 10, 20, 9, 40)        // pretend the wall clock is UTC
off1   = offset(tz, at = wall)                // e.g. +240 min for Asia/Dubai
t      = wall − off1
off2   = offset(tz, at = t)                   // re-check: DST may differ at the real instant
if off2 ≠ off1: t = wall − off2
offset(tz, at) = (the wall clock Intl shows for `at` in tz, read back as UTC) − at
```

- **Why two passes:** the offset depends on the instant we're solving for. One pass is wrong for
  the hour around a DST change.
- **Gap** (spring-forward, 02:30 doesn't exist): lands on 03:30 local. Later, never earlier, which
  is the safe side for a reminder. **Overlap** (02:30 happens twice): one of the two, both valid.
- **Unknown zone or no `Intl` zone data** → `offsetMinutes` falls back to the phone's zone. Wrong by
  the zone difference, but never crashes.
- Tested with Dubai (+4), India (+5:30), Nepal (+5:45), and Amsterdam summer, winter, gap and overlap.
  The test script pins `TZ=Asia/Kolkata`, so "phone zone ≠ airport zone" is always exercised.
- Zones come from the bundle's 10th column (`airportTimeZone(iata)` in `lib/airports.ts`), built by
  `TimeZoneLookup` in `scrapers/load_airports.py`: IATA → ICAO → the country's only zone → "".

### 3.10 Travel-day nudges (ADR-0014)

```
 trip.airports + trip.plans ──▶ stops[] {iata, date?, time?, tz}
                                   │
  history (on device) ──settle()──▶ planNudges(stops, history, now, enabled) ──▶ PlannedNudge[]
                                   │                                              │
                                   │                         reconcileReminders() ▼ (native only)
                                   │                OS scheduled notifications (kind = travel-nudge)
                                   ▼
             activeNudge(stops, history, now, hereIata) ──▶ <TravelDayCard/>  (all platforms)
                                                                │ tap
 tapped reminder ──onReminderOpened──▶ recordOpened ──┐         ▼
                               /report?airport=DXB&snap=1&via=nudge_card|nudge_notification
                                     │ camera opens (native), airport pre-selected
                                     ▼ submit
                     price_submissions.via, travelDay.snapped(iata) → recordSnap
```

**`planNudges`**: pure, idempotent.
1. Return `[]` if reminders are off, or `ignoredStreak(history) ≥ 3`.
2. For each stop with a valid date: `fireTimeFor` = departure − 75 min if there's a time, else
   08:00 airport time. Skip if it's in the past, or that `iata:date` already fired or was dismissed,
   or the traveller reported at that airport within 7 days of the fire time.
3. Rank: `flight`-kind first, then trip order. Pick greedily: skip if the date already has 2, or
   another pick is within 3 h. Stop at 4.

**`settle(history, now)`**: pending events whose `fireAt + 2 h < now` become `ignored`.
**`ignoredStreak`**: count fired events newest first, stopping at an `opened` one or one older than
the last snap. **`recordScheduled(history, planned, now)`**: adds new or retimed pending events and
drops future pending ones that are no longer planned. It keeps ones that already fired, even if
not settled yet: dropping them would forget we asked (and a test covers this).

**`reconcileReminders(planned)`** (`lib/notifications.ts`): list scheduled notifications where
`data.kind = 'travel-nudge'` → cancel any whose id isn't planned or whose `data.fireAt` changed →
schedule the rest with `identifier = 'nudge:<IATA>:<date>'` and a `DATE` trigger on the
`travel-day` Android channel. A stable identifier means re-running it can't double-book.

**`TravelDayProvider`** (`lib/travelDay.tsx`) owns the state and side effects:
- AsyncStorage keys `nudge.prefs.v1` (`remindersOn`) and `nudge.history.v1`; `trip.plans.v1` holds dates and times.
- Re-plans when the stops, the switch, permission, the hour, the snap count or the dismiss count change.
  It deliberately does *not* depend on the whole `history`: every reconcile writes history, so that
  would loop forever.
- "Here" check: only if location permission is already granted; last-known position (≤ 10 min old)
  or one low-accuracy fix; at most every 10 minutes; not on web.

**Report screen** reads `airport`, `snap`, `via`, `nudge` route params once per distinct set
(`useRef` guard), pre-selects the airport, and calls `takePhoto(true)` on native. Browsers only
open a camera from a real tap, so on web it stops at the airport.

## 4. Client modules

| Module | Responsibility |
|---|---|
| `lib/api.ts` | All I/O. Demo-data fallback when env vars are missing. Converts PostgREST `numeric` strings to numbers. |
| `lib/supabase.ts` | Client creation; AsyncStorage for sessions on native; `ensureSession()` signs in anonymously on first report. |
| `lib/trip.tsx` | React context holding the ordered airport list and optional per-airport date/time (`plans`), persisted on device. |
| `lib/zonedTime.ts` | Airport wall-clock time ⇄ instant via `Intl` (§3.9). Pure. |
| `lib/nudge.ts` | Travel-day nudge policy: what to schedule, which card to show, fatigue limits (§3.10). Pure. |
| `lib/notifications.ts` / `.web.ts` | Local reminders via expo-notifications: permission, reconcile, tap handling / no-ops on web. |
| `lib/travelDay.tsx` | Provider wiring trip + policy + reminders + location + storage. |
| `components/TravelDayCard.tsx`, `StopPlanEditor.tsx`, `RemindersSwitch.tsx` | The card, the "when are you here?" fields, the opt-in switch. |
| `lib/compare.ts` | Pure ranking logic (above). |
| `components/AgeGate.tsx` | 18+ confirmation, required by app stores for alcohol content. |
| `components/AirportSearch.tsx` | 200 ms debounced search; cancels stale responses. |
| `lib/airportSearch.ts` / `lib/airports.ts` | Folding, matching and ranking (§3.7) / the bundled airport list. |
| `lib/shelfTag.ts` | OCR text to report draft (§3.4). Pure, tested on real OCR output. |
| `lib/ocr.ts` / `lib/ocr.web.ts` | `readText(uri)` via ML Kit (native) or self-hosted Tesseract (web). |
| `lib/geo.ts` | Haversine distance, nearest airport, EXIF GPS and timestamp parsing. |
| `lib/issueReport.ts` | Problem-report types, validation, opt-outs, demo-mode GitHub URL, screenshot hand-off (§3.8). Pure. |
| `lib/diagnostics.ts` | In-memory ring buffer of the last 25 console errors/warnings, with token redaction. |
| `lib/deviceContext.ts` / `lib/screenshot.ts` | App/device details for a report / screenshot of the current screen. |

## 5. Interfaces

**`file-issue` Edge Function** (`/functions/v1/file-issue`)
```
POST {"report_id": 12}   Authorization: Bearer <user access token>
  200 {"status":"filed","issue_url":"…","issue_number":34}
  200 {"status":"pending"|"failed"|"skipped","reason":"…"}     401 not signed in   404 not your report
POST {"sweep": true}     Authorization: Bearer <SYNC_TOKEN>
  200 {"checked": n, "results": {"12": {…}}}                     403 wrong token
```

**Scraper CLI**
```
dutyfree-scrape run                        # all active retailers → Supabase, then FX
dutyfree-scrape run --dry-run --adapter shopdutyfree --base-url https://bengaluru.shopdutyfree.com
dutyfree-scrape parse page.html --adapter schiphol   # test a saved page offline
dutyfree-scrape airports                   # load OurAirports into Supabase
```
Exit code 1 if any retailer saved 0 prices, so the scheduled run goes red and notifies us.

**Adding a retailer:** if it's on an existing platform, insert a `retailers` row with that adapter
and base URL; no code. A new platform means a new `Adapter` subclass with `category_urls`,
`parse_listing_html` and `next_page_url`, plus a fixture-based test.
