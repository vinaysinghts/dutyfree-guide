/**
 * Keeps the last few console errors and warnings in memory, so a problem
 * report can say what went wrong just before the user tapped "Report".
 * Nothing is stored on disk or sent anywhere unless the user files a report.
 */

export type LogEntry = { level: 'error' | 'warn'; at: string; message: string };

const MAX_ENTRIES = 25;
const MAX_MESSAGE = 400;
const buffer: LogEntry[] = [];
let installed = false;

/** Strip things that look like credentials before a log line can reach a public issue. */
export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[token]')
    .replace(/([?&](?:token|access_token|apikey|key)=)[^&\s]+/gi, '$1[redacted]');
}

export function formatArgs(args: unknown[]): string {
  const text = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  const clean = redact(text);
  return clean.length > MAX_MESSAGE ? clean.slice(0, MAX_MESSAGE) + '…' : clean;
}

export function record(level: LogEntry['level'], args: unknown[]): void {
  buffer.push({ level, at: new Date().toISOString(), message: formatArgs(args) });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function recentLogs(): LogEntry[] {
  return buffer.slice();
}

/** Wrap console.error / console.warn once. The originals still run. */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        record(level, args);
      } catch {
        // never let diagnostics break logging
      }
      original(...args);
    };
  }
}
