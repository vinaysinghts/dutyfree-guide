-- airport_coverage (ADR-0015): live vs paused vs traveller-only, from the seed's BLR and AMS rows.
\set ON_ERROR_STOP 1

insert into airports (iata, name, country_code) values ('BSL', 'EuroAirport Basel-Mulhouse-Freiburg', 'FR')
on conflict (iata) do nothing;

-- One scraped BLR bottle, and one approved traveller price at AMS.
insert into products (match_key, brand, name, volume_ml) values ('test coverage|1000', 'Test', 'Coverage', 1000);
insert into prices (product_id, retailer_id, price, currency, source, observed_at)
select p.id, r.id, 4000, 'INR', 'scraped', '2026-11-12T01:30:00Z'
from products p, retailers r where p.match_key = 'test coverage|1000' and r.airport_iata = 'BLR' and r.adapter = 'shopdutyfree';
insert into retailers (airport_iata, name, currency) values ('AMS', 'Reported by travellers', 'EUR') on conflict do nothing;
insert into prices (product_id, retailer_id, price, currency, source, observed_at)
select p.id, r.id, 41.5, 'EUR', 'crowd', '2026-11-10T09:00:00Z'
from products p, retailers r where p.match_key = 'test coverage|1000' and r.airport_iata = 'AMS' and r.name = 'Reported by travellers';

do $$
declare c record;
begin
  select * into c from airport_coverage where airport_iata = 'BLR';
  if c.scraper <> 'live' or c.last_scraped_at < '2026-11-12T01:30:00Z' or c.crowd_products <> 0 then
    raise exception 'BLR should be live, scraped on or after 2026-11-12, no crowd prices: %', row_to_json(c);
  end if;

  -- AMS: Schiphol scraper paused with its reason, and traveller prices still count
  -- (earlier test files may have approved more, so at least one).
  -- The crowd retailer has no adapter, so it must not make AMS look "live".
  select * into c from airport_coverage where airport_iata = 'AMS';
  if c.scraper <> 'paused' or c.paused_reason not like 'Schiphol%' or c.crowd_products < 1 or c.last_scraped_at is not null then
    raise exception 'AMS should be paused with a reason and a crowd bottle: %', row_to_json(c);
  end if;

  -- BSL and DXB: no retailer row at all, so no scraper and nothing reported.
  select * into c from airport_coverage where airport_iata = 'BSL';
  if c.scraper <> 'none' or c.paused_reason is not null or c.crowd_products <> 0 then
    raise exception 'BSL should be traveller-only with nothing yet: %', row_to_json(c);
  end if;
  if (select scraper from airport_coverage where airport_iata = 'DXB') <> 'none' then
    raise exception 'DXB should be traveller-only';
  end if;
  raise notice 'airport_coverage live/paused/none: ok';
end $$;
