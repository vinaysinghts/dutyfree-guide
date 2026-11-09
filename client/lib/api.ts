/**
 * Data access for the app. Every screen goes through these functions, never
 * through Supabase directly, so the backend can change without touching UI.
 */
import { DEMO_AIRPORTS, DEMO_PRICES } from './demo';
import { ensureSession, supabase } from './supabase';
import type { Airport, PriceRow, Submission, SubmissionInput } from './types';

export async function searchAirports(query: string, limit = 12): Promise<Airport[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  if (!supabase) {
    return DEMO_AIRPORTS.filter((a) => `${a.iata} ${a.name} ${a.city ?? ''}`.toLowerCase().includes(q)).slice(0, limit);
  }
  // An exact IATA code match ranks first, then name/city matches.
  const safe = q.replace(/[%_,()]/g, ' ');
  const { data, error } = await supabase
    .from('airports')
    .select('iata, name, city, country_code')
    .ilike('search_text', `%${safe}%`)
    .limit(limit * 2);
  if (error) throw error;
  return (data as Airport[])
    .sort((a, b) => Number(b.iata.toLowerCase() === q) - Number(a.iata.toLowerCase() === q))
    .slice(0, limit);
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
    product_name: input.product_name,
    brand: input.brand || null,
    volume_ml: input.volume_ml ?? null,
    price: input.price,
    currency: input.currency,
    note: input.note || null,
    photo_path,
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
  return data as Submission[];
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
