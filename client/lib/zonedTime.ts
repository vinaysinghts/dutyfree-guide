/**
 * Wall-clock time at a place ⇄ an exact instant, using IANA zones ("Asia/Dubai").
 *
 * Why this exists: a traveller types "I fly out of DXB at 09:40 on 20 Nov" while their
 * phone is still set to India time. A reminder is an exact instant, so we must read
 * 09:40 in Dubai's zone, not the phone's. JavaScript has no "make a Date in zone X"
 * API, only "show this Date in zone X" (Intl.DateTimeFormat), so we invert that.
 * See LLD §3.9 and problems log #14.
 */

export type LocalDate = string; // YYYY-MM-DD, the calendar date at the airport
export type LocalTime = string; // HH:MM, 24-hour clock at the airport

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(s: string | undefined | null): s is LocalDate {
  const m = s ? DATE_RE.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function isLocalTime(s: string | undefined | null): s is LocalTime {
  return !!s && TIME_RE.test(s);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at `instantMs`, as if it were UTC (so we can subtract). */
function wallClockMs(instantMs: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
}

/** Minutes `tz` is ahead of UTC at that instant (+330 for India, +60/+120 for Amsterdam). */
export function offsetMinutes(instantMs: number, tz: string | null): number {
  if (!tz) return -new Date(instantMs).getTimezoneOffset();
  try {
    const whole = Math.floor(instantMs / 1000) * 1000;
    return Math.round((wallClockMs(whole, tz) - whole) / 60000);
  } catch {
    // Unknown zone, or an engine without zone data: fall back to the phone's zone.
    return -new Date(instantMs).getTimezoneOffset();
  }
}

/**
 * The instant when the clock in `tz` shows `date time`.
 *
 * Two passes, because the offset depends on the instant we're solving for (DST):
 * guess with the offset at the naive instant, then re-check at the answer.
 * - Spring-forward gap (02:30 doesn't exist in Amsterdam on the last Sunday of March):
 *   we land one hour later, 03:30 summer time. For a reminder that's the right side to err.
 * - Fall-back overlap (02:30 happens twice in October): we pick the second one.
 * `tz` null means "the phone's zone".
 */
export function zonedToInstant(date: LocalDate, time: LocalTime, tz: string | null): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (!tz) return new Date(y, mo - 1, d, h, mi);
  const first = offsetMinutes(wall, tz);
  let t = wall - first * 60000;
  const second = offsetMinutes(t, tz);
  if (second !== first) t = wall - second * 60000;
  return new Date(t);
}

/** The calendar date in `tz` at `instant` (null zone = phone's zone). */
export function localDateAt(instant: Date, tz: string | null): LocalDate {
  const shifted = new Date(instant.getTime() + offsetMinutes(instant.getTime(), tz) * 60000);
  return shifted.toISOString().slice(0, 10);
}

/** Adds whole days to a calendar date (no zone involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
