/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeCoverage, describeTrip, type AirportCoverage } from './coverage';

const now = new Date('2026-11-13T12:00:00Z');
const row = (over: Partial<AirportCoverage>): AirportCoverage => ({
  airport_iata: 'BLR',
  scraper: 'live',
  paused_reason: null,
  last_scraped_at: '2026-11-13T01:30:00Z',
  crowd_products: 0,
  last_reported_at: null,
  ...over,
});

test('a scraper that ran today is live and needs no explanation', () => {
  const note = describeCoverage('BLR', row({}), now);
  assert.equal(note.kind, 'live');
  assert.equal(note.detail, '');
  assert.equal(note.askForPhoto, false);
});

test('a live scraper with only old prices is stale, and says since when', () => {
  const note = describeCoverage('BLR', row({ last_scraped_at: '2026-11-08T01:30:00Z' }), now);
  assert.equal(note.kind, 'stale');
  assert.match(note.detail, /since 8 Nov/);
  assert.equal(note.askForPhoto, true);
});

test('a live scraper that has never saved a price is stale too', () => {
  assert.equal(describeCoverage('BLR', row({ last_scraped_at: null }), now).kind, 'stale');
});

test('issue #24, AMS: a paused scraper gives its reason and counts traveller prices', () => {
  const note = describeCoverage(
    'AMS',
    row({
      airport_iata: 'AMS',
      scraper: 'paused',
      paused_reason: "Schiphol's shop blocks automated price checks, and we don't get around that.",
      last_scraped_at: null,
      crowd_products: 3,
      last_reported_at: '2026-11-10T09:00:00Z',
    }),
    now,
  );
  assert.equal(note.kind, 'travellers');
  assert.equal(note.label, 'Traveller prices only');
  assert.match(note.detail, /^Schiphol's shop blocks/);
  assert.match(note.detail, /3 bottles reported so far, latest on 10 Nov\.$/);
  assert.doesNotMatch(note.detail, /collected yet/);
});

test('a reason without a full stop still reads as a sentence', () => {
  const note = describeCoverage('AMS', row({ scraper: 'paused', paused_reason: 'Blocked by the site' }), now);
  assert.match(note.detail, /^Blocked by the site\. AMS prices/);
});

test('issue #24, BSL and DXB: no retailer row at all means travellers only, first report invited', () => {
  const [bsl, dxb] = describeTrip(['BSL', 'DXB'], [], now);
  for (const [iata, note] of [['BSL', bsl], ['DXB', dxb]] as const) {
    assert.equal(note.iata, iata);
    assert.equal(note.kind, 'travellers');
    assert.equal(note.askForPhoto, true);
    assert.match(note.detail, new RegExp(`price feed for the ${iata} shop yet`));
    assert.match(note.detail, /yours would be the first/);
  }
});

test('describeTrip keeps trip order and matches rows by airport', () => {
  const notes = describeTrip(
    ['AMS', 'BLR', 'BSL', 'DXB'],
    [row({}), row({ airport_iata: 'AMS', scraper: 'paused', paused_reason: 'Blocked.' })],
    now,
  );
  assert.deepEqual(notes.map((n) => `${n.iata}:${n.kind}`), ['AMS:travellers', 'BLR:live', 'BSL:travellers', 'DXB:travellers']);
});

test('one bottle is singular', () => {
  const note = describeCoverage('DXB', row({ airport_iata: 'DXB', scraper: 'none', crowd_products: 1 }), now);
  assert.match(note.detail, /1 bottle reported so far\.$/);
});
