-- ADR-0015: say *why* an airport has no prices, instead of "not collected yet".
--
-- Issues #23 and #24 ("not able to fetch prices from AMS, BSL, DXB") weren't fetch failures:
-- only BLR has a price source. AMS's scraper is paused (Cloudflare, ADR-0011) and BSL/DXB have
-- never had one. The app couldn't tell those apart, so it promised prices that were never coming.

-- Why a scraper is switched off, in words a traveller can read. Null while it runs.
alter table public.retailers add column paused_reason text check (length(paused_reason) <= 200);

comment on column public.retailers.paused_reason is
  'Shown in the app when this retailer''s scraper is inactive, e.g. "Schiphol''s shop blocks automated price checks".';

update public.retailers
set paused_reason = 'Schiphol''s shop blocks automated price checks, and we don''t get around that.'
where adapter = 'schiphol' and not active;

-- One row per airport: where its prices come from. The app reads it with
-- `.in('airport_iata', trip)`, so the airports table's size doesn't matter.
--   scraper = 'live'   an active retailer has a scraper adapter
--             'paused' it has a scraper adapter, but every one is inactive
--             'none'   prices can only come from traveller reports
create or replace view public.airport_coverage with (security_invoker = true) as
select
  a.iata as airport_iata,
  case
    when bool_or(r.adapter is not null and r.active) then 'live'
    when bool_or(r.adapter is not null) then 'paused'
    else 'none'
  end as scraper,
  -- Only meaningful when scraper = 'paused'.
  max(r.paused_reason) filter (where r.adapter is not null and not r.active) as paused_reason,
  -- Lets the app say "last checked 4 days ago" when a live scraper is being blocked (problems log #13).
  (select max(p.observed_at) from public.prices p join public.retailers pr on pr.id = p.retailer_id
    where pr.airport_iata = a.iata and pr.active and p.source = 'scraped') as last_scraped_at,
  (select count(distinct p.product_id) from public.prices p join public.retailers pr on pr.id = p.retailer_id
    where pr.airport_iata = a.iata and pr.active and p.source = 'crowd') as crowd_products,
  (select max(p.observed_at) from public.prices p join public.retailers pr on pr.id = p.retailer_id
    where pr.airport_iata = a.iata and pr.active and p.source = 'crowd') as last_reported_at
from public.airports a
left join public.retailers r on r.airport_iata = a.iata
group by a.iata;

comment on view public.airport_coverage is
  'Per airport: is there a live scraper, a paused one (and why), or only traveller reports. ADR-0015.';

grant select on public.airport_coverage to anon, authenticated;
