/**
 * Every airport with scheduled passenger service (about 3,200), bundled with
 * the app from OurAirports so search works offline and in demo mode.
 * Regenerate: `dutyfree-scrape airports --export ../client/assets/airports.json`.
 */
import rows from '../assets/airports.json';
import type { SearchableAirport } from './airportSearch';

type Row = [string, string, string, string, string, number | null, number | null, string, 'L' | 'M', string?];

let cache: SearchableAirport[] | null = null;
let zones: Map<string, string> | null = null;

export function allAirports(): SearchableAirport[] {
  if (!cache) {
    cache = (rows as Row[])
      .filter((r) => r[5] != null && r[6] != null)
      .map(([iata, icao, name, city, country_code, latitude, longitude, keywords, size]) => ({
        iata, icao: icao || null, name, city: city || null, country_code,
        latitude: latitude as number, longitude: longitude as number, keywords: keywords || null, size,
      }));
  }
  return cache;
}

/**
 * The airport's IANA time zone ("Asia/Dubai"), or null if the bundle doesn't know it.
 * Trip airports can come from the server search, which has no zone, so we look it
 * up here by code rather than carrying it on every Airport object.
 */
export function airportTimeZone(iata: string): string | null {
  if (!zones) {
    zones = new Map();
    for (const r of rows as Row[]) if (r[9]) zones.set(r[0], r[9]);
  }
  return zones.get(iata) ?? null;
}
