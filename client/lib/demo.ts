import type { AirportWithCoords, PriceRow } from './types';

/** Sample data used when Supabase isn't configured. Prices are illustrative only. */
export const DEMO_AIRPORTS: AirportWithCoords[] = [
  { iata: 'AMS', name: 'Amsterdam Airport Schiphol', city: 'Amsterdam', country_code: 'NL', latitude: 52.3086, longitude: 4.7639 },
  { iata: 'BLR', name: 'Kempegowda International Airport', city: 'Bengaluru', country_code: 'IN', latitude: 13.1979, longitude: 77.7063 },
  { iata: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', country_code: 'IN', latitude: 19.0887, longitude: 72.8679 },
  { iata: 'DEL', name: 'Indira Gandhi International Airport', city: 'New Delhi', country_code: 'IN', latitude: 28.5665, longitude: 77.1031 },
  { iata: 'DOH', name: 'Hamad International Airport', city: 'Doha', country_code: 'QA', latitude: 25.2731, longitude: 51.6081 },
  { iata: 'DXB', name: 'Dubai International Airport', city: 'Dubai', country_code: 'AE', latitude: 25.2528, longitude: 55.3644 },
  { iata: 'FRA', name: 'Frankfurt Airport', city: 'Frankfurt', country_code: 'DE', latitude: 50.0333, longitude: 8.5706 },
  { iata: 'IST', name: 'Istanbul Airport', city: 'Istanbul', country_code: 'TR', latitude: 41.2753, longitude: 28.7519 },
  { iata: 'LHR', name: 'London Heathrow Airport', city: 'London', country_code: 'GB', latitude: 51.4706, longitude: -0.4619 },
  { iata: 'SIN', name: 'Singapore Changi Airport', city: 'Singapore', country_code: 'SG', latitude: 1.3502, longitude: 103.994 },
];

const EUR = 95.5;
const AED = 23.4;
let id = 0;
const p = (
  productId: number, brand: string, name: string, ml: number,
  airport: string, price: number, currency: string, source: PriceRow['source'] = 'scraped',
): PriceRow => ({
  product_id: productId,
  retailer_id: ++id,
  airport_iata: airport,
  retailer_name: source === 'crowd' ? 'Reported by travellers' : `${airport} Duty Free`,
  brand,
  product_name: name,
  volume_ml: ml,
  category: 'spirits',
  image_url: null,
  price,
  currency,
  price_inr: Math.round(price * (currency === 'EUR' ? EUR : currency === 'AED' ? AED : 1) * 100) / 100,
  source,
  product_url: null,
  observed_at: '2026-11-09T00:00:00Z',
});

export const DEMO_PRICES: PriceRow[] = [
  p(1, 'Johnnie Walker', 'Black Label 1L', 1000, 'BLR', 3450, 'INR'),
  p(1, 'Johnnie Walker', 'Black Label 1L', 1000, 'AMS', 32.99, 'EUR'),
  p(1, 'Johnnie Walker', 'Black Label 1L', 1000, 'DXB', 125, 'AED', 'crowd'),
  p(2, 'Glenfiddich', '12 Year Old 1L', 1000, 'BLR', 4300, 'INR'),
  p(2, 'Glenfiddich', '12 Year Old 1L', 1000, 'AMS', 44.5, 'EUR'),
  p(3, 'Absolut', 'Vodka 1L', 1000, 'BLR', 1650, 'INR'),
  p(3, 'Absolut', 'Vodka 1L', 1000, 'AMS', 17.99, 'EUR'),
  p(4, 'Hendrick\'s', 'Gin 1L', 1000, 'AMS', 34.99, 'EUR'),
  p(4, 'Hendrick\'s', 'Gin 1L', 1000, 'BLR', 3900, 'INR'),
  p(5, 'Hennessy', 'VS Cognac 1L', 1000, 'BLR', 4950, 'INR'),
  p(5, 'Hennessy', 'VS Cognac 1L', 1000, 'DXB', 199, 'AED'),
  p(6, 'Monkey 47', 'Dry Gin 50cl', 500, 'AMS', 36.5, 'EUR'),
];
