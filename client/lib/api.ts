/**
 * Data access for the app. Every screen goes through these functions, never
 * through Supabase directly, so the backend can change without touching UI.
 */
import { searchAirportList } from './airportSearch';
import { allAirports } from './airports';
import { DEMO_PRICES } from './demo';
import { ensureSession, supabase } from './supabase';
import { nearestAirport, type GeoPoint } from './geo';
import type { Airport, AirportWithCoords, PriceRow, Submission, SubmissionEdits, SubmissionInput } from './types';

/**
 * Airport search runs on the bundled OurAirports list in every mode: it's static
 * reference data (~320 KB), so searching on the device is instant and works
 * offline at the gate. The database holds the same list for foreign keys and
 * nearest_airports(). Matching rules: lib/airportSearch.ts.
 */
export async function searchAirports(query: string, limit = 12): Promise<Airport[]> {
  return searchAirportList(allAirports(), query, limit);
}

export async function pricesAt(iatas: string[]): Promise<PriceRow[]> {
  if (iatas.length === 0) return [];
  if (!supabase) return DEMO_PRICES.filter((r) => iatas.includes(r.airport_iata));
  const { data, error } = await supabase.from('latest_prices').select('*').in('airport_iata', iatas);
  if (error) throw error;
  return (data as PriceRow[]).map((r) => ({
    ...r,
    // numeric columns arrive as strings from PostgREST
    price: Number(r.price),
    price_inr: r.price_inr == null ? null : Number(r.price_inr),
  }));
}

/** Closest airports to where the user is standing, nearest first. */
export async function nearestAirports(point: GeoPoint, limit = 3): Promise<(AirportWithCoords & { distance_km: number })[]> {
  if (!supabase) {
    const hit = nearestAirport(point, allAirports());
    return hit ? [{ ...hit.airport, distance_km: hit.km }] : [];
  }
  const { data, error } = await supabase.rpc('nearest_airports', { lat: point.latitude, lon: point.longitude, max_results: limit });
  if (error) throw error;
  return data as (AirportWithCoords & { distance_km: number })[];
}

export async function submitPrice(input: SubmissionInput): Promise<void> {
  if (!supabase) throw new Error('Price reports need the backend. Set EXPO_PUBLIC_SUPABASE_URL to enable them.');
  const userId = await ensureSession();
  let photo_path: string | null = null;
  if (input.photoUri) {
    const blob = await (await fetch(input.photoUri)).blob();
    photo_path = `${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('submission-photos')
      .upload(photo_path, blob, { contentType: blob.type || 'image/jpeg' });
    if (error) throw error;
  }
  const { error } = await supabase.from('price_submissions').insert({
    submitted_by: userId,
    airport_iata: input.airport_iata,
    product_name: input.product_name || null,
    brand: input.brand || null,
    volume_ml: input.volume_ml ?? null,
    price: input.price ?? null,
    currency: input.currency || null,
    note: input.note || null,
    photo_path,
    ocr_text: input.ocrText?.slice(0, 5000) ?? null,
    ocr_draft: input.ocrDraft ?? null,
    capture_latitude: input.location?.latitude ?? null,
    capture_longitude: input.location?.longitude ?? null,
    capture_accuracy_m: input.location?.accuracyM ?? null,
    location_source: input.location?.source ?? null,
    photo_taken_at: input.photoTakenAt ?? null,
  });
  if (error) throw error;
}

export async function pendingSubmissions(): Promise<Submission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('price_submissions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at');
  if (error) throw error;
  return (data as Submission[]).map((s) => ({
    ...s,
    price: s.price == null ? null : Number(s.price),
    distance_km: s.distance_km == null ? null : Number(s.distance_km),
  }));
}

/** Reviewer fills in or corrects what OCR read. */
export async function updateSubmission(id: number, edits: SubmissionEdits): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('price_submissions').update(edits).eq('id', id);
  if (error) throw error;
}

export async function photoUrl(path: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from('submission-photos').createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

export async function reviewSubmission(id: number, approve: boolean, note?: string, existingProductId?: number) {
  if (!supabase) return;
  const { error } = await supabase.rpc('review_submission', {
    p_submission_id: id,
    p_approve: approve,
    p_note: note ?? null,
    p_existing_product_id: existingProductId ?? null,
  });
  if (error) throw error;
}

export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.rpc('is_admin');
  return data === true;
}
