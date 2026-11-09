/**
 * Every airport with scheduled passenger service (about 3,200), bundled with
 * the app from OurAirports so search works offline and in demo mode.
 * Regenerate: `dutyfree-scrape airports --export ../client/assets/airports.json`.
 */
import rows from '../assets/airports.json';
import type { SearchableAirport } from './airportSearch';

type Row = [string, string, string, string, string, number | null, number | null, string, 'L' | 'M'];

let cache: SearchableAirport[] | null = null;

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
