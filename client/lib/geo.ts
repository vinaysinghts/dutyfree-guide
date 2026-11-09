import type { Airport } from './types';

export type GeoPoint = { latitude: number; longitude: number };

/** Great-circle distance in km (haversine). Accurate to well under 1% for our purposes. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Terminals sit within a few km of the airport reference point; 5 km allows for big airports. */
export const AT_AIRPORT_KM = 5;

export function nearestAirport<T extends Airport & GeoPoint>(point: GeoPoint, airports: T[]): { airport: T; km: number } | null {
  let best: { airport: T; km: number } | null = null;
  for (const airport of airports) {
    const km = distanceKm(point, airport);
    if (!best || km < best.km) best = { airport, km };
  }
  return best;
}

/** Reads GPS from EXIF as returned by expo-image-picker (`exif: true`). */
export function gpsFromExif(exif: Record<string, unknown> | null | undefined): GeoPoint | null {
  if (!exif) return null;
  const lat = toDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
  const lon = toDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
  return lat != null && lon != null ? { latitude: lat, longitude: lon } : null;
}

function toDecimal(value: unknown, ref: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number') n = value;
  else if (Array.isArray(value) && value.length === 3) {
    const [d, m, s] = value.map(Number);
    n = d + m / 60 + s / 3600;
  }
  if (n == null || !Number.isFinite(n)) return null;
  return ref === 'S' || ref === 'W' ? -Math.abs(n) : n;
}

/** EXIF DateTimeOriginal looks like "2026:11:09 07:12:30" (camera local time, no zone). */
export function takenAtFromExif(exif: Record<string, unknown> | null | undefined): Date | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
