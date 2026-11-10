/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatArgs, record, recentLogs, redact } from './diagnostics';
import { newIssueUrl, shareableContext, recentCapture, stashCapture, validateReport, type IssueContext } from './issueReport';

const ctx: IssueContext = {
  app: { version: '1.0.0', build: '3', demo: true },
  device: { platform: 'web' },
  screen: '/prices',
  trip: ['AMS', 'BLR'],
  recent_logs: [{ level: 'error', at: '2026-11-10T00:00:00Z', message: 'boom' }],
};

test('validateReport: needs a few words, caps length and screenshots', () => {
  assert.equal(validateReport({ description: '  ', screenshotUris: [] }), 'Tell us briefly what happened.');
  assert.equal(validateReport({ description: 'Prices empty', screenshotUris: [] }), null);
  assert.match(validateReport({ description: 'x'.repeat(4001), screenshotUris: [] }) ?? '', /under 4000/);
  assert.match(validateReport({ description: 'ok ok', screenshotUris: ['a', 'b', 'c', 'd', 'e'] }) ?? '', /Up to 4/);
});

test('shareableContext: drops the trip and logs when the user opts out', () => {
  const c = shareableContext(ctx, { includeTrip: false, includeLogs: false });
  assert.equal(c.trip, undefined);
  assert.equal(c.recent_logs, undefined);
  assert.equal(c.screen, '/prices');
  assert.deepEqual(shareableContext(ctx, { includeTrip: true, includeLogs: true }).trip, ['AMS', 'BLR']);
});

test('newIssueUrl: prefilled GitHub issue for demo mode', () => {
  const url = new URL(newIssueUrl({ category: 'bug', description: 'Prices empty\nmore detail', context: ctx }));
  assert.equal(url.pathname, '/vinaysinghts/dutyfree-guide/issues/new');
  assert.equal(url.searchParams.get('title'), '[App] Prices empty');
  assert.match(url.searchParams.get('body') ?? '', /- Trip: AMS → BLR/);
  assert.equal(url.searchParams.get('labels'), 'from-app');
});

test('capture stash: readable more than once, expires after 30 s', () => {
  stashCapture({ uri: 'file:///shot.jpg', screen: '/' }, 1_000);
  assert.deepEqual(recentCapture(2_000), { uri: 'file:///shot.jpg', screen: '/' });
  assert.deepEqual(recentCapture(3_000), { uri: 'file:///shot.jpg', screen: '/' });
  assert.equal(recentCapture(40_000), null);
});

test('redact: tokens and keys never reach a report', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-';
  assert.equal(redact(`auth failed for ${jwt}`), 'auth failed for [jwt]');
  assert.equal(redact('key sb_secret_abc123XYZ'), 'key [key]');
  assert.equal(redact('ghp_' + 'a'.repeat(36)), '[token]');
  assert.equal(redact('GET /x?apikey=s3cr3t&y=1'), 'GET /x?apikey=[redacted]&y=1');
});

test('diagnostics: keeps the last 25 entries, errors formatted', () => {
  for (let i = 0; i < 30; i++) record('warn', [`w${i}`]);
  record('error', [new TypeError('x is undefined')]);
  const logs = recentLogs();
  assert.equal(logs.length, 25);
  assert.equal(logs.at(-1)?.message, 'TypeError: x is undefined');
  assert.equal(formatArgs(['a', { b: 1 }]), 'a {"b":1}');
});
