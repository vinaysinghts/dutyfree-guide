/**
 * Airport search that copes with how people actually type airport names.
 *
 * One airport often has several names and codes: Basel's EuroAirport is BSL,
 * MLH and EAP, sits in France, and is "Bâle" in French; Bengaluru is still
 * "Bangalore" to most travellers. So we match against the IATA and ICAO codes,
 * name, city and OurAirports' alternate names, after folding accents and
 * punctuation, and every word of the query has to match somewhere.
 * Pure functions, unit tested; the database uses the same folding (§3.7 LLD).
 */
import type { AirportWithCoords } from './types';

export type SearchableAirport = AirportWithCoords & {
  icao?: string | null;
  keywords?: string | null;
  /** L = large, M = medium (OurAirports type); large ones rank first on ties. */
  size?: 'L' | 'M' | null;
};

/** Lowercase, strip accents, turn punctuation (– / ' .) into spaces. Mirrors SQL `search_fold`. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function queryWords(query: string): string[] {
  return fold(query).split(' ').filter(Boolean);
}

/** Every code an airport answers to: IATA, ICAO and 3–4 letter codes in its keywords (MLH, EAP). */
function codes(a: SearchableAirport): string[] {
  const out = [a.iata.toLowerCase()];
  if (a.icao) out.push(a.icao.toLowerCase());
  for (const k of (a.keywords ?? '').split(',')) {
    const t = k.trim();
    if (/^[A-Z0-9]{3,4}$/.test(t)) out.push(t.toLowerCase());
  }
  return out;
}

export function haystack(a: SearchableAirport): string {
  return fold([a.iata, a.icao ?? '', a.name, a.city ?? '', a.keywords ?? ''].join(' '));
}

/**
 * Score one airport for a query, or null if some word doesn't match.
 * Higher is better: exact code > word starting the city > word starting any name > substring.
 */
export function score(a: SearchableAirport, words: string[], text = haystack(a)): number | null {
  if (!words.length) return null;
  const padded = ` ${text} `;
  const city = ` ${fold(a.city ?? '')} `;
  const airportCodes = words.length === 1 ? codes(a) : [];
  let total = 0;
  for (const w of words) {
    if (!padded.includes(w)) return null;
    if (airportCodes.includes(w)) total += w === a.iata.toLowerCase() ? 1000 : 600;
    else if (city.includes(` ${w}`)) total += 60;
    else if (padded.includes(` ${w}`)) total += 40;
    else total += 10;
  }
  if (a.size === 'L') total += 5;
  return total;
}

export function searchAirportList<T extends SearchableAirport>(airports: T[], query: string, limit = 12): T[] {
  const words = queryWords(query);
  if (!words.length || words.join('').length < 2) return [];
  const hits: { a: T; s: number }[] = [];
  for (const a of airports) {
    const s = score(a, words);
    if (s != null) hits.push({ a, s });
  }
  hits.sort((x, y) => y.s - x.s || x.a.name.localeCompare(y.a.name));
  return hits.slice(0, limit).map((h) => h.a);
}
