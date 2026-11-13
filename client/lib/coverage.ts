/**
 * Where an airport's prices come from, in words a traveller can act on (ADR-0015).
 *
 * Issues #23/#24 asked why AMS, BSL and DXB had no prices. The answer was never "we
 * failed to fetch": AMS's scraper is paused (the site blocks bots) and BSL/DXB have no
 * scraper at all. The old banner said "No prices collected yet", which promised prices
 * that were never coming. This module turns the `airport_coverage` view into an honest
 * sentence per airport, and says when a photo from the traveller is the only way in.
 *
 * Pure (no React, no Supabase, no clock) so every wording rule is unit tested.
 */

/** One row of the `airport_coverage` view. */
export type AirportCoverage = {
  airport_iata: string;
  /** live: a scraper runs daily. paused: one exists but is switched off. none: travellers only. */
  scraper: 'live' | 'paused' | 'none';
  /** Why a paused scraper is off, written for travellers. */
  paused_reason: string | null;
  last_scraped_at: string | null;
  /** Bottles at this airport with an approved traveller price. */
  crowd_products: number;
  last_reported_at: string | null;
};

/**
 * live:       daily shop prices are arriving.
 * stale:      a scraper should run, but its newest price is old (e.g. the shop's CDN is
 *             refusing our runner, problems log #13).
 * travellers: no automated source, so traveller photos are the only data.
 */
export type CoverageKind = 'live' | 'stale' | 'travellers';

export type CoverageNote = {
  iata: string;
  kind: CoverageKind;
  /** A few words for the trip list, e.g. "Shop prices, daily". */
  label: string;
  /** One or two sentences for the prices screen. Empty when there is nothing to explain. */
  detail: string;
  /** True when a shelf-tag photo from this traveller is what would fill the gap. */
  askForPhoto: boolean;
};

/** A daily scrape older than this means it's being blocked or broken, not just "yesterday's". */
export const STALE_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function describeCoverage(iata: string, coverage: AirportCoverage | undefined, now: Date): CoverageNote {
  if (coverage?.scraper === 'live') {
    const age = coverage.last_scraped_at ? (now.getTime() - Date.parse(coverage.last_scraped_at)) / DAY_MS : Infinity;
    if (age <= STALE_AFTER_DAYS) {
      return { iata, kind: 'live', label: 'Shop prices, updated daily', detail: '', askForPhoto: false };
    }
    const since = coverage.last_scraped_at ? ` since ${shortDate(coverage.last_scraped_at)}` : ' yet';
    return {
      iata,
      kind: 'stale',
      label: 'Shop prices, may be out of date',
      detail: `Our daily check of the ${iata} shop hasn't got through${since}, so these prices may be old. A shelf-tag photo would confirm today's.`,
      askForPhoto: true,
    };
  }

  // Paused and "never had one" read differently: one is a choice we made and can explain,
  // the other is a gap we haven't filled. Both end in the same ask.
  const why =
    coverage?.scraper === 'paused' && coverage.paused_reason
      ? ensureStop(coverage.paused_reason)
      : `We don't have a price feed for the ${iata} shop yet.`;
  return {
    iata,
    kind: 'travellers',
    label: 'Traveller prices only',
    detail: `${why} ${iata} prices come from travellers' shelf-tag photos. ${reportedSoFar(coverage)}`,
    askForPhoto: true,
  };
}

/** Notes for every trip airport, in trip order. Missing rows (e.g. DXB with no retailer) mean "travellers only". */
export function describeTrip(iatas: string[], rows: AirportCoverage[], now: Date): CoverageNote[] {
  const byIata = new Map(rows.map((r) => [r.airport_iata, r]));
  return iatas.map((iata) => describeCoverage(iata, byIata.get(iata), now));
}

function reportedSoFar(c: AirportCoverage | undefined): string {
  const n = c?.crowd_products ?? 0;
  if (n === 0) return 'None reported yet: yours would be the first.';
  const latest = c?.last_reported_at ? `, latest on ${shortDate(c.last_reported_at)}` : '';
  return `${n} ${n === 1 ? 'bottle' : 'bottles'} reported so far${latest}.`;
}

const ensureStop = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

// Fixed English month names, so the wording (and the tests) don't depend on the device locale.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
