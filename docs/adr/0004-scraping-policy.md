# ADR-0004: Scraping policy (what we collect and how)

**Status:** accepted, 2026-11-09. *Not legal advice; get a legal review before public launch.*

## Context
Prices are facts and broadly not protected, but a site's terms of service can bind scrapers
(CJEU, *Ryanair v PR Aviation*, 2015), and the EU database right protects against extracting a
substantial part of a database. Product photos and descriptions are copyrighted.

## Decision
1. Collect only: product name, brand, size, price, currency, product URL.
2. Don't store or display retailer images or descriptions in production (the `image_url` column is for brand-supplied or our own images later).
3. Honour `robots.txt` (including `Crawl-delay`); at least 5 s between requests; identify ourselves with a descriptive User-Agent.
4. Once a day at most.
5. Every price links back to the retailer.
6. Read each retailer's terms before enabling it; remove any retailer that asks.
7. Prefer official feeds / affiliate deals when available.

## Consequences
Some retailers may be off-limits; crowd reports fill those gaps.
