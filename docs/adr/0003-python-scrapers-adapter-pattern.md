# ADR-0003: Python scrapers with one adapter per retailer platform, run daily

**Status:** accepted, 2026-11-09

## Context
No public multi-airport duty-free price API exists. Many airports share e-commerce platforms
(Avolta's shopdutyfree.com runs BLR and dozens of others). Prices change slowly.

## Options
- **Scrapy:** full crawling framework (scheduling, throttling, pipelines). Powerful, but heavy for ~10 category pages per site per day.
- **httpx + BeautifulSoup (chosen):** small, explicit, easy to test with saved HTML. Playwright can be added per adapter if a site needs JavaScript rendering.
- **Headless browser for everything:** robust to JS-heavy sites, but slow, costly in CI and more "bot-like".

## Decision
A small package `dutyfree_scrapers` using the **Adapter pattern**: the crawl loop, politeness,
JSON-LD parsing and storage are shared; each platform only implements `category_urls`,
`parse_listing_html` and `next_page_url`. Retailers are rows in the database, so adding another
airport on a known platform needs no code. Runs once a day on GitHub Actions.

## Consequences
- 👍 New airport on a known platform = one SQL insert.
- 👍 Parsers are tested offline against fixture HTML; no network in tests.
- 👎 Site redesigns break adapters silently unless we alert; mitigated by exit code 1 when a retailer yields 0 prices.
- 👎 Selectors were written without access to the live sites (blocked from the build environment) and must be verified before enabling the schedule.

## Revisit when
More than ~20 retailers, or a site needs JS rendering, then consider Scrapy + scrapy-playwright.
