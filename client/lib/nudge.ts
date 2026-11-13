/**
 * Travel-day nudges: decide when to ask a traveller to snap a shelf of prices.
 *
 * Pure functions only (no React, no notifications API, no clock): the caller passes
 * `now`, the trip, and what happened to earlier nudges, and gets back the reminders
 * that *should* be scheduled. The notifications layer then makes reality match
 * (lib/notifications.ts). Keeping the policy here means every rule below is unit
 * tested, and the same policy drives the in-app card on web, where there are no
 * local notifications. Design: ADR-0014, LLD §3.10.
 */
import { addDays, isLocalDate, isLocalTime, localDateAt, zonedToInstant, type LocalDate, type LocalTime } from './zonedTime';

/** One airport on the trip, with the optional "when am I there" the traveller gave us. */
export type NudgeStop = {
  iata: string;
  /** Calendar date at that airport (for a layover, the date you're in transit there). */
  date?: LocalDate;
  /** When your flight leaves that airport, airport-local. Optional, sharpens the reminder. */
  time?: LocalTime;
  /** IANA zone of the airport; null = unknown, use the phone's zone. */
  tz: string | null;
};

export type NudgeOutcome = 'pending' | 'opened' | 'ignored';

/** A reminder we scheduled, and what the traveller did with it. Kept on the device. */
export type NudgeEvent = { id: string; iata: string; date: LocalDate; fireAt: string; outcome: NudgeOutcome };

export type NudgeHistory = {
  events: NudgeEvent[];
  /** Airports the traveller already reported a price at, with when. */
  snaps: { iata: string; at: string }[];
  /** In-app cards the traveller closed, as `${iata}:${date}`. */
  dismissed: string[];
};

export const EMPTY_HISTORY: NudgeHistory = { events: [], snaps: [], dismissed: [] };

export type PlannedNudge = {
  id: string;
  iata: string;
  date: LocalDate;
  fireAt: Date;
  /** 'flight': timed from the departure time. 'day': morning of the travel day. */
  kind: 'flight' | 'day';
};

/**
 * Fatigue limits. Each one is a product decision with a reason (ADR-0014 §5):
 * a tool that nags gets its notifications turned off at the OS level, and then
 * we can never reach that traveller again.
 */
export const LIMITS = {
  /** At most this many reminders on one travel date, even with three layovers. */
  perDay: 2,
  /** Reminders closer together than this feel like spam. */
  minGapMs: 3 * 60 * 60 * 1000,
  /** Pending reminders at once (iOS allows 64 per app; we want far fewer). */
  maxScheduled: 4,
  /** Stop scheduling after this many reminders in a row were ignored. A snap or tap resets it. */
  backoffAfterIgnored: 3,
  /** A reminder not opened within this long counts as ignored. */
  ignoredAfterMs: 2 * 60 * 60 * 1000,
  /** Don't ask again at an airport you reported from this recently. */
  recentSnapMs: 7 * 24 * 60 * 60 * 1000,
  /** Before departure: likely past security, browsing, not yet boarding. */
  beforeFlightMin: 75,
  /** Morning reminder on a travel day with no flight time. */
  dayReminderAt: '08:00' as LocalTime,
  /** The in-app card shows from this long before the flight... */
  cardBeforeFlightMs: 4 * 60 * 60 * 1000,
  /** ...until this long after (delays). */
  cardAfterFlightMs: 60 * 60 * 1000,
};

export const nudgeKey = (iata: string, date: LocalDate) => `${iata}:${date}`;

/** Marks reminders that fired a while ago and were never opened as ignored. */
export function settle(history: NudgeHistory, now: Date): NudgeHistory {
  let changed = false;
  const events = history.events.map((e) => {
    if (e.outcome === 'pending' && Date.parse(e.fireAt) + LIMITS.ignoredAfterMs < now.getTime()) {
      changed = true;
      return { ...e, outcome: 'ignored' as const };
    }
    return e;
  });
  return changed ? { ...history, events } : history;
}

/** Ignored reminders since the traveller last engaged (opened a reminder or reported a price). */
export function ignoredStreak(history: NudgeHistory): number {
  const lastSnap = Math.max(0, ...history.snaps.map((s) => Date.parse(s.at)));
  let streak = 0;
  const fired = [...history.events].filter((e) => e.outcome !== 'pending').sort((a, b) => Date.parse(b.fireAt) - Date.parse(a.fireAt));
  for (const e of fired) {
    if (e.outcome === 'opened' || Date.parse(e.fireAt) < lastSnap) break;
    streak++;
  }
  return streak;
}

function snappedRecently(history: NudgeHistory, iata: string, at: Date): boolean {
  return history.snaps.some((s) => s.iata === iata && Math.abs(at.getTime() - Date.parse(s.at)) < LIMITS.recentSnapMs);
}

/** The best moment to ask, for one stop, or null if we can't say. */
export function fireTimeFor(stop: NudgeStop): { at: Date; kind: PlannedNudge['kind'] } | null {
  if (!isLocalDate(stop.date)) return null;
  if (isLocalTime(stop.time)) {
    const departs = zonedToInstant(stop.date, stop.time, stop.tz);
    return { at: new Date(departs.getTime() - LIMITS.beforeFlightMin * 60000), kind: 'flight' };
  }
  return { at: zonedToInstant(stop.date, LIMITS.dayReminderAt, stop.tz), kind: 'day' };
}

/**
 * The reminders that should be scheduled right now. Idempotent: same input, same output,
 * so the caller can re-run it on every change and just reconcile.
 */
export function planNudges(stops: NudgeStop[], history: NudgeHistory, now: Date, enabled = true): PlannedNudge[] {
  if (!enabled || ignoredStreak(history) >= LIMITS.backoffAfterIgnored) return [];
  const alreadyScheduled = new Set(history.events.filter((e) => e.outcome !== 'pending').map((e) => nudgeKey(e.iata, e.date)));

  const candidates: PlannedNudge[] = [];
  for (const stop of stops) {
    const t = fireTimeFor(stop);
    if (!t || !stop.date || t.at.getTime() <= now.getTime()) continue;
    const key = nudgeKey(stop.iata, stop.date);
    // One reminder per airport per travel date, ever: if it already fired, don't re-ask.
    if (alreadyScheduled.has(key) || history.dismissed.includes(key)) continue;
    if (snappedRecently(history, stop.iata, t.at)) continue;
    candidates.push({ id: `nudge:${key}`, iata: stop.iata, date: stop.date, fireAt: t.at, kind: t.kind });
  }

  // Timed reminders first (they're likelier to land at the shop), then trip order.
  const ranked = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.kind === b.c.kind ? a.i - b.i : a.c.kind === 'flight' ? -1 : 1))
    .map((x) => x.c);

  const chosen: PlannedNudge[] = [];
  for (const c of ranked) {
    if (chosen.length >= LIMITS.maxScheduled) break;
    if (chosen.filter((x) => x.date === c.date).length >= LIMITS.perDay) continue;
    if (chosen.some((x) => Math.abs(x.fireAt.getTime() - c.fireAt.getTime()) < LIMITS.minGapMs)) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}

export type ActiveNudge = {
  iata: string;
  date: LocalDate;
  /** True when the phone's location puts the traveller at this airport right now. */
  here: boolean;
};

/**
 * Which in-app card to show now, if any. Unlike reminders this needs no permission and
 * works on web. `hereIata` is the trip airport the phone is at (≤ 5 km), if we know it
 * without asking: we only read location when permission was already granted.
 */
export function activeNudge(stops: NudgeStop[], history: NudgeHistory, now: Date, hereIata?: string | null): ActiveNudge | null {
  const open = (iata: string, date: LocalDate) =>
    !history.dismissed.includes(nudgeKey(iata, date)) && !snappedRecently(history, iata, now);

  // Being at the airport beats any schedule: works even if no dates were entered.
  if (hereIata) {
    const stop = stops.find((s) => s.iata === hereIata);
    if (stop) {
      const date = localDateAt(now, stop.tz);
      if (open(stop.iata, date)) return { iata: stop.iata, date, here: true };
    }
  }
  for (const stop of stops) {
    if (!isLocalDate(stop.date) || !open(stop.iata, stop.date)) continue;
    if (isLocalTime(stop.time)) {
      const departs = zonedToInstant(stop.date, stop.time, stop.tz).getTime();
      if (now.getTime() >= departs - LIMITS.cardBeforeFlightMs && now.getTime() <= departs + LIMITS.cardAfterFlightMs) {
        return { iata: stop.iata, date: stop.date, here: false };
      }
    } else if (localDateAt(now, stop.tz) === stop.date) {
      return { iata: stop.iata, date: stop.date, here: false };
    }
  }
  return null;
}

/** Records that reminders were handed to the OS, so `settle` can judge them later. */
export function recordScheduled(history: NudgeHistory, planned: PlannedNudge[], now: Date): NudgeHistory {
  const byId = new Map(history.events.map((e) => [e.id, e]));
  // Drop future pending entries that are no longer planned (the trip changed). Keep any that
  // already fired, even if `settle` hasn't judged them yet, or we'd forget we asked.
  const kept = history.events.filter(
    (e) => e.outcome !== 'pending' || Date.parse(e.fireAt) <= now.getTime() || planned.some((p) => p.id === e.id),
  );
  const added = planned
    .filter((p) => !byId.has(p.id) || byId.get(p.id)!.fireAt !== p.fireAt.toISOString())
    .map<NudgeEvent>((p) => ({ id: p.id, iata: p.iata, date: p.date, fireAt: p.fireAt.toISOString(), outcome: 'pending' }));
  const merged = [...kept.filter((e) => !added.some((a) => a.id === e.id)), ...added];
  return { ...history, events: trimEvents(merged) };
}

export function recordOpened(history: NudgeHistory, id: string): NudgeHistory {
  return { ...history, events: history.events.map((e) => (e.id === id ? { ...e, outcome: 'opened' as const } : e)) };
}

export function recordSnap(history: NudgeHistory, iata: string, at: Date): NudgeHistory {
  return { ...history, snaps: [...history.snaps, { iata, at: at.toISOString() }].slice(-50) };
}

export function recordDismissed(history: NudgeHistory, iata: string, date: LocalDate): NudgeHistory {
  const key = nudgeKey(iata, date);
  return history.dismissed.includes(key) ? history : { ...history, dismissed: [...history.dismissed, key].slice(-100) };
}

/** Keeps the history small: pending ones plus the last 50 that fired. */
function trimEvents(events: NudgeEvent[]): NudgeEvent[] {
  const pending = events.filter((e) => e.outcome === 'pending');
  const fired = events.filter((e) => e.outcome !== 'pending').sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt)).slice(-50);
  return [...fired, ...pending];
}

/** Quick picks for the date field. */
export function dateChoices(now: Date, tz: string | null): { label: string; date: LocalDate }[] {
  const today = localDateAt(now, tz);
  return [{ label: 'Today', date: today }, { label: 'Tomorrow', date: addDays(today, 1) }];
}
