# ADR-0011: A 403 from the site's edge means "blocked", and we stop

**Status:** accepted, 2026-11-11. Builds on [ADR-0004](0004-scraping-policy.md).

## Context
From GitHub's runners, BLR's `robots.txt` sometimes answers `200` with real rules
(`Crawl-delay: 30`) and sometimes `403` with Akamai's "Access Denied" page
(`errors.edgesuite.net` reference). On 2026-11-10 the two alternated run by run (15:13 403,
15:34 200, 15:58 403, 16:17 200, 16:28 403, 17:10 200, 18:10 403); on 2026-11-11 the daily run got
403. Each run gets a different Azure IP, so the likeliest reading is that Akamai's bot manager
scores some datacenter IPs (or our traffic from them) as bots and refuses them at the edge,
before the shop's own server is involved. An Akamai 403 page gives no reason, so this is an
inference; it is not a robots.txt rule.

The code treated that 403 as "robots.txt disallows everything". That was safe but the log said
`robots.txt disallows …` nine times, which reads like the shop's rules forbid us, and the run
went red as if our code were broken.

**What the standards say.** RFC 9309 §2.3.1.3: a 4xx on robots.txt means "unavailable", and a
crawler *may* access anything. Google follows this, 401/403 included. Python's
`urllib.robotparser` instead treats 401/403 as disallow-all. Both are answers to "is there a
robots.txt?". Our case is different: the 403 is not about the file, it's the site's edge refusing
this client. Every other page would get the same 403.

## Options
1. **Follow RFC 9309 literally and crawl.** Every request would get the same 403. More traffic to
   a site that has said no.
2. **Retry until a request gets through** (wait, rerun the job, or move to another runner or
   proxy for a new IP). That is getting around a deliberate block: rotating IPs to evade an IP
   block is the same thing as solving a bot challenge. ADR-0004 rules it out.
3. **Stop, report "blocked", keep the last good prices.** Chosen.

## Decision
- A 401/403 on robots.txt, or a 401/403/429 on any page, raises `SiteBlocked` with the bot
  wall's name from its fingerprints (Akamai, Cloudflare, DataDome). We send no more requests to
  that site for the rest of the run.
- A real robots.txt `Disallow` is still `RobotsDisallowed`: a rule we follow, logged as such.
- A blocked retailer is a **warning** (log line plus a GitHub Actions annotation on the run
  page). The job fails only for our own bugs: a crash, or a page that loaded but parsed to zero
  products. Red should mean "our code needs fixing".
- No automatic retry. The schedule stays once a day. If tomorrow's runner isn't blocked, it
  works; we don't go looking for one that isn't.
- The app already shows "Prices updated: BLR 10 Nov", so stale prices are visible to users.

## Consequences
- Good: logs say what happened ("blocked by the site, HTTP 403 (Akamai edge 'Access Denied')").
  We stay well-behaved toward a site that is pushing back.
- Bad: BLR prices can go stale for days, and a green run no longer means "fresh prices". The
  annotation is the signal to watch.
- The real fix is not technical: ask Avolta for a feed or permission (drafts in
  `/mnt/project-files/outreach/`), and lean on crowd reports.

## Revisit when
- Avolta grants access (allow-listing our user agent would end the blocks), or
- BLR is blocked for 7+ days in a row: then add a staleness alert, or drop BLR scraping and rely on
  crowd reports.
