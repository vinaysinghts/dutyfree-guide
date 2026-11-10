/**
 * Turns an in-app problem report into a GitHub issue (title, body, labels).
 * Pure and dependency-free so it runs in Deno (the Edge Function) and in the
 * Node unit tests alike. See docs/lld.md §3.8.
 */

export type ReportCategory = 'bug' | 'wrong_price' | 'idea' | 'other';

export type ReportContext = {
  app?: { version?: string; build?: string; channel?: string; demo?: boolean };
  device?: { platform?: string; os_version?: string; model?: string; screen?: string; locale?: string };
  screen?: string; // route the reporter was on, e.g. "/prices"
  trip?: string[]; // IATA codes
  recent_logs?: { level: string; at: string; message: string }[];
};

export type IssueReportRow = {
  id: number;
  created_at: string;
  reporter: string;
  category: ReportCategory;
  description: string;
  screenshot_paths: string[];
  context: ReportContext;
};

export type GitHubIssue = { title: string; body: string; labels: string[] };

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  bug: 'bug',
  wrong_price: 'wrong price',
  idea: 'idea',
  other: 'question',
};

const CATEGORY_TITLE: Record<ReportCategory, string> = {
  bug: 'Bug',
  wrong_price: 'Wrong price',
  idea: 'Idea',
  other: 'Feedback',
};

/** Marker that ties an issue back to its report row (used to spot duplicates). */
export const reportMarker = (id: number) => `<!-- app-report:${id} -->`;

/**
 * User text goes into a public issue. Stop it from @-mentioning people (a zero
 * width space after "@" breaks the mention but reads the same) and from
 * closing the HTML comment marker.
 */
export function neutralize(text: string): string {
  return text
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/<!--|-->/g, '')
    .replace(/\r\n?/g, '\n');
}

/** First line of the description, cut at a word boundary. */
export function issueTitle(category: ReportCategory, description: string, screen?: string): string {
  const firstLine = neutralize(description).trim().split('\n')[0].replace(/\s+/g, ' ');
  let summary = firstLine;
  if (summary.length > 70) {
    const cut = summary.slice(0, 70);
    const space = cut.lastIndexOf(' ');
    summary = (space > 40 ? cut.slice(0, space) : cut) + '…';
  }
  const where = screen ? ` (${screen})` : '';
  return `[App] ${CATEGORY_TITLE[category]}${where}: ${summary}`;
}

/** Code block that can't be broken out of, whatever the content holds. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}\n${text}\n${ticks}`;
}

function row(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return `| ${label} | ${neutralize(String(value)).replace(/\|/g, '\\|')} |`;
}

export function buildIssue(report: IssueReportRow, screenshotUrls: string[]): GitHubIssue {
  const ctx = report.context ?? {};
  const lines: string[] = [];

  lines.push(neutralize(report.description.trim()), '');

  if (screenshotUrls.length) {
    lines.push('### Screenshots', '');
    screenshotUrls.forEach((url, i) => lines.push(`<img src="${url}" alt="Screenshot ${i + 1}" width="320">`));
    lines.push('');
  }

  const table = [
    row('Screen', ctx.screen),
    row('Trip', ctx.trip?.join(' → ')),
    row('App version', [ctx.app?.version, ctx.app?.build && `(${ctx.app.build})`].filter(Boolean).join(' ')),
    row('Data', ctx.app?.demo ? 'demo (no backend)' : ctx.app?.demo === false ? 'live' : undefined),
    row('Platform', [ctx.device?.platform, ctx.device?.os_version].filter(Boolean).join(' ')),
    row('Device', ctx.device?.model),
    row('Screen size', ctx.device?.screen),
    row('Locale', ctx.device?.locale),
    row('Reported', report.created_at),
    row('Reporter', `anonymous ${report.reporter.slice(0, 8)}`),
  ].filter((r): r is string => r !== null);
  lines.push('### Context', '', '| | |', '|---|---|', ...table, '');

  const logs = ctx.recent_logs ?? [];
  if (logs.length) {
    const text = logs.map((l) => `${l.at} ${l.level.toUpperCase()} ${l.message}`).join('\n');
    lines.push(
      '<details><summary>Recent app errors and warnings (' + logs.length + ')</summary>',
      '',
      fence(neutralize(text)),
      '',
      '</details>',
      '',
    );
  }

  lines.push(`_Filed from the app, report #${report.id}._`, reportMarker(report.id));

  return {
    title: issueTitle(report.category, report.description, ctx.screen),
    body: lines.join('\n'),
    labels: ['from-app', CATEGORY_LABEL[report.category]],
  };
}
