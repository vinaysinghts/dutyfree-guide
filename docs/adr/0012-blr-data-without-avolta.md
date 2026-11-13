# ADR-0012: Sourcing BLR prices without Avolta's cooperation

**Status:** accepted, 2026-11-13. Builds on [ADR-0004](0004-scraping-policy.md) and
[ADR-0011](0011-blocked-is-not-disallowed.md). *Not legal advice.*

## Context
ADR-0011 named "ask Avolta for a feed or permission" as the real fix for BLR's Akamai blocks.
We now plan on the assumption that **Avolta will not help** (no reply to email, no affiliate
programme for India: the only shopdutyfree programme on an Indian network, Cuelinks, is paused,
Spain-only and pays per click with no feed).

Two facts changed the picture:

1. **BLR duty free is a 50:50 joint venture between Avolta and BIAL**, the airport operator
   (15-year contract from late 2022). BIAL co-owns the shop, and it is a separate company from Avolta.
2. **BIAL republishes the catalogue.** bengaluruairport.com's duty-free pages load products from
   `GET https://gateway.bengaluruairport.com/pax2/v2/api/products/list` (found in the browser's
   Network tab). Items carry `merchantId: "dufry"` and Avolta's SAP article number, so Avolta's
   catalogue is synced into BIAL's own commerce service. The response is clean JSON:
   465 arrivals liquor items with `price`, `offerPrice`, `pricingHistory[]` and often a real GTIN barcode.

Three complications:

- **The API is undocumented and built for BIAL's own front end** (`bookingSource=edp-web`). Reachable is not the same as allowed.
- **Its host may forbid crawlers.** `www.bengaluruairport.com/robots.txt` allows everything
  (`Disallow:` with an empty value). A fetch of `gateway.bengaluruairport.com/robots.txt` by a
  robots-respecting fetcher was refused as `robots_disallowed`. That suggests the gateway host's rules
  disallow automated clients, but we have not read the file itself. BIAL's terms of use only render in JavaScript, so they are unread too.
- **The response leaks personal data.** Each product has a `contact` array of about 16 entries with staff names,
  mobile numbers and email addresses.

## Options

| # | Option | Verdict |
|---|---|---|
| A | Keep scraping shopdutyfree.com politely (ADR-0011) | **Keep.** Legitimate. It works whenever the edge lets us in. |
| B | Run the scraper from an IP Akamai doesn't block (self-hosted runner, home connection, proxy) | **Rejected.** We would be choosing an IP *because* the other one is blocked. That is evasion, whatever machine runs it (ADR-0011, option 2). |
| C | Call BIAL's product API now | **Rejected for now.** Possible robots disallow, unread terms, no permission. |
| D | Call BIAL's API only once it passes every gate below | **Chosen, gated.** The gates are written down in advance, so the call is a checklist rather than a judgment made under pressure. |
| E | Make crowd photo reports the primary BLR source | **Chosen.** They're ours, cooperation-free, and already built (ADR-0006/0007/0008). |
| F | Reuse other aggregators' prices (dutyfree.buzz etc.) | **Rejected.** That copies another company's database (ADR-0004, EU database right) and inherits their freshness problems. |
| G | Admin-entered prices from our own trips or receipts | **Chosen as a seed.** Goes through the same review queue, labelled as admin entries. |

## Decision

1. **Data sources for BLR, in order:** (a) shopdutyfree daily scrape under ADR-0011; (b) approved crowd
   and admin photo reports; (c) the BIAL API **only if gated in** (rule 2). The app already shows a
   per-airport "updated" date, so users see how old each price is.
2. **BIAL API gates.** All of these must hold before an adapter is enabled:
   1. `gateway.bengaluruairport.com/robots.txt` permits our user agent for `/pax2/`, checked by
      the adapter on every run with the existing robots logic. If it disallows, we stop. Alternatively,
      BIAL gives written permission, which overrides robots.
   2. BIAL's terms of use, read by a person, don't prohibit automated access or reuse of prices.
   3. No login, token, cookie replay or spoofed headers are needed. We send our own
      `DutyFreeGuideBot` user agent. If the API only answers browser-looking clients, it is not open to us.
   4. **Field whitelist:** we keep name, brand, size (`Volume In Ml`), `price`, `offerPrice`, currency,
      GTIN and product URL (ADR-0004). Nothing else is parsed into our models, and raw responses are never saved
      or committed, because the payload contains staff PII.
   5. At most two requests a day (arrivals and departures, large `pageSize`), and `SiteBlocked` applies.
3. **We report the PII exposure to BIAL** (draft in `/mnt/project-files/outreach/`), whether or not
   we ever use the API. It is the right thing to do, and it opens a conversation with BIAL.
4. **No runner shopping.** If GitHub's runners are blocked, BLR goes stale and crowd reports cover it.

## Consequences
- Good: every source is either ours (crowd and admin) or used on its owner's published terms. Nothing
  depends on Avolta answering an email.
- Good: the gates make the BIAL decision cheap to re-check and easy to explain. If gate 1 passes tomorrow,
  the adapter is small: one JSON call, no HTML parsing, and GTINs make cross-airport matching (ADR-0005) much stronger.
- Bad: if gate 1 fails, which the evidence leans towards, BLR freshness depends on the Akamai edge and on
  how many travellers send photos. That could mean days-old prices at launch.
- Bad: crowd data is sparse at first and skews towards popular bottles. Seeding it ourselves (option G) is manual work.

## Revisit when
- BIAL replies, either granting permission or confirming the robots and terms position, or
- gate 1 or 2 is checked by a person (record the result here), or
- BLR is blocked for 7+ days in a row with fewer than ~20 approved crowd prices: then reconsider
  whether BLR stays in the MVP.
