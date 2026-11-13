# ADR-0012: Let users pick the currency prices are shown in

**Status:** proposed (roadmap), 2026-11-11. Not built yet.

## Context
Everything is shown in INR today. The ranking, the "you save" figure and the `latest_prices` view
all use `price_inr`. A traveller from Europe or the Gulf wants euros or dirhams, and some people
want to see the price as it is on the shelf.

What we already have:
- `fx_rates(currency, rate_to_inr, as_of)`: INR per 1 unit, refreshed daily from Frankfurter
  (ECB reference rates) by the scrape job.
- `latest_prices.price_inr`, which is computed at read time from the latest rate.
- The original `price` and `currency` are kept on every row.

## Options
1. **Convert on the server**, with a `?currency=EUR` parameter or a view per currency. Every
   query has to carry the currency. Cached responses split by currency. Ranking logic would
   move into SQL.
2. **Store prices in every currency.** N times the rows, and they go stale whenever rates move.
   No.
3. **Keep INR as the internal "pivot", convert on the device just before display.** Chosen.

## Decision
- **INR stays the pivot.** Ranking, savings and matching keep working in INR. Converting to
  display currency D is `amount_D = amount_INR / rate_to_inr[D]`, a cross rate through INR. The
  ECB publishes everything against EUR and Frankfurter already does this maths, so it adds no
  error that matters.
- **Why ranking doesn't need to change:** converting every price by the same positive factor
  keeps their order. "Cheapest in INR" is "cheapest in EUR". Only labels change, so conversion is
  presentation, and presentation lives in the client.
- **Where:** the app downloads `fx_rates` (about 10 rows) with the prices and converts in one
  place, `format.ts` (`formatPrice(amountInr, display)`). The server API stays the same.
- **Rounding:** round **once, at display**, never before converting (rounding then converting
  rounds twice and can flip near-ties). Compare and sort on unrounded values. Use
  `Intl.NumberFormat` for each currency's decimals and symbols: no decimals for INR and JPY, two
  for EUR. Savings under one display unit read as "about the same".
- **Shelf price wins.** A converted figure is an estimate, so it gets "≈". The original price is
  always shown next to it, e.g. "≈ €41 · ₹3,820 on the shelf". When display currency = shelf
  currency, show the exact price with no "≈".
- **Stale or missing rates:** show "Rates from 8 Nov" in the price header. If a rate is more
  than 3 days old, mark converted prices as possibly out of date. If a currency has no rate,
  show the shelf price only and sort that bottle last (the ranking already does this for unknown
  FX).
- **Picking the currency:** default from the phone's region (`expo-localization`), change it in
  a settings picker, and save it on the device. It moves to the account once accounts exist.
- **Rates the job fetches:** every retailer currency, plus every currency the picker offers.

## Consequences
- Good: no schema or API change, one small client module, and offline-friendly (rates are cached
  with prices).
- Bad: what users pay differs from what we show. ECB reference rates are mid-market; a card
  usually adds a 2–3.5% markup, and dynamic currency conversion (DCC) at the till can add more.
  Add a one-line tip: "Pay in the local currency; decline the offer to charge you in your home
  currency."
- **Risk to check before building:** the ECB list doesn't include some Gulf currencies (AED,
  QAR). Dubai and Doha are major duty-free stops, so confirm Frankfurter returns them, or add a
  second rates source for those.

## Revisit when
- We show prices on the web for SEO. Search engines need the server to render prices, which
  argues for server-side conversion with a URL parameter.
- We add price alerts in the user's currency. Alerts need a stored currency per user.
