-- Airport search that copes with alternate names, codes and accents.
--
-- One airport often has several names and codes: Basel's EuroAirport is BSL,
-- MLH and EAP and "Bâle" in French; Bengaluru is still "Bangalore" to most
-- travellers. OurAirports lists these in `keywords`, so we keep them and the
-- ICAO code, and fold accents and punctuation out of the search text.
-- The app's offline search (client/lib/airportSearch.ts) uses the same folding.

create extension if not exists unaccent;

alter table public.airports
  add column if not exists icao text,
  add column if not exists keywords text;

-- unaccent() is only STABLE (its dictionary could change), so a generated
-- column can't call it directly. Pinning the dictionary makes it safe to
-- declare the wrapper IMMUTABLE: this is the standard Postgres workaround.
create or replace function public.search_fold(t text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions, pg_catalog
as $$
  select btrim(regexp_replace(lower(unaccent('unaccent'::regdictionary, coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Rebuild the generated column (and its trigram index, dropped with it).
alter table public.airports drop column search_text;
alter table public.airports add column search_text text generated always as (
  public.search_fold(iata || ' ' || coalesce(icao, '') || ' ' || name || ' ' || coalesce(city, '') || ' ' || coalesce(keywords, ''))
) stored;
create index airports_search_trgm on public.airports using gin (search_text gin_trgm_ops);
