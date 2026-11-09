/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AT_AIRPORT_KM, distanceKm, gpsFromExif, nearestAirport, takenAtFromExif } from './geo';

const AMS = { iata: 'AMS', name: 'Schiphol', city: 'Amsterdam', country_code: 'NL', latitude: 52.3086, longitude: 4.7639 };
const BLR = { iata: 'BLR', name: 'Kempegowda', city: 'Bengaluru', country_code: 'IN', latitude: 13.1979, longitude: 77.7063 };

test('distanceKm: AMS to BLR is about 7,690 km', () => {
  const km = distanceKm(AMS, BLR);
  assert.ok(km > 7650 && km < 7750, String(km));
});

test('a photo taken in Schiphol Lounge 2 is at AMS', () => {
  const hit = nearestAirport({ latitude: 52.3105, longitude: 4.7683 }, [AMS, BLR]);
  assert.equal(hit?.airport.iata, 'AMS');
  assert.ok(hit!.km < AT_AIRPORT_KM);
});

test('a photo taken in central Amsterdam is near AMS but not at it', () => {
  const hit = nearestAirport({ latitude: 52.3731, longitude: 4.8926 }, [AMS, BLR]);
  assert.equal(hit?.airport.iata, 'AMS');
  assert.ok(hit!.km > AT_AIRPORT_KM);
});

test('EXIF GPS in degrees/minutes/seconds with hemisphere refs', () => {
  assert.deepEqual(
    gpsFromExif({ GPSLatitude: [13, 11, 52.44], GPSLatitudeRef: 'N', GPSLongitude: [77, 42, 22.68], GPSLongitudeRef: 'E' }),
    { latitude: 13 + 11 / 60 + 52.44 / 3600, longitude: 77 + 42 / 60 + 22.68 / 3600 },
  );
  assert.deepEqual(gpsFromExif({ GPSLatitude: 33.9, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'E' }), { latitude: -33.9, longitude: 151.2 });
  assert.equal(gpsFromExif({}), null);
});

test('EXIF timestamp', () => {
  assert.equal(takenAtFromExif({ DateTimeOriginal: '2026:11:09 07:12:30' })?.getFullYear(), 2026);
  assert.equal(takenAtFromExif({ DateTimeOriginal: 'garbage' }), null);
});
