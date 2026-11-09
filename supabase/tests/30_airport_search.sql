-- Airport search text: alternate names and codes, accents and punctuation folded.
\set ON_ERROR_STOP 1

insert into airports (iata, icao, name, city, country_code, latitude, longitude, keywords)
values ('BSL', 'LFSB', 'EuroAirport Basel–Mulhouse–Freiburg', 'Bâle / Mulhouse', 'FR', 47.6007, 7.5211, 'MLH, EAP, LSZM, Bâle, Basle')
on conflict (iata) do update set icao = excluded.icao, keywords = excluded.keywords, name = excluded.name, city = excluded.city;

do $$
declare q text;
begin
  foreach q in array array['basel', 'bale', 'basle', 'mlh', 'eap', 'lfsb', 'basel mulhouse'] loop
    -- Same shape as the app: every folded word must appear.
    if not exists (
      select 1 from airports
      where iata = 'BSL'
        and (select bool_and(search_text like '%' || w || '%') from unnest(string_to_array(search_fold(q), ' ')) w)
    ) then
      raise exception 'search for % did not find BSL (search_text=%)', q, (select search_text from airports where iata = 'BSL');
    end if;
  end loop;
  raise notice 'Basel found by every alias: ok';
end $$;

select search_fold('São Paulo/Guarulhos–Governor André') as folded;
