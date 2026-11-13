/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, isLocalDate, isLocalTime, localDateAt, offsetMinutes, zonedToInstant } from './zonedTime';

test('zonedToInstant reads the time in the airport zone, not the phone zone', () => {
  // 09:40 in Dubai (UTC+4) is 05:40 UTC, wherever the phone is.
  assert.equal(zonedToInstant('2026-11-20', '09:40', 'Asia/Dubai').toISOString(), '2026-11-20T05:40:00.000Z');
  // India and Nepal have half- and quarter-hour offsets.
  assert.equal(zonedToInstant('2026-11-20', '06:00', 'Asia/Kolkata').toISOString(), '2026-11-20T00:30:00.000Z');
  assert.equal(zonedToInstant('2026-11-20', '06:00', 'Asia/Kathmandu').toISOString(), '2026-11-20T00:15:00.000Z');
});

test('zonedToInstant handles Amsterdam summer and winter time', () => {
  assert.equal(zonedToInstant('2026-07-01', '12:00', 'Europe/Amsterdam').toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(zonedToInstant('2026-12-01', '12:00', 'Europe/Amsterdam').toISOString(), '2026-12-01T11:00:00.000Z');
});

test('zonedToInstant: a time skipped by spring-forward lands an hour later', () => {
  // 29 Mar 2026: Amsterdam clocks jump 02:00 → 03:00. 02:30 never happens; we pick 03:30 CEST.
  assert.equal(zonedToInstant('2026-03-29', '02:30', 'Europe/Amsterdam').toISOString(), '2026-03-29T01:30:00.000Z');
});

test('zonedToInstant: a time repeated by fall-back is a valid instant either way', () => {
  // 25 Oct 2026: 02:30 happens twice (CEST then CET). Either answer reads 02:30 locally.
  const t = zonedToInstant('2026-10-25', '02:30', 'Europe/Amsterdam');
  assert.ok(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'].includes(t.toISOString()), t.toISOString());
});

test('localDateAt: the same instant is a different date in Bengaluru and Amsterdam', () => {
  const t = new Date('2026-11-19T20:00:00Z'); // 01:30 on the 20th in India, 21:00 on the 19th in NL
  assert.equal(localDateAt(t, 'Asia/Kolkata'), '2026-11-20');
  assert.equal(localDateAt(t, 'Europe/Amsterdam'), '2026-11-19');
});

test('offsetMinutes falls back to the phone zone for unknown zones', () => {
  const t = Date.parse('2026-11-20T00:00:00Z');
  assert.equal(offsetMinutes(t, 'Not/AZone'), -new Date(t).getTimezoneOffset());
  assert.equal(offsetMinutes(t, 'Asia/Kolkata'), 330);
});

test('validators and addDays', () => {
  assert.ok(isLocalDate('2026-02-28'));
  assert.ok(!isLocalDate('2026-02-30'));
  assert.ok(!isLocalDate('20-11-2026'));
  assert.ok(isLocalTime('23:59') && !isLocalTime('24:00') && !isLocalTime('9:40'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
