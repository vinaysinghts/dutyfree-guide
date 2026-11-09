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
```

| Table | Why it exists / notable choices |
|---|---|
| `airports` | From OurAirports. `search_text` is a **generated column** + trigram index, so search is one indexed `ILIKE`. |
| `retailers` | A shop at an airport. `adapter` says which scraper collects it; null = crowd-only. Many airports share an adapter (Avolta's platform). |
| `products` | Canonical bottle. `match_key` = normalized brand+name+volume; UNIQUE so upserts dedupe. |
| `prices` | **Append-only** history (never updated). Gives price charts later for free and makes scrape runs idempotent-ish. |
| `latest_prices` (view) | `DISTINCT ON (product_id, retailer_id) … ORDER BY observed_at DESC` = the newest row per pair, converted to INR. `security_invoker` so RLS still applies. |
| `fx_rates` | INR per 1 unit. One row per currency, overwritten daily. |
| `price_submissions` | Review queue. CHECK constraints bound lengths, volume and price. Partial index on `status='pending'` keeps the queue query fast as history grows. |
| `admins` | Membership table read by `is_admin()`. |

### Row level security (RLS)

The app talks to the database directly with a **public** anon key, so RLS is the authorization layer:

| Table | anon/authenticated can… |
|---|---|
| catalogue tables, `prices`, `fx_rates` | read |
| `price_submissions` | insert own rows (status forced to `pending`), read own; admins read all |
| `trips`, `trip_airports` | full access to own rows only |
| storage `submission-photos` | upload into `<uid>/…`, read own; admins read all |

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

### 3.4 Review: `review_submission(p_submission_id, p_approve, p_note, p_existing_product_id)`
Locks the row (`FOR UPDATE`) so two admins can't double-approve; rejects non-pending; on approve,
links to the given product or creates one, upserts the airport's "Reported by travellers"
retailer and inserts a `prices` row with `source='crowd'`.

## 4. Client modules

| Module | Responsibility |
|---|---|
| `lib/api.ts` | All I/O. Demo-data fallback when env vars are missing. Converts PostgREST `numeric` strings to numbers. |
| `lib/supabase.ts` | Client creation; AsyncStorage for sessions on native; `ensureSession()` signs in anonymously on first report. |
| `lib/trip.tsx` | React context holding the ordered airport list, persisted on device. |
| `lib/compare.ts` | Pure ranking logic (above). |
| `components/AgeGate.tsx` | 18+ confirmation, required by app stores for alcohol content. |
| `components/AirportSearch.tsx` | 200 ms debounced search; cancels stale responses. |

## 5. Interfaces

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
