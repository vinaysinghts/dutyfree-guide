import type { Offer, PriceRow, RankedProduct } from './types';

/**
 * Turns flat price rows into one entry per bottle, ranked so the bottle with
 * the cheapest INR price on the trip comes first.
 *
 * Kept free of React and Supabase so it can be unit tested and reused (e.g.
 * on a server for SEO pages later).
 */
export function rankProducts(rows: PriceRow[], opts: { query?: string } = {}): RankedProduct[] {
  const query = opts.query?.trim().toLowerCase();
  const byProduct = new Map<number, PriceRow[]>();
  for (const row of rows) {
    if (query && !`${row.brand ?? ''} ${row.product_name}`.toLowerCase().includes(query)) continue;
    const list = byProduct.get(row.product_id) ?? [];
    list.push(row);
    byProduct.set(row.product_id, list);
  }

  const ranked: RankedProduct[] = [];
  for (const [productId, productRows] of byProduct) {
    const offers = cheapestPerAirport(productRows).sort(compareOffers);
    const [first] = productRows;
    const best = offers[0];
    const priced = offers.filter((o) => o.price_inr != null);
    const worst = priced[priced.length - 1];
    ranked.push({
      productId,
      name: first.product_name,
      brand: first.brand,
      volumeMl: first.volume_ml,
      imageUrl: first.image_url,
      offers,
      best,
      savingInr:
        priced.length > 1 && best.price_inr != null && worst.price_inr != null
          ? round2(worst.price_inr - best.price_inr)
          : null,
    });
  }

  // Bottles with a known INR price first (cheapest first); unknown-FX ones last.
  return ranked.sort((a, b) => compareOffers(a.best, b.best) || a.name.localeCompare(b.name));
}

/** If one airport has several retailers (shop + traveller reports), keep its cheapest offer. */
function cheapestPerAirport(rows: PriceRow[]): Offer[] {
  const byAirport = new Map<string, Offer>();
  for (const row of rows) {
    const offer = toOffer(row);
    const current = byAirport.get(row.airport_iata);
    if (!current || compareOffers(offer, current) < 0) byAirport.set(row.airport_iata, offer);
  }
  return [...byAirport.values()];
}

function compareOffers(a: Offer, b: Offer): number {
  if (a.price_inr == null && b.price_inr == null) return 0;
  if (a.price_inr == null) return 1;
  if (b.price_inr == null) return -1;
  if (a.price_inr !== b.price_inr) return a.price_inr - b.price_inr;
  // Same price: prefer shop data over traveller reports, then the fresher one.
  if (a.source !== b.source) return a.source === 'scraped' ? -1 : 1;
  return b.observed_at.localeCompare(a.observed_at);
}

function toOffer(row: PriceRow): Offer {
  const { airport_iata, retailer_name, price, currency, price_inr, source, product_url, observed_at } = row;
  return { airport_iata, retailer_name, price, currency, price_inr, source, product_url, observed_at };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
