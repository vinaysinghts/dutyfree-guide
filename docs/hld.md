# High-level design (HLD)

> **What an HLD is for:** it answers "what are the big boxes, how do they talk, and why this shape?"
> It deliberately skips class names and function signatures; those live in the [LLD](lld.md).
> A reviewer should be able to read this in five minutes and challenge the architecture.

## 1. Problem

A traveller passes through several airports on one trip (origin, layovers, destination). The
same bottle can cost very different amounts at each. Example: Johnnie Walker Black Label 1L costs
₹3,450 at Bengaluru (BLR) but €32.99 (about ₹3,150) at Amsterdam (AMS). The traveller wants to see,
before flying, **where on their route each bottle is cheapest**, in their home currency (INR).

## 2. Requirements

**Functional**
1. Search for and add the airports on a trip, in order.
2. See every bottle sold at those airports, cheapest first, with the price at each airport in INR
   and the original currency.
3. Report a price by snapping the shelf tag; details are read from the photo, the location is
   checked against the airport, and it shows to others only after review.
4. Admins review reports (approve / reject, optionally linking to an existing product).
5. Report a problem from any screen: a screenshot, a note and device/app details become a GitHub
   issue on this repo, ready to pick up and fix.

**Non-functional**
| Concern | Target | Why it matters here |
|---|---|---|
| Freshness | Prices updated daily | Duty-free prices change weekly at most; daily is plenty and keeps scraping polite |
| Latency | Price list < 1 s for a 3-airport trip | Users check this at the gate on mobile data |
| Cost | ~₹0 at MVP scale | Free tiers: Supabase, GitHub Actions, Frankfurter FX |
| Trust | Crowd data never shown unreviewed | One fake ₹1 price would destroy credibility |
| Legal | Facts only, no copied images/text, honour robots.txt | See [ADR-0004](adr/0004-scraping-policy.md) |
| Platforms | Web, iOS, Android from one codebase | One developer maintaining it |

**Out of scope for MVP:** flight-number lookup, accounts beyond anonymous sessions, price alerts,
customs-allowance warnings.

## 3. Architecture

```
                    ┌────────────────────────── Supabase ──────────────────────────┐
                    │                                                              │
  ┌──────────────┐  │  ┌───────────────┐   ┌────────────────────────────────────┐  │
  │ Expo app     │──┼─▶│ PostgREST API │──▶│ Postgres                           │  │
  │ web/iOS/And. │  │  │ (auto REST)   │   │  airports, retailers, products,    │  │
  │              │  │  └───────────────┘   │  prices (history), fx_rates,       │  │
  │ anon key +   │  │  ┌───────────────┐   │  price_submissions, trips          │  │
  │ RLS          │──┼─▶│ Auth (anon    │   │  view: latest_prices (in INR)      │  │
  │              │  │  │ sessions)     │   │  fn:   review_submission()         │  │
  │              │  │  └───────────────┘   └────────────────────────────────────┘  │
  │              │──┼─▶ Storage (shelf-tag photos, private bucket)  ▲             │
  └──────────────┘  └──────────────────────────────────────────────┼──────────────┘
                                                                    │ service-role key
                         ┌──────────────────────────────────────────┴───────┐
                         │ Python scrapers (GitHub Actions cron, daily)     │
                         │  adapters: shopdutyfree (BLR + other Avolta      │
                         │  airports), schiphol (AMS) ── polite HTTP ──▶ retailer sites
                         │  fx: Frankfurter (ECB rates) ──────────────▶ api.frankfurter.dev
                         └──────────────────────────────────────────────────┘
```

### Main flows

**Read path (hot path).** App → `GET /latest_prices?airport_iata=in.(AMS,BLR,DXB)` → Postgres view
picks the newest price per (product, retailer) and multiplies by today's FX rate → app groups rows
per bottle and ranks them (`rankProducts`). One round trip; no app server.

**Write path, scraped.** Daily cron → each active retailer's adapter crawls liquor categories →
products upserted by `match_key` → a new `prices` row is appended (history kept) → FX rates refreshed.

**Write path, crowd (photo-first).** The traveller snaps the shelf tag. On the device, OCR reads the
text (ML Kit on phones, Tesseract in the browser) and `parseShelfTag` turns it into a draft
(product, size, price, currency). At the same time, the app gets the location (photo EXIF or live
GPS) and pre-selects the nearest airport. The app signs in anonymously, uploads the photo to a
private bucket and inserts `price_submissions` with the draft, OCR text and coordinates. A database
trigger computes the distance to the airport and the `location_check` verdict. An admin reviews it
(photo, OCR text, location verdict), corrects fields, and approves via `review_submission()`, which
writes a `prices` row with `source = 'crowd'`.

**Problem reports (app → GitHub issue).** Tap the bug icon → the app screenshots the current
screen → the user adds a note → screenshots go to a private bucket and an `issue_reports` row is
inserted (the outbox) → the app calls the `file-issue` Edge Function, which holds the GitHub token,
leases the row, and opens the issue with signed screenshot links. An hourly GitHub Action sweeps
anything that didn't get filed. Full reasoning: [ADR-0010](adr/0010-in-app-issue-reporting.md).

```
App ──(1) upload screenshots──▶ Storage: issue-screenshots (private)
 │  ──(2) insert row──────────▶ Postgres: issue_reports  (status = pending)
 │  ──(3) invoke──────────────▶ Edge Function file-issue ──claim row──▶ Postgres
 │                                  │  └─ signed URLs ──▶ Storage
 │                                  └─ POST /issues (token) ──▶ GitHub
 │                                  └─ status = filed, issue number ──▶ Postgres
 GitHub Actions (hourly) ──sweep──▶ file-issue  (files whatever (3) missed)
```

## 4. Key decisions (summaries; full reasoning in ADRs)

| # | Decision | Main trade-off |
|---|---|---|
| [0001](adr/0001-expo-single-codebase.md) | Expo / React Native for web + mobile | One codebase vs. weaker web SEO than Next.js |
| [0002](adr/0002-supabase-backend.md) | Supabase (Postgres + RLS) with no custom API server | Speed and cost vs. logic living in SQL |
| [0003](adr/0003-python-scrapers-adapter-pattern.md) | Python scrapers, one adapter per retailer platform | Simple daily batch vs. no real-time prices |
| [0004](adr/0004-scraping-policy.md) | Polite scraping of facts only | Legal safety vs. some sites may stay unavailable |
| [0005](adr/0005-product-matching.md) | Rule-based `match_key` for cross-airport matching | Cheap and explainable vs. misses odd naming |
| [0006](adr/0006-crowd-review-queue.md) | Crowd prices only after human review | Trust vs. slower to appear |
| [0007](adr/0007-on-device-ocr.md) | Photo-first reports read by on-device OCR | Free and private vs. less accurate than a vision model |
| [0008](adr/0008-location-verification.md) | Server-computed location check on reports | Cheap fraud signal vs. spoofable, so advisory only |
| [0010](adr/0010-in-app-issue-reporting.md) | Problem reports become GitHub issues via an Edge Function, outbox + hourly sweep | Token never in the app, nothing lost vs. at-least-once (rare duplicate issue) and public screenshots |
| [0011](adr/0011-blocked-is-not-disallowed.md) | A bot-wall 401/403/429 means "blocked": stop, warn, keep the last prices; no retries or IP changes | Stays polite to sites that push back vs. prices can go stale while blocked |

## 5. Scaling and failure thinking

- **Read load** is tiny per request (a few hundred rows). If it grows: add an index-only
  materialized view refreshed after each scrape, and cache at the CDN (prices change daily).
- **One retailer's site changes markup** → that adapter returns 0 products → the run marks the job
  failed (non-zero exit) and GitHub emails us; other retailers still save. Old prices remain visible
  with their date, so the app degrades instead of breaking.
- **FX API down** → yesterday's rates stay in `fx_rates`; a missing currency shows "No INR rate yet"
  and sorts last instead of being wrongly ranked.
- **Abuse of crowd reports** → RLS limits inserts to the user's own rows; nothing is public until
  approved; length/range CHECK constraints reject garbage at the database.

- **GitHub down or rate-limited** when a user reports a problem → the report is already saved;
  the user is told it will be posted within the hour, and the sweep job files it.

## 6. What a staff engineer would watch next

1. Matching quality is the product's real moat. Measure it (% of products seen at ≥2 airports) and
   move to fuzzy matching or a curated catalogue when it plateaus.
2. Partnerships: a retailer feed beats scraping on reliability and legality. Scraping is the bootstrap.
3. SEO landing pages ("cheapest Black Label at AMS") would be the growth channel. That's the trigger
   to revisit ADR-0001 (Next.js for the web).
