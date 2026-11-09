/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fold, searchAirportList } from './airportSearch';
import { allAirports } from './airports';

const top = (q: string) => searchAirportList(allAirports(), q, 5).map((a) => a.iata);

test('fold strips accents and punctuation', () => {
  assert.equal(fold('EuroAirport Basel–Mulhouse–Freiburg'), 'euroairport basel mulhouse freiburg');
  assert.equal(fold('São Paulo/Guarulhos'), 'sao paulo guarulhos');
  assert.equal(fold('İstanbul'), 'istanbul');
});

test('Basel is found by every name and code it goes by', () => {
  for (const q of ['basel', 'Basel airport', 'Bâle', 'bale', 'basle', 'mulhouse', 'BSL', 'MLH', 'EAP', 'LFSB', 'euroairport', 'basel-mulhouse']) {
    assert.equal(top(q)[0], 'BSL', q);
  }
});

test('old and local city names', () => {
  assert.equal(top('bangalore')[0], 'BLR');
  assert.equal(top('bombay')[0], 'BOM');
  assert.equal(top('zurich')[0], 'ZRH');
  assert.equal(top('Zürich')[0], 'ZRH');
  assert.ok(top('sao paulo').includes('GRU'));
  assert.equal(top('munchen')[0], 'MUC');
});

test('an exact IATA code beats a name that merely contains it', () => {
  assert.equal(top('ams')[0], 'AMS');
  assert.equal(top('del')[0], 'DEL');
  assert.equal(top('dxb')[0], 'DXB');
});

test('a city with several airports lists the big ones first', () => {
  const london = top('london');
  assert.ok(london.includes('LHR') && london.includes('LGW'), london.join());
});

test('very short or empty queries return nothing', () => {
  assert.deepEqual(top(''), []);
  assert.deepEqual(top('a'), []);
});
