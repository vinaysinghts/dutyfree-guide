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
};

export type SubmissionInput = {
  airport_iata: string;
  product_name: string;
  brand?: string;
  volume_ml?: number;
  price: number;
  currency: string;
  note?: string;
  photoUri?: string;
};

export type Submission = SubmissionInput & {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  observed_on: string;
  photo_path: string | null;
};
