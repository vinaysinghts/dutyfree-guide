-- Minimal seed so the app works before the full airport list is loaded.
-- Load every airport with `python -m dutyfree_scrapers.load_airports` (see scrapers/README.md).

insert into public.airports (iata, name, city, country_code, latitude, longitude) values
  ('AMS', 'Amsterdam Airport Schiphol', 'Amsterdam', 'NL', 52.3086, 4.7639),
  ('BLR', 'Kempegowda International Airport', 'Bengaluru', 'IN', 13.1979, 77.7063),
  ('DEL', 'Indira Gandhi International Airport', 'New Delhi', 'IN', 28.5665, 77.1031),
  ('BOM', 'Chhatrapati Shivaji Maharaj International Airport', 'Mumbai', 'IN', 19.0887, 72.8679),
  ('DXB', 'Dubai International Airport', 'Dubai', 'AE', 25.2528, 55.3644),
  ('DOH', 'Hamad International Airport', 'Doha', 'QA', 25.2731, 51.6081),
  ('FRA', 'Frankfurt Airport', 'Frankfurt', 'DE', 50.0333, 8.5706),
  ('LHR', 'London Heathrow Airport', 'London', 'GB', 51.4706, -0.4619),
  ('IST', 'Istanbul Airport', 'Istanbul', 'TR', 41.2753, 28.7519),
  ('SIN', 'Singapore Changi Airport', 'Singapore', 'SG', 1.3502, 103.9940)
on conflict (iata) do nothing;

-- Schiphol starts inactive: its site answers every automated request with a
-- Cloudflare challenge, and we don't bypass bot checks (problems log #9, ADR-0004).
insert into public.retailers (airport_iata, name, adapter, base_url, currency, zone, active) values
  ('BLR', 'BLR Duty Free (shopdutyfree.com)', 'shopdutyfree', 'https://bengaluru.shopdutyfree.com', 'INR', 'both', true),
  ('AMS', 'Schiphol Airport Shopping', 'schiphol', 'https://www.schiphol.nl', 'EUR', 'departure', false)
on conflict (airport_iata, name) do nothing;

insert into public.fx_rates (currency, rate_to_inr, as_of) values
  ('INR', 1, current_date)
on conflict (currency) do nothing;
