# ADR-0016: A Dubai Duty Free (DXB) adapter, built dark and switched on only after a live check

**Status:** accepted (adapter merged switched off), 2026-11-13. Builds on [ADR-0003](0003-python-scrapers-adapter-pattern.md),
[ADR-0004](0004-scraping-policy.md), [ADR-0011](0011-blocked-is-not-disallowed.md) and
[ADR-0013](0013-blr-data-without-avolta.md). *Not legal advice.*

## Context
DXB is on the routes our first users actually entered (issues #23/#24: AMS → BLR → BSL → DXB). Today
DXB prices come only from traveller photos, so the app says "Traveller prices only" there
(ADR-0015). Dubai Duty Free is a single, state-owned retailer that runs its own website,
`www.dubaidutyfree.com`, so one adapter covers the whole airport.

What we know and don't know on 2026-11-13:

| Question | Answer | How we know |
|---|---|---|
| Does its `robots.txt` allow us? | **Unknown** | The dev sandbox's proxy refuses the host, and a robots-respecting page fetcher got a client error on `/robots.txt` and on the terms page (problems log #19). |
| Do its terms forbid automated access or reuse of prices? | **Unknown** | Same: unread. |
| Are liquor prices on the site at all? | **Unknown** | A web search finds no indexed liquor listing pages on the domain. UAE alcohol rules may mean liquor is store-only or arrivals-only online. |
| Markup: JSON-LD, server HTML or a JavaScript app? | **Unknown** | Unread. |
| Currency | AED | Shelf tags and press coverage. |
| Can we convert AED to INR? | **Not with our current FX code** | The ECB publishes no AED rate, and our rates come from the ECB via Frankfurter (problems log #19). |

So we cannot honestly turn on a "Shop prices, updated daily" source for DXB today. We can build
everything that doesn't depend on those unknowns and make the unknowns cheap to resolve.

## Options

| # | Option | Verdict |
|---|---|---|
| A | Write the adapter and enable it now; fix it if it fails | **Rejected.** That runs a scraper against a site whose robots.txt and terms nobody has read, which ADR-0004 forbids. |
| B | Wait until someone can open the site in a browser, then write everything | **Rejected.** Leaves the cheap, reusable work (AED conversion, adapter skeleton, tests) undone for no reason. |
| C | **Build dark:** adapter + tests + AED conversion merged, retailer row *not* inserted; the Scraper live check reads robots.txt, the home page's liquor and terms links, and three guessed category pages from GitHub's runners | **Chosen.** Same pattern that worked for BLR (problems log #4): push uncertainty to a seam that is cheap to verify, keep the dangerous part opt-in. |
| D | Copy DXB prices from aggregators or price-list blogs | **Rejected.** Copying another party's database (ADR-0004, ADR-0013 option F), and the blog lists are years old. |
| E | Ask Dubai Duty Free for a feed or permission | **Worth doing in parallel.** Unlike Avolta, it's one retailer with a press office that partners with brands publicly. A "yes" overrides robots and terms questions. |

## Decision

1. **Adapter `dubaidutyfree`** (`scrapers/dutyfree_scrapers/adapters/dubaidutyfree.py`): JSON-LD first, CSS fallback,
   AED by default (also reads "Dhs" and "د.إ"), follows only a pager the page shows (problems log #12).
   Three guessed category paths, deliberately few because each is a real request to their shop.
2. **AED via the USD peg.** `fx.py` never asks the ECB for AED. It fetches USD and divides by the UAE
   Central Bank's fixed 3.6725 AED per USD. QAR (Doha) gets the same treatment at 3.64. A currency we can't
   price is logged and skipped instead of failing the run.
3. **The retailer row is the on switch.** This change does **not** insert a DXB `retailers` row. Until
   one exists, `airport_coverage` keeps saying DXB is traveller-only, which is the truth.
4. **Gates before the row is inserted.** All must hold, checked by a person against the live-check log:
   1. `robots.txt` (printed by the live check) allows `DutyFreeGuideBot` on the category paths we use.
      A `Crawl-delay` is honoured automatically.
   2. The terms page (the live check lists its link as `policy_links`) is read by a person and doesn't
      forbid automated access or reuse of prices. If it does, we stop and record that here.
   3. The shop answers our own `DutyFreeGuideBot` user agent with plain requests: no cookies, tokens,
      browser headers or challenge solving. A Cloudflare/Akamai/DataDome wall is a "no" (ADR-0011).
   4. Liquor prices are in the HTML or JSON-LD. If they are only behind a private JavaScript API, that is
      the ADR-0013 situation again and needs its own decision.
   5. A dry run (`dutyfree-scrape run --dry-run --adapter dubaidutyfree --base-url https://www.dubaidutyfree.com`)
      returns bottles with sizes, and some of them match BLR bottles by `match_key`.
5. **Switching on**, once the gates pass, is one migration:

   ```sql
   insert into public.retailers (airport_iata, name, adapter, base_url, currency, zone, active)
   values ('DXB', 'Dubai Duty Free', 'dubaidutyfree', 'https://www.dubaidutyfree.com', 'AED', 'departure', true)
   on conflict (airport_iata, name) do nothing;
   ```

   With ADR-0015's `airport_coverage` view, DXB then shows "Shop prices, updated daily" as soon as the
   first scrape lands. No app change is needed.
6. **If a gate fails**, the adapter stays unregistered in `retailers`, this ADR gets a "Gate check" section
   saying which gate and what we saw (as ADR-0013 did for BIAL), and DXB stays a traveller-photo airport.

## Consequences
- Good: nothing touches Dubai Duty Free's site except the opt-in live check, which runs only when adapter
  code changes and fetches at most five pages, 5 s apart.
- Good: AED and QAR conversion is fixed for crowd prices too. Traveller photos from DXB are priced in AED and
  were going to have no INR rate once a scrape run asked Frankfurter for one.
- Good: switching on is a reviewed one-line migration, and switching off is `active = false`.
- Bad: DXB keeps showing traveller prices only until a person checks the live-check log. That could be days.
- Bad: the fixture is synthetic, so the CSS fallback is a guess until a real page replaces it.
- Risk: a currency peg can break. The AED peg has held since 1997, but if it moves, `PEGGED` in `fx.py` is
  the one place to change.

## Revisit when
- The live check on this change's PR reports (fill in the gate check below), or
- Dubai Duty Free answers an outreach email, or
- traveller photos for DXB pass ~20 approved bottles, which lowers the value of a scraper.

## Gate check
*Pending: filled in from the Scraper live check run on this PR.*
