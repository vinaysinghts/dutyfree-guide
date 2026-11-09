# ADR-0002: Supabase (Postgres + RLS) with no custom API server

**Status:** accepted, 2026-11-09

## Context
The workload is relational: "latest price per product per shop at these airports, converted with
today's rate, cheapest first" is a join plus a window-style pick. We also need auth (only for
reports), file storage (shelf photos) and a free tier.

## Options
| Option | For | Against |
|---|---|---|
| **Supabase** | Real Postgres (joins, views, constraints); auto REST API; Auth; Storage; RLS; generous free tier; can self-host later | Business logic partly in SQL/RLS, which is less familiar; vendor features (auth, storage) |
| Firebase | Very quick start; great mobile SDKs | NoSQL: cross-airport comparisons need denormalized copies or client-side joins |
| Own API (FastAPI/Express) + Postgres | Full control; logic in one language | An extra service to build, host, secure and keep alive, all for CRUD |

## Decision
Supabase. The app reads the `latest_prices` view directly; authorization is enforced by
**row level security**, not by an API layer. Privileged writes go through a `SECURITY DEFINER`
function (`review_submission`) or the scraper's service-role key.

## Consequences
- 👍 No server to run. The "API" is the schema, so its design matters (see LLD §2).
- 👍 Constraints (CHECK, UNIQUE, FK) protect data no matter which client writes it.
- 👎 RLS mistakes are security bugs. Mitigation: SQL tests in CI (`supabase/tests`).
- 👎 The anon key is public by design; anything not covered by RLS is exposed. Every new table must enable RLS.

## Revisit when
We need logic that's awkward in SQL (e.g. ML matching, payments), then add an Edge Function or a small service beside it rather than replacing it.
