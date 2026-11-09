/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { choosePrice, findPriceCandidates, parseAmount, parseShelfTag, parseVolumeMl } from './shelfTag';

test('parseAmount handles European and Indian formats', () => {
  assert.equal(parseAmount('32,99'), 32.99);
  assert.equal(parseAmount('3,450'), 3450);
  assert.equal(parseAmount('3.450,00'), 3450);
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount('3.450'), 3450);
  assert.equal(parseAmount('29.9'), 29.9);
});

test('parseVolumeMl', () => {
  assert.equal(parseVolumeMl('JW Black 1L 40% vol'), 1000);
  assert.equal(parseVolumeMl('70 cl'), 700);
  assert.equal(parseVolumeMl('1,5 L'), 1500);
  assert.equal(parseVolumeMl('no size'), null);
});

test('Schiphol-style tag: picks our price over high-street and per-litre', () => {
  const draft = parseShelfTag(
    ['JOHNNIE WALKER', 'Black Label', 'Blended Scotch Whisky', '1L 40% vol',
     'High street price € 45,99', '€ 32,99', '€ 32,99 / L'].join('\n'),
  );
  assert.equal(draft.price, 32.99);
  assert.equal(draft.currency, 'EUR');
  assert.equal(draft.volumeMl, 1000);
  assert.equal(draft.brand, 'Johnnie Walker');
  assert.equal(draft.productName, 'Black Label');
  assert.ok(draft.confidence >= 0.9);
});

test('Bengaluru-style tag in rupees with was/now', () => {
  const draft = parseShelfTag(['Glenfiddich 12 Year Old', '1000 ml', 'MRP Rs. 4,800', 'Was ₹ 4,800', 'Now ₹ 4,300'].join('\n'));
  assert.equal(draft.price, 4300);
  assert.equal(draft.currency, 'INR');
  assert.equal(draft.brand, 'Glenfiddich');
  assert.equal(draft.productName, '12 Year Old');
});

test('multi-buy offers are not taken as the single-bottle price', () => {
  const draft = parseShelfTag(['Absolut Vodka 1L', 'AED 79.00', '2 for AED 140.00'].join('\n'));
  assert.equal(draft.price, 79);
  assert.equal(draft.currency, 'AED');
  const kinds = draft.candidates.map((c) => c.kind);
  assert.deepEqual(kinds, ['price', 'multibuy']);
});

test('ABV, years and article numbers are not prices', () => {
  const candidates = findPriceCandidates(['Glenmorangie 10 years', '43% vol', 'Art. 123456', '70cl']);
  assert.equal(candidates.length, 0);
});

test('falls back to the airport currency when the tag shows none', () => {
  const draft = parseShelfTag("Hendrick's Gin\n1L\n34.99", { defaultCurrency: 'EUR' });
  assert.equal(draft.price, 34.99);
  assert.equal(draft.currency, 'EUR');
  assert.equal(draft.brand, "Hendrick's");
});

test('OCR without apostrophes still finds the brand', () => {
  assert.equal(parseShelfTag('JACK DANIELS Old No.7\n1L\n$ 24.99').brand, "Jack Daniel's");
});

test('nothing readable gives an empty, zero-confidence draft', () => {
  const draft = parseShelfTag('');
  assert.equal(draft.price, null);
  assert.equal(draft.confidence, 0);
  assert.equal(choosePrice([]), null);
});

// Real Tesseract output from rendered sample tags (see docs/problems-log.md #5).
test('real OCR: Schiphol tag where the per-litre price lost its decimal point', () => {
  const ocr = 'JOHNNIE WALKER\nBlack Label\n\nBlended Scotch Whisky\n\n1L 40% vol\n\nHigh street price € 45,99\n\n€ 32,99\n\n€3299/L\n';
  const draft = parseShelfTag(ocr, { defaultCurrency: 'EUR' });
  assert.equal(draft.price, 32.99);
  assert.equal(draft.currency, 'EUR');
  assert.equal(draft.volumeMl, 1000);
});

test('real OCR: rupee sign misread as yen, size line lost', () => {
  const ocr = 'Glenfiddich\n\n12 Year Old Single Malt\nWest as00\n\nNow ¥ 4,300\n';
  const draft = parseShelfTag(ocr, { defaultCurrency: 'INR' });
  assert.equal(draft.price, 4300);
  assert.equal(draft.currency, 'INR');
  assert.equal(draft.brand, 'Glenfiddich');
  assert.equal(draft.volumeMl, null);
});
