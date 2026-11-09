# ADR-0006: Crowd prices are shown only after human review

**Status:** accepted, 2026-11-09 (requested by product owner)

## Context
Crowd reports fill gaps where no online shop exists, but a single wrong price at the top of a
"cheapest" list misleads every user.

## Decision
Reports land in `price_submissions` as `pending`; RLS hides them from everyone except the
submitter and admins. `review_submission()` publishes approved ones as `source='crowd'` prices,
labelled "reported by a traveller on <date>" in the app. Optional shelf-tag photo as evidence,
stored in a private bucket.

## Consequences
- 👍 Trust: nothing unreviewed is public.
- 👎 Someone has to review. Later: auto-approve when it matches a recent scraped price within ±10%, or after N agreeing reports.
