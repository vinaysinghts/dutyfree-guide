/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_HISTORY, LIMITS, activeNudge, fireTimeFor, ignoredStreak, planNudges, recordDismissed, recordOpened,
  recordScheduled, recordSnap, settle, type NudgeHistory, type NudgeStop,
} from './nudge';

const BLR: NudgeStop = { iata: 'BLR', tz: 'Asia/Kolkata' };
const DXB: NudgeStop = { iata: 'DXB', tz: 'Asia/Dubai' };
const AMS: NudgeStop = { iata: 'AMS', tz: 'Europe/Amsterdam' };
const NOW = new Date('2026-11-15T06:00:00Z');

test('no dates, no reminders', () => {
  assert.deepEqual(planNudges([BLR, DXB], EMPTY_HISTORY, NOW), []);
});

test('flight time: remind 75 minutes before departure, in airport time', () => {
  // DXB 09:40 local = 05:40Z, minus 75 min = 04:25Z.
  const t = fireTimeFor({ ...DXB, date: '2026-11-20', time: '09:40' });
  assert.equal(t?.kind, 'flight');
  assert.equal(t?.at.toISOString(), '2026-11-20T04:25:00.000Z');
});

test('date only: remind at 08:00 airport time', () => {
  const t = fireTimeFor({ ...BLR, date: '2026-11-20' });
  assert.equal(t?.kind, 'day');
  assert.equal(t?.at.toISOString(), '2026-11-20T02:30:00.000Z');
});

test('layover day BLR → DXB → AMS: capped at two per day, flight-timed ones first', () => {
  const stops = [
    { ...BLR, date: '2026-11-20' }, // 08:00 IST = 02:30Z (day)
    { ...DXB, date: '2026-11-20', time: '09:40' }, // 04:25Z (flight)
    { ...AMS, date: '2026-11-20', time: '19:00' }, // 19:00 CET = 18:00Z - 75m = 16:45Z (flight)
  ];
  const plan = planNudges(stops, EMPTY_HISTORY, NOW);
  assert.deepEqual(plan.map((p) => p.iata), ['DXB', 'AMS']);
});

test('reminders closer than three hours apart are dropped', () => {
  const stops = [
    { ...BLR, date: '2026-11-20', time: '06:00' }, // 00:30Z - 75m = 23:15Z on the 19th
    { ...DXB, date: '2026-11-20', time: '06:30' }, // 02:30Z - 75m = 01:15Z, 2h later
  ];
  assert.deepEqual(planNudges(stops, EMPTY_HISTORY, NOW).map((p) => p.iata), ['BLR']);
});

test('past stops and the disabled switch schedule nothing', () => {
  const stops = [{ ...BLR, date: '2026-11-10' }];
  assert.deepEqual(planNudges(stops, EMPTY_HISTORY, NOW), []);
  assert.deepEqual(planNudges([{ ...BLR, date: '2026-11-20' }], EMPTY_HISTORY, NOW, false), []);
});

test('never more than maxScheduled pending at once', () => {
  const stops = Array.from({ length: 10 }, (_, i) => ({ ...BLR, iata: `A${i}X`, date: `2026-11-${20 + i}` }));
  assert.equal(planNudges(stops, EMPTY_HISTORY, NOW).length, LIMITS.maxScheduled);
});

test('a recent report at that airport means we do not ask again', () => {
  const h = recordSnap(EMPTY_HISTORY, 'BLR', new Date('2026-11-18T10:00:00Z'));
  assert.deepEqual(planNudges([{ ...BLR, date: '2026-11-20' }], h, NOW), []);
  // On a trip a month later we do.
  assert.equal(planNudges([{ ...BLR, date: '2026-12-20' }], h, NOW).length, 1);
});

test('one reminder per airport per date: once it fired, it is not re-asked', () => {
  const stop = { ...BLR, date: '2026-11-20' };
  let h = recordScheduled(EMPTY_HISTORY, planNudges([stop], EMPTY_HISTORY, NOW), NOW);
  // The traveller then edits the flight time after the reminder fired and was ignored.
  h = settle(h, new Date('2026-11-20T06:00:00Z'));
  assert.equal(h.events[0].outcome, 'ignored');
  assert.deepEqual(planNudges([{ ...stop, time: '23:00' }], h, new Date('2026-11-20T06:00:00Z')), []);
});

test('back off after three ignored reminders; a report resets it', () => {
  let h: NudgeHistory = EMPTY_HISTORY;
  for (const [iata, day] of [['AAA', 1], ['BBB', 2], ['CCC', 3]] as const) {
    h = { ...h, events: [...h.events, { id: iata, iata, date: `2026-11-0${day}`, fireAt: `2026-11-0${day}T08:00:00Z`, outcome: 'ignored' }] };
  }
  assert.equal(ignoredStreak(h), 3);
  assert.deepEqual(planNudges([{ ...BLR, date: '2026-11-20' }], h, NOW), []);
  h = recordSnap(h, 'DXB', new Date('2026-11-10T00:00:00Z'));
  assert.equal(ignoredStreak(h), 0);
  assert.equal(planNudges([{ ...BLR, date: '2026-11-20' }], h, NOW).length, 1);
});

test('opening a reminder breaks the ignored streak', () => {
  let h: NudgeHistory = {
    ...EMPTY_HISTORY,
    events: [
      { id: 'a', iata: 'AAA', date: '2026-11-01', fireAt: '2026-11-01T08:00:00Z', outcome: 'ignored' },
      { id: 'b', iata: 'BBB', date: '2026-11-02', fireAt: '2026-11-02T08:00:00Z', outcome: 'pending' },
    ],
  };
  h = recordOpened(h, 'b');
  assert.equal(ignoredStreak(h), 0);
});

test('recordScheduled forgets unplanned future ones but keeps fired ones', () => {
  const plan = planNudges([{ ...BLR, date: '2026-11-20' }, { ...AMS, date: '2026-11-25' }], EMPTY_HISTORY, NOW);
  let h = recordScheduled(EMPTY_HISTORY, plan, NOW);
  assert.equal(h.events.length, 2);
  // Trip edited: AMS removed. A day after BLR fired, but before settle ran.
  const later = new Date('2026-11-20T03:00:00Z');
  h = recordScheduled(h, [], later);
  assert.deepEqual(h.events.map((e) => e.iata), ['BLR']);
});

test('in-app card: on the travel date, in airport time', () => {
  const stops = [{ ...AMS, date: '2026-11-20' }];
  // 22:30Z on the 19th is already the 20th on this phone (India), but still the 19th in Amsterdam.
  assert.equal(activeNudge(stops, EMPTY_HISTORY, new Date('2026-11-19T22:30:00Z')), null);
  assert.deepEqual(activeNudge(stops, EMPTY_HISTORY, new Date('2026-11-20T09:00:00Z')), { iata: 'AMS', date: '2026-11-20', here: false });
});

test('in-app card: around the flight time, even across midnight', () => {
  const stops = [{ ...DXB, date: '2026-11-21', time: '01:30' }]; // red-eye, 21:30Z on the 20th
  assert.equal(activeNudge(stops, EMPTY_HISTORY, new Date('2026-11-20T17:00:00Z'))?.iata, undefined);
  assert.equal(activeNudge(stops, EMPTY_HISTORY, new Date('2026-11-20T19:00:00Z'))?.iata, 'DXB');
});

const AT_DXB = { iata: 'DXB', tz: 'Asia/Dubai' };

test('in-app card: being at an airport works with no dates at all', () => {
  assert.deepEqual(activeNudge([BLR, DXB], EMPTY_HISTORY, NOW, AT_DXB), { iata: 'DXB', date: '2026-11-15', here: true });
});

test('in-app card: any airport counts, not only the trip ones', () => {
  assert.deepEqual(activeNudge([BLR], EMPTY_HISTORY, NOW, AT_DXB), { iata: 'DXB', date: '2026-11-15', here: true });
  assert.deepEqual(activeNudge([], EMPTY_HISTORY, NOW, AT_DXB)?.iata, 'DXB');
});

test('in-app card: the date at the airport is local to it', () => {
  // 21:00Z on the 15th is already the 16th in Dubai.
  assert.equal(activeNudge([], EMPTY_HISTORY, new Date('2026-11-15T21:00:00Z'), AT_DXB)?.date, '2026-11-16');
});

test('in-app card: someone who lives next to an airport stops seeing it after two dismissals', () => {
  let h = recordDismissed(EMPTY_HISTORY, 'DXB', '2026-11-13');
  assert.equal(activeNudge([], h, NOW, AT_DXB)?.iata, 'DXB');
  h = recordDismissed(h, 'DXB', '2026-11-14');
  assert.equal(activeNudge([], h, NOW, AT_DXB), null);
  // ...unless it's on their trip: then they're really flying from it.
  assert.equal(activeNudge([DXB], h, NOW, AT_DXB)?.iata, 'DXB');
});

test('in-app card: closed or already reported means gone', () => {
  const stops = [{ ...BLR, date: '2026-11-15' }];
  assert.equal(activeNudge(stops, recordDismissed(EMPTY_HISTORY, 'BLR', '2026-11-15'), NOW), null);
  assert.equal(activeNudge(stops, recordSnap(EMPTY_HISTORY, 'BLR', NOW), NOW), null);
});
