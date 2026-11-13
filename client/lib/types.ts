export type Airport = {
  iata: string;
  name: string;
  city: string | null;
  country_code: string;
};

/** One row of the `latest_prices` view: a bottle's latest price at one retailer. */
export type PriceRow = {
  product_id: number;
  retailer_id: number;
  airport_iata: string;
  retailer_name: string;
  brand: string | null;
  product_name: string;
  volume_ml: number | null;
  category: string;
  image_url: string | null;
  price: number;
  currency: string;
  /** Null when we have no exchange rate for `currency` yet. */
  price_inr: number | null;
  source: 'scraped' | 'crowd';
  product_url: string | null;
  observed_at: string;
};

export type Offer = Pick<
  PriceRow,
  'airport_iata' | 'retailer_name' | 'price' | 'currency' | 'price_inr' | 'source' | 'product_url' | 'observed_at'
>;

/** A bottle with its offers across the trip's airports, cheapest first. */
export type RankedProduct = {
  productId: number;
  name: string;
  brand: string | null;
  volumeMl: number | null;
  imageUrl: string | null;
  offers: Offer[];
  best: Offer;
  /** INR saved by buying at `best` instead of the most expensive airport on the trip. */
  savingInr: number | null;
  /** Trip airports with no price for this bottle (not sold there, or not collected yet). */
  missing: string[];
};

export type AirportWithCoords = Airport & { latitude: number; longitude: number };

export type CaptureLocation = {
  latitude: number;
  longitude: number;
  accuracyM?: number;
  source: 'device' | 'exif';
};

/** How the traveller got to the report screen; lets us measure whether nudges work (ADR-0014). */
export type SubmissionVia = 'manual' | 'nudge_card' | 'nudge_notification';

/** A report: either a photo (fields optional, read by OCR) or typed details. */
export type SubmissionInput = {
  airport_iata: string;
  product_name?: string;
  brand?: string;
  volume_ml?: number;
  price?: number;
  currency?: string;
  note?: string;
  photoUri?: string;
  ocrText?: string;
  ocrDraft?: unknown;
  location?: CaptureLocation;
  photoTakenAt?: string;
  via?: SubmissionVia;
};

export type LocationCheck = 'at_airport' | 'near' | 'far' | 'unknown';

export type Submission = {
  id: number;
  airport_iata: string;
  product_name: string | null;
  brand: string | null;
  volume_ml: number | null;
  price: number | null;
  currency: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  observed_on: string;
  photo_path: string | null;
  photo_taken_at: string | null;
  ocr_text: string | null;
  location_check: LocationCheck;
  distance_km: number | null;
  location_source: 'device' | 'exif' | null;
};

export type SubmissionEdits = Pick<Submission, 'product_name' | 'brand' | 'volume_ml' | 'price' | 'currency'>;
