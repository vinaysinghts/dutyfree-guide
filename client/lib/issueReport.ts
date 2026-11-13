/**
 * In-app problem reports: what the user writes, what we attach, and where it
 * goes. The server turns each report into a GitHub issue (ADR 0010).
 * Kept free of React Native imports so it can be unit tested in Node.
 */
import type { LogEntry } from './diagnostics';

export type IssueCategory = 'bug' | 'wrong_price' | 'idea' | 'other';

export const ISSUE_CATEGORIES: { value: IssueCategory; label: string }[] = [
  { value: 'bug', label: 'Something broke' },
  { value: 'wrong_price', label: 'Wrong price' },
  { value: 'idea', label: 'Idea' },
  { value: 'other', label: 'Other' },
];

export const MAX_SCREENSHOTS = 4;
export const MIN_DESCRIPTION = 3;
export const MAX_DESCRIPTION = 4000;

/** Same shape the Edge Function reads (supabase/functions/file-issue/issue.ts). */
export type IssueContext = {
  app: { version?: string; build?: string; channel?: string; demo: boolean };
  device: { platform: string; os_version?: string; model?: string; screen?: string; locale?: string };
  screen?: string;
  trip?: string[];
  recent_logs?: LogEntry[];
};

export type IssueReportInput = {
  category: IssueCategory;
  description: string;
  screenshotUris: string[];
  context: IssueContext;
};

export type IssueReportResult =
  | { status: 'filed'; issueUrl: string; issueNumber: number }
  /** Saved; the next sync (or deploy) will file it. */
  | { status: 'pending'; reportId: number };

export function validateReport(input: Pick<IssueReportInput, 'description' | 'screenshotUris'>): string | null {
  const text = input.description.trim();
  if (text.length < MIN_DESCRIPTION) return 'Tell us briefly what happened.';
  if (text.length > MAX_DESCRIPTION) return `Please keep it under ${MAX_DESCRIPTION} characters.`;
  if (input.screenshotUris.length > MAX_SCREENSHOTS) return `Up to ${MAX_SCREENSHOTS} screenshots.`;
  return null;
}

/**
 * Removes the parts the user chose not to share. Device and app details are
 * always kept: they're what makes a report fixable, and say nothing personal.
 */
export function shareableContext(ctx: IssueContext, opts: { includeTrip: boolean; includeLogs: boolean }): IssueContext {
  return {
    ...ctx,
    trip: opts.includeTrip ? ctx.trip : undefined,
    recent_logs: opts.includeLogs ? ctx.recent_logs : undefined,
  };
}

const REPO = 'vinaysinghts/dutyfree-guide';

/**
 * Fallback when there's no backend (demo mode): a prefilled "new issue" page.
 * The user needs a GitHub account and attaches screenshots there themselves.
 */
export function newIssueUrl(input: Pick<IssueReportInput, 'category' | 'description' | 'context'>): string {
  const c = input.context;
  const body = [
    input.description.trim(),
    '',
    '### Context',
    `- Screen: ${c.screen ?? '?'}`,
    `- App: ${c.app.version ?? '?'}${c.app.build ? ` (${c.app.build})` : ''}${c.app.demo ? ', demo data' : ''}`,
    `- Platform: ${c.device.platform} ${c.device.os_version ?? ''}`.trimEnd(),
    c.trip?.length ? `- Trip: ${c.trip.join(' → ')}` : null,
    '',
    '_Drag your screenshots here._',
  ]
    .filter((l) => l !== null)
    .join('\n');
  const title = `[App] ${input.description.trim().split('\n')[0].slice(0, 70)}`;
  const q = new URLSearchParams({ title, body, labels: 'from-app' });
  return `https://github.com/${REPO}/issues/new?${q.toString()}`;
}

/**
 * The screenshot is taken when the user taps "Report", before the form opens,
 * so it shows the screen with the problem, not the form. It waits here for
 * the form to pick it up. Reading doesn't clear it, because the router may
 * mount the form more than once; instead it expires after a short while so a
 * later, unrelated visit to the form doesn't show a stale picture.
 */
export const CAPTURE_TTL_MS = 30_000;
type Capture = { uri: string | null; screen?: string };
let pending: (Capture & { at: number }) | null = null;

export function stashCapture(capture: Capture, now = Date.now()): void {
  pending = { ...capture, at: now };
}

export function recentCapture(now = Date.now()): Capture | null {
  if (!pending || now - pending.at > CAPTURE_TTL_MS) return null;
  const { at: _at, ...capture } = pending;
  return capture;
}
