# ADR-0015: Say why an airport has no prices

**Status:** accepted, 2026-11-13. Built.

## Context
The first two reports from the app (issues #23 and #24) asked the same question: *why can't it
fetch prices for AMS, BSL and DXB?* The trip was AMS → BLR → BSL → DXB, and only BLR had prices.

Nothing was failing. Only one airport has a working price source:

| Airport | Source | Why no prices |
|---|---|---|
| BLR | `shopdutyfree` scraper, daily | (has prices) |
| AMS | `schiphol` scraper, **paused** | Schiphol answers every automated request with a Cloudflare challenge. We don't get around bot walls (ADR-0004, ADR-0011), so the retailer row is `active = false`. |
| BSL | **none** | No retailer row has ever existed. |
| DXB | **none** | Same. |

The app showed one line for all three: *"No prices collected yet for AMS, BSL, DXB."* "Yet"
promised prices that were never coming, and it didn't say what the traveller could do about it.
The database knew the difference (paused retailer vs. no retailer), but nothing exposed it.

## Options
1. **Write scrapers for BSL and DXB.** It's what the report literally asks for. But DXB's shop
   (Dubai Duty Free) and BSL's are new platforms we couldn't even reach from the build
   environment, so each is days of work with an unknown chance of a bot wall at the end. It
   would also leave the next airport (FRA, IST, …) with exactly the same bug. Coverage will always
   be partial: there are ~3,200 airports and we'll scrape a handful.
2. **Get past Schiphol's challenge** (headless browser, residential proxies). Ruled out by
   ADR-0011: being blocked is the site's answer.
3. **Make coverage a first-class, explained state.** Tell the traveller, per airport, whether a
   shop feed is live, stale, paused (and why), or doesn't exist, and offer the one thing that
   fills the gap: a shelf-tag photo for that airport.

## Decision
**Option 3 now; new scrapers are separate, demand-led work.**

- A view, `airport_coverage`, returns per airport: `scraper` (`live` / `paused` / `none`),
  `paused_reason`, `last_scraped_at`, `crowd_products`, `last_reported_at`. An airport with no
  retailer rows comes back as `none`.
- `retailers.paused_reason` holds traveller-facing words for *why* a scraper is off. Whoever
  pauses a retailer writes the reason in the same migration.
- `client/lib/coverage.ts` (pure, unit-tested) turns a row into a label for the trip list and a
  sentence for the prices screen. It also flags **stale**: a live scraper whose newest price is
  more than 3 days old (the BLR Akamai case, problems log #13) gets "may be out of date" instead
  of looking current.
- Every airport that isn't live gets "Snap a shelf tag at XXX", which opens Report a price with
  that airport chosen.

## Consequences
- ➕ The answer to "why no prices?" is in the app, at the moment of asking, without an issue.
- ➕ Each gap becomes an ask with a clear payoff ("yours would be the first"), which feeds the
  crowd pipeline (ADR-0006, ADR-0014) where it's needed most.
- ➕ One mechanism covers all 3,200 airports, today and after every new scraper.
- ➖ It doesn't add a single price. Travellers on AMS → BLR → BSL → DXB still only compare against
  BLR until someone reports a shelf.
- ➖ One more query per screen. It's one small grouped read per trip, filtered by airport.
- ➖ The trip screen now says "Traveller prices only" for most airports, which is honest but
  makes the coverage gap very visible. That's the point, but it's a product cost.

## Revisit when
- Issue reports or trip data show the same uncovered airport again and again: that's the signal
  to probe its shop (`dutyfree-scrape probe`) and write an adapter. DXB is the first candidate
  (it's on the original trip, and a major hub for Indian travellers).
- A partner feed arrives (Avolta, problems log #14): more airports turn `live` with no app change.
