# ADR-0019: Reddit as a separate, low-trust signal: "what travellers recommend" per airport

**Status:** proposed, 2026-11-15. Product owner chose the non-commercial route. Nothing is built
until gates G1 and G2 below are met. Builds on [ADR-0004](0004-scraping-policy.md),
[ADR-0005](0005-product-matching.md), [ADR-0011](0011-blocked-is-not-disallowed.md) and
problems log #19 ("read the terms before probing").

## Context
We now have every airport in the app. The product owner asked for two new things:
1. **Recommendations.** For each airport, rank the liquors that Reddit users recommend buying there.
2. **Reddit prices.** Where a thread mentions a price, show it, and use the newest one for now.

This is a different kind of data from what we have. Our prices are facts from a shop's page or
from a reviewed shelf photo. Reddit gives us **opinions** and **hearsay prices**: unverified,
often months old, sometimes in the wrong currency or for the wrong bottle size.

**What Reddit's rules say.** We checked them before sending a single request (problems log #21).
From Reddit's own
[Developer Platform FAQ](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data):
- Commercial use needs Reddit's permission and a contract *first*. "Commercial" means use by a
  business or "as part of a monetized product", and it explicitly includes apps with ads,
  promos or paywalls, and "free product features available for upsell".
- "You cannot display Reddit content and run advertisements" in the same app or site.
- Reddit content may not be used "as an input for any model training" without Reddit's consent.
- Non-commercial use needs the app to be registered. Access is OAuth only.
- The legacy [Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki):
  100 queries per minute per OAuth client, averaged over 10 minutes; an honest User-Agent in the
  form `<platform>:<app id>:<version> (by /u/<username>)`; `robots.txt` is not for API users.

**What we couldn't read.** The binding documents (Data API Terms, Developer Terms and the
Responsible Builder Policy) are on `redditinc.com`, which is blocked from our build environment.
We did not try to get round that, e.g. by reading an archived copy. Third-party sites claim
that since June 2026 every app needs pre-approval, that content users delete must be deleted
from our store too (some say within 48 hours), and that Reddit may have stopped accepting new
access requests on 2026-10-31. None of this is confirmed. That is why gate G1 exists.

## Options
1. **Scrape reddit.com pages or use the unauthenticated `.json` endpoints.** This is outside the
   API, breaks ADR-0004 and ADR-0011, and is exactly what Reddit's rules close off. Rejected.
2. **Buy data from a third-party Reddit reseller.** Their rights come from Reddit's terms,
   which we can't check from here, and it costs money for a prototype. Rejected for now.
3. **Apply for commercial access now.** This is the right move once we want ads or a paid tier,
   but there's no self-serve process and we don't know yet whether the feature is worth it.
   Deferred (see "Revisit when").
4. **Non-commercial prototype through the official API, with hard gates.** Chosen by the
   product owner on 2026-11-15.
5. **Skip Reddit and rank from our own travellers' votes.** This is still a good idea and
   complements Reddit, because it is data we own. It doesn't help with day one, when we have
   no votes yet.

## Decision
**Gates.** All are needed, and each one is checked by a person, not by code.
- **G1, terms read.** The product owner reads the Data API Terms, Developer Terms and
  Responsible Builder Policy, then fills in the "Clauses we rely on" table below with the
  relevant quotes: retention, deletion, derived data, display and attribution.
- **G2, access granted.** The app is registered as non-commercial and Reddit approves it, where
  approval is required. The credentials go into GitHub secrets (`REDDIT_CLIENT_ID`,
  `REDDIT_CLIENT_SECRET`), never into the repo.
- **G3, no ads and no paywalls** in any build that shows Reddit-derived content. If we ever add
  monetisation, we first get written permission from Reddit or remove the feature.
- **G4, the API only.** OAuth (application-only `client_credentials`), an honest User-Agent,
  and pacing driven by the `X-Ratelimit-*` headers at no more than a third of the limit. Any 401,
  403 or 429 means "blocked" under ADR-0011: stop, warn, and don't retry from somewhere else.

**Design.** The full design is in the HLD §3 "Reddit signals" and LLD §3.11.
- **Gather** from a short, hand-picked list of subreddits, plus Reddit-wide search with airport
  queries ("BLR duty free", "Kempegowda duty free", "Schiphol duty free whisky"). Only airports
  that appear in someone's trip are searched, not all 3,200. The job runs weekly, not daily,
  because opinions don't change every day.
- **Extract with rules, not an LLM.** We match products through our own catalogue
  (`match_key`, plus a new `product_aliases` table for nicknames like "JW Blue"). Sentiment
  comes from a small cue-word list, and prices from a currency-and-amount regex next to a
  matched product. Why not an LLM: the training clause makes sending Reddit text to a model
  a grey area, rules can be tested and cost nothing, and we can explain every mention. An
  LLM can come back as an extractor later, behind G1, if the rules' recall is too low.
- **Rank in SQL.** Each mention adds sentiment × recency (half-life of 180 days) × votes
  (`1 + log2(1 + score)`). One comment counts each product at most once, and one thread gives a
  product at most 3 mentions, so a single busy thread can't decide the ranking. A product is
  shown only when it has mentions from at least 3 different threads. Otherwise the app says
  "not enough Reddit chatter yet".
- **Keep Reddit prices separate.** They go in their own table (`reddit_price_reports`), never
  in `prices` and never in `latest_prices`. They are therefore never part of the cheapest-first
  sort or the "you save ₹X" maths. In the app they always appear as "Reported on Reddit, 12 Mar
  2026" with a link to the comment, and only when the report is under 12 months old. "Newest"
  means the comment's creation time, not when we fetched it.
- **Store as little as possible, and delete when the author does.** We keep the thing ID,
  permalink, subreddit, creation time, score and what we extracted. We don't keep usernames. We
  keep comment text for no more than 30 days (matching ADR-0018), so a better extractor can
  re-run. After that the text is set to NULL. Every week we look up every stored ID through
  `/api/info` (100 per call). If an item has been deleted or removed, we delete its row, and
  foreign-key `ON DELETE CASCADE` removes its mentions and prices, so the ranking is correct
  straight away. Fixtures in the repo are synthetic and contain no real Reddit text.

## Consequences
- Good: a new "what to buy here" feature with no shop's cooperation. Every number in the app
  shows where it came from, so a wrong mention is a link away from being checked.
- Good: deletions propagate through one mechanism, the cascade, rather than through every
  query having to remember a filter.
- Bad: rules have low recall. Slang, typos and bottles that aren't in our catalogue get
  missed. We'll measure recall on a labelled sample before trusting the ranking.
- Bad: **airport attribution is the hard part.** A comment in a "BLR duty free" thread may be
  about Dubai. Our rule: if the comment names an airport, use that one. Otherwise use the
  thread's airport, but only if the title names exactly one. Otherwise drop the mention. This
  loses data in exchange for not being wrong.
- Bad: the feature is locked out of monetisation until Reddit says yes. G3 has to be
  remembered when ads are discussed, so it's in the HLD's "What a staff engineer would watch
  next".
- Bad: if Reddit has closed new access requests, G2 may never be met. Then the fallback is
  option 5.

## Clauses we rely on (to be filled in at G1)
| Topic | Document, section | Quote | Effect on the design |
|---|---|---|---|
| Retention limit | | | |
| Deleting content users remove | | | |
| Derived data and aggregates | | | |
| Display and attribution | | | |
| Use with ML / LLMs (inference, not training) | | | |

## Revisit when
- G1 changes any part of the design (likely: the retention window or attribution format), or
- we want ads or a paid tier: apply for commercial access first (option 3), or
- recall on the labelled sample is below 60%: try an LLM extractor if G1 allows it, or
- our own travellers' votes (option 5) cover an airport well: blend them in, or replace Reddit there.
