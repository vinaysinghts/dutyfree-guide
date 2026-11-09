/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rankProducts } from './compare';
import type { PriceRow } from './types';

const row = (over: Partial<PriceRow>): PriceRow => ({
  product_id: 1,
  retailer_id: 1,
  airport_iata: 'BLR',
  retailer_name: 'BLR Duty Free',
  brand: 'Johnnie Walker',
  product_name: 'Black Label 1L',
  volume_ml: 1000,
  category: 'spirits',
  image_url: null,
  price: 3450,
  currency: 'INR',
  price_inr: 3450,
  source: 'scraped',
  product_url: null,
  observed_at: '2026-11-09T00:00:00Z',
  ...over,
});

test('cheapest airport comes first and saving is computed against the dearest', () => {
  const [jw] = rankProducts([
    row({}),
    row({ airport_iata: 'AMS', retailer_id: 2, price: 32.99, currency: 'EUR', price_inr: 3150.55 }),
  ]);
  assert.equal(jw.best.airport_iata, 'AMS');
  assert.deepEqual(jw.offers.map((o) => o.airport_iata), ['AMS', 'BLR']);
  assert.equal(jw.savingInr, 299.45);
});

test('products are ordered by their best INR price', () => {
  const ranked = rankProducts([
    row({ product_id: 1, price_inr: 3450 }),
    row({ product_id: 2, product_name: 'Absolut 1L', brand: 'Absolut', price_inr: 1650 }),
  ]);
  assert.deepEqual(ranked.map((p) => p.productId), [2, 1]);
});

test('offers without an exchange rate sort last and do not count toward savings', () => {
  const [jw] = rankProducts([
    row({}),
    row({ airport_iata: 'DXB', retailer_id: 3, currency: 'AED', price: 120, price_inr: null, source: 'crowd' }),
  ]);
  assert.deepEqual(jw.offers.map((o) => o.airport_iata), ['BLR', 'DXB']);
  assert.equal(jw.savingInr, null);
});

test('one offer per airport: the cheaper of shop price and traveller report wins', () => {
  const [jw] = rankProducts([
    row({ retailer_id: 1, price_inr: 3450 }),
    row({ retailer_id: 9, retailer_name: 'Reported by travellers', price_inr: 3300, source: 'crowd' }),
  ]);
  assert.equal(jw.offers.length, 1);
  assert.equal(jw.best.source, 'crowd');
});

test('search filters by brand or name', () => {
  const ranked = rankProducts(
    [row({ product_id: 1 }), row({ product_id: 2, brand: 'Absolut', product_name: 'Vodka 1L' })],
    { query: 'absol' },
  );
  assert.deepEqual(ranked.map((p) => p.productId), [2]);
});
