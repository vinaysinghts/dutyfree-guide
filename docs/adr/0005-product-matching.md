# ADR-0005: Rule-based product matching (`match_key`)

**Status:** accepted, 2026-11-09

## Context
Comparing across airports only works if the same bottle is recognized under different names:
"Johnnie Walker Black Label 1L" vs "JOHNNIE WALKER Black Label Blended Scotch Whisky 100cl".

## Options
- **Normalized key (chosen):** deterministic rules (strip size, noise words, normalize age), plus volume. Explainable, testable, zero cost.
- Fuzzy matching (trigram / token-set ratio): catches more, but needs thresholds and creates false merges.
- Barcodes (EAN/GTIN): perfect when available, but listings rarely expose them.
- ML embeddings: overkill now.

## Decision
`match_key` for automatic matching, plus a manual override at review time
(`p_existing_product_id`) for crowd reports.

## Consequences
- 👎 Misses variants like "JW Black" or "Black Label 12". Measure the match rate before investing more.
- 👎 The SQL fallback in `review_submission` is a simpler normalizer than Python's, which is why reviewers can link to an existing product.

## Revisit when
The share of products seen at ≥2 airports stops growing as we add retailers.
