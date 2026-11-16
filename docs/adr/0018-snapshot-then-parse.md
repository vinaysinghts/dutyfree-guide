# ADR-0018: Save raw pages first, parse them second ("snapshot, then parse")

**Status:** proposed, 2026-11-15. Builds on [ADR-0003](0003-python-scrapers-adapter-pattern.md),
[ADR-0004](0004-scraping-policy.md), [ADR-0011](0011-blocked-is-not-disallowed.md) and
[ADR-0016](0016-dxb-dubai-duty-free-adapter.md). *Not legal advice.*

## Context
The product owner asked: *what if a Python script downloads the shop pages with products and prices,
and we get our prices from those files?*

That is already what our scrapers do, with one difference. Today, fetching and parsing happen in **one pass**:
`Adapter.crawl()` downloads a page, parses it straight away, and throws the HTML away. Only the
Scraper live check keeps pages, as a 7-day GitHub artifact. So the question is really two separate
questions:

1. **Where should the download run?** (GitHub's runners, the owner's laptop, or another machine.)
2. **Should we keep the downloaded pages** and parse them in a separate step?

What happened in the last week answers part of both:

| Airport | What a plain, honest request gets | Would saving the page help? |
|---|---|---|
| BLR (shopdutyfree) | Real HTML with prices, but Akamai sometimes returns 403 to some GitHub runner IPs (ADR-0011) | **Yes.** When we do get in, a saved page can be re-parsed for days. |
| AMS (Schiphol) | A Cloudflare challenge page on every request (problems log #9) | **No.** We would save a challenge page. Getting past it is a bypass, and ADR-0004/0011 rule that out. |
| DXB (Dubai Duty Free) | `200`, but every listing page is the same empty JavaScript shell, and its terms forbid using the site's data (ADR-0016) | **No.** We would save an empty shell, and we aren't allowed to use what's in it anyway. |

So the hard part is **getting bytes that contain prices**, not parsing them. Saving pages doesn't fix
access. What it does fix is everything after access.

## Question 1: where the download runs

| Option | Verdict |
|---|---|
| A. GitHub Actions runners (today) | **Keep.** Free, scheduled, logged, no secrets on a personal machine. |
| B. The owner's laptop or home connection | **Rejected as a way around blocks.** Running it there *because* a site blocks GitHub's IPs means choosing an IP to get past a block. That is evasion, whichever machine does it (ADR-0011 option 2, ADR-0013 option B). For a site that doesn't block us, a laptop adds nothing except a single point of failure (asleep, offline, travelling) and the Supabase service key on a personal machine. |
| C. A self-hosted runner or cloud VM | **Rejected for now**, for the same reason as B when the motive is a block. Reconsider only for capacity, for example if a site's robots.txt asks for a crawl delay that makes a run exceed the 6-hour GitHub job limit. |

**Rule of thumb:** the machine is never the lever for access. If a site lets an honest client in, any machine
works, so use the free one. If it doesn't, no machine is allowed.

## Question 2: snapshot, then parse

| Option | Verdict |
|---|---|
| D. One pass, keep nothing (today) | Simple, but a selector bug loses that day's prices for good, and the only fix is to fetch again (more traffic to the shop). Tests run on hand-made fixtures, not real pages. |
| E. One pass, also save every page | Keeps the evidence but still couples the two steps: a parse crash stops the fetch. |
| **F. Two stages: fetch writes snapshots, parse reads them** | **Chosen.** Explained below. |
| G. Headless browser that renders JavaScript, then save | **Not now.** It would turn DXB's shell into a page with prices, but it means running the shop's whole front end, including its private API calls, on every run. That is the ADR-0013 question (calling the shop's API), plus a heavier and more bot-like client. For DXB the site's terms rule it out anyway (ADR-0016). |

## Decision (design)

```
            stage 1: fetch (network, polite)          stage 2: parse (offline, pure)
retailers ─▶ PoliteClient ─▶ Snapshot ─▶ SnapshotStore ─▶ Adapter.parse_listing ─▶ prices
             robots, delay,   url, status,  Supabase Storage     same parsers we have,  upsert,
             SiteBlocked      fetched_at,   (private bucket),    run on saved bytes     as today
                              sha256, html  30-day retention
```

1. **Snapshot record:** `retailer_id, url, final_url, status, fetched_at, content_type, sha256, body (gzip)`. Saved
   to a private Supabase Storage bucket at `snapshots/<retailer>/<YYYY-MM-DD>/<sha256>.html.gz`, plus one
   `manifest.json` per run. Supabase already stores shelf photos, so there is no new service.
2. **Fetch stage** (`dutyfree-scrape fetch`): same `PoliteClient`, same robots.txt, delay and `SiteBlocked` rules.
   Pagination still needs to look at a page to find the next link, so the fetch stage calls the adapter's
   `next_page_url` but never its product parser. A block is recorded in the manifest as `blocked`, not saved as a page.
3. **Parse stage** (`dutyfree-scrape parse --snapshots <date>`): reads a manifest, runs the existing adapter parsers,
   writes prices with `observed_at = fetched_at` (when the shop showed that price, not when we parsed it).
   The parse stage never touches the network.
4. **`dutyfree-scrape run`** stays the daily entry point: fetch, then parse.
5. **Re-parse:** after a selector fix, `parse --snapshots 2026-11-14` back-fills that day's prices without asking
   the shop again.
6. **Real fixtures:** a snapshot can be promoted to a test fixture with one command. That ends the synthetic
   fixtures that ADR-0016 had to use.
7. **What we keep, and for how long.** Snapshots are working files for parsing, never published or served to users.
   We publish only the facts (bottle, size, price), as ADR-0004 requires. Snapshots older than **30 days** are
   deleted by the parse job. **Raw API responses are never snapshotted** (ADR-0013 found staff phone numbers in
   one). Any future API adapter whitelists its fields first and stores only those.

### Size, as a sanity check
BLR: 9 category pages × ~150 KB of HTML ≈ 1.4 MB a day, about 150 KB gzipped. 30 days of that ≈ 5 MB per retailer.
Even 20 retailers stay around 100 MB, well inside Supabase's free 1 GB of storage.

### Failure isolation (why two stages matter in practice)
| Failure | Today | With snapshots |
|---|---|---|
| Shop blocks us | Prices for that day lost; run warns | Same. Snapshots don't help with access. |
| Our selector breaks after a redesign | Prices for that day lost; fix, then fetch again | Fix, re-parse the saved pages, nothing lost, no extra traffic |
| Parser crashes on one odd page | Can stop that retailer's crawl | Fetch already finished; one page fails to parse, the rest load |
| "Why is this price wrong?" | No evidence left | Open the exact page we parsed, by date |

## Consequences
- Good: fetch and parse failures become separately visible and separately fixable. Re-parsing is free for the shop.
- Good: tests run against real pages, which closes the gap that bit us in problems logs #4, #12 and #19.
- Good: an audit trail. Every stored price can point at the snapshot it came from.
- Bad: one more moving part (storage, retention job) and a bucket to keep private.
- Bad: keeping copies of a retailer's pages, even privately and briefly, is more than "facts only". The 30-day
  limit, the private bucket and never republishing are what keep that proportionate. And snapshots never
  change the terms question: if a site's terms forbid using its data (DXB), we don't fetch it at all.
- Neutral: it doesn't change which sites we can read. AMS (Cloudflare) and DXB (JavaScript shell) stay as they are.

## Revisit when
- We add an API-based source: decide then whether whitelisted JSON gets snapshotted.
- Storage passes ~500 MB, or a retailer asks us to stop.

## Implementation order (when accepted)
1. `snapshot.py`: `Snapshot` dataclass, a `SnapshotStore` protocol, a `LocalDirStore` for tests and dev, and a
   `SupabaseStorageStore`.
2. Split `Adapter.crawl()` into `fetch_pages()` (network) and `parse_pages()` (pure), keeping `crawl()` as the
   two together, so nothing else changes.
3. CLI: `fetch`, `parse --snapshots`, and `fixture --from-snapshot`.
4. A storage migration for the private bucket, plus the 30-day cleanup in the parse job.
