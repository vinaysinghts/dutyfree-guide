import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildIssue, issueTitle, neutralize, reportMarker, type IssueReportRow } from './issue.ts';

const report: IssueReportRow = {
  id: 7,
  created_at: '2026-11-10T15:30:00Z',
  reporter: 'abcdef12-3456-7890-abcd-ef1234567890',
  category: 'bug',
  description: 'Prices tab shows nothing for BLR\nIt was fine yesterday. cc @someone',
  screenshot_paths: ['abcdef12-3456-7890-abcd-ef1234567890/r/1.jpg'],
  context: {
    app: { version: '1.0.0', build: '12', demo: false },
    device: { platform: 'android', os_version: '15', model: 'Pixel 8', screen: '412x915', locale: 'en-IN' },
    screen: '/prices',
    trip: ['AMS', 'BLR'],
    recent_logs: [{ level: 'error', at: '2026-11-10T15:29:58Z', message: 'TypeError: x is undefined ``` oops' }],
  },
};

test('title: category, screen and the first line of the description', () => {
  assert.equal(buildIssue(report, []).title, '[App] Bug (/prices): Prices tab shows nothing for BLR');
});

test('title: long first lines are cut at a word boundary', () => {
  const t = issueTitle('idea', 'Please add a way to compare prices between three airports at once without retyping everything', undefined);
  assert.ok(t.startsWith('[App] Idea: Please add a way'), t);
  assert.ok(t.endsWith('…'), t);
  assert.ok(t.length < 100, t);
});

test('body: screenshots, context table, logs, and the report marker', () => {
  const { body, labels } = buildIssue(report, ['https://example.test/signed/1.jpg']);
  assert.match(body, /<img src="https:\/\/example.test\/signed\/1.jpg"/);
  assert.match(body, /\| Trip \| AMS → BLR \|/);
  assert.match(body, /\| Platform \| android 15 \|/);
  assert.match(body, /\| Reporter \| anonymous abcdef12 \|/);
  assert.ok(!body.includes('3456-7890'), 'full reporter id must not be published');
  assert.match(body, /Recent app errors and warnings \(1\)/);
  assert.ok(body.trimEnd().endsWith(reportMarker(7)));
  assert.deepEqual(labels, ['from-app', 'bug']);
});

test('body: a log line full of backticks cannot break out of its code block', () => {
  const { body } = buildIssue(report, []);
  assert.match(body, /\n````\n/); // fence is longer than the ``` inside the log
});

test('neutralize: no @mentions and no HTML comment tricks', () => {
  assert.equal(neutralize('ping @vinaysinghts'), 'ping @​vinaysinghts');
  assert.equal(neutralize('a --> b <!-- c'), 'a  b  c');
  assert.equal(neutralize('email me at a@b.com'), 'email me at a@​b.com');
});

test('labels: wrong price maps to its own label', () => {
  assert.deepEqual(buildIssue({ ...report, category: 'wrong_price' }, []).labels, ['from-app', 'wrong price']);
});
