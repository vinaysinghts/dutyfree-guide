-- Photo-first price reports.
--
-- A traveller can now send just a photo of the shelf tag. The app runs OCR on
-- the device and pre-fills what it can read; the rest is filled in by the
-- reviewer. Location (from the device or the photo's EXIF) is checked against
-- the airport on the server, so the reviewer sees whether the photo was really
-- taken there.

-- 1. Typed fields become optional when there's a photo to read them from.
alter table public.price_submissions
  alter column product_name drop not null,
  alter column price        drop not null,
  alter column currency     drop not null,
  add constraint price_submissions_photo_or_details check (
    photo_path is not null
    or (product_name is not null and price is not null and currency is not null)
  );

-- 2. What OCR read, and where/when the photo was taken.
alter table public.price_submissions
  add column ocr_text            text check (length(ocr_text) <= 5000),
  add column ocr_draft           jsonb,
  add column capture_latitude    double precision check (capture_latitude between -90 and 90),
  add column capture_longitude   double precision check (capture_longitude between -180 and 180),
  add column capture_accuracy_m  real,
  add column location_source     text check (location_source in ('device', 'exif')),
  add column photo_taken_at      timestamptz,
  -- Computed by the trigger below; anything the client sends is overwritten.
  add column distance_km         numeric(9, 2),
  add column location_check      text not null default 'unknown'
    check (location_check in ('at_airport', 'near', 'far', 'unknown'));

-- Great-circle distance in km. Plain SQL so it needs no PostGIS extension.
create or replace function public.distance_km(lat1 double precision, lon1 double precision,
                                              lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

create or replace function public.price_submissions_check_location()
returns trigger language plpgsql as $$
declare
  a public.airports;
begin
  select * into a from public.airports where iata = new.airport_iata;
  if new.capture_latitude is null or new.capture_longitude is null
     or a.latitude is null or a.longitude is null then
    new.distance_km := null;
    new.location_check := 'unknown';
  else
    new.distance_km := round(public.distance_km(new.capture_latitude, new.capture_longitude,
                                                a.latitude, a.longitude)::numeric, 2);
    new.location_check := case
      when new.distance_km <= 5  then 'at_airport'   -- terminals sit within a few km of the reference point
      when new.distance_km <= 50 then 'near'         -- e.g. taken in the city, or low GPS accuracy
      else 'far'
    end;
  end if;
  return new;
end;
$$;

create trigger price_submissions_check_location
  before insert or update of airport_iata, capture_latitude, capture_longitude, location_check, distance_km
  on public.price_submissions
  for each row execute function public.price_submissions_check_location();

-- 3. Nearest airports to a point, used to pre-select the airport from GPS.
create or replace function public.nearest_airports(lat double precision, lon double precision, max_results int default 3)
returns table (iata char(3), name text, city text, country_code char(2), latitude double precision,
               longitude double precision, distance_km double precision)
language sql stable as $$
  select a.iata, a.name, a.city, a.country_code, a.latitude, a.longitude,
         public.distance_km(lat, lon, a.latitude, a.longitude) as distance_km
  from public.airports a
  where a.latitude is not null
    -- cheap bounding box first (about +-1 degree) so we don't compute every distance
    and a.latitude between lat - 1 and lat + 1
  order by distance_km
  limit least(max_results, 10);
$$;

-- 4. Reviewers fill in or correct what OCR missed before approving.
create policy "admins update submissions" on public.price_submissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 5. Approval now requires the details to be complete.
create or replace function public.review_submission(
  p_submission_id bigint,
  p_approve boolean,
  p_note text default null,
  p_existing_product_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.price_submissions;
  v_product_id bigint;
  v_retailer_id bigint;
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'only admins can review submissions';
  end if;

  select * into s from public.price_submissions where id = p_submission_id for update;
  if not found or s.status <> 'pending' then
    raise exception 'submission % is not pending', p_submission_id;
  end if;

  if p_approve and (s.product_name is null or s.price is null or s.currency is null) then
    raise exception 'fill in product, price and currency before approving submission %', p_submission_id;
  end if;

  update public.price_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_submission_id;

  if not p_approve then
    return;
  end if;

  v_product_id := p_existing_product_id;
  if v_product_id is null then
    v_key := regexp_replace(lower(coalesce(s.brand, '') || ' ' || s.product_name), '[^a-z0-9]+', ' ', 'g');
    v_key := trim(regexp_replace(v_key, '\s+', ' ', 'g')) || '|' || coalesce(s.volume_ml::text, '?');

    insert into public.products (match_key, brand, name, volume_ml)
    values (v_key, s.brand, s.product_name, s.volume_ml)
    on conflict (match_key) do update set match_key = excluded.match_key
    returning id into v_product_id;
  end if;

  insert into public.retailers (airport_iata, name, currency)
  values (s.airport_iata, 'Reported by travellers', s.currency)
  on conflict (airport_iata, name) do update set name = excluded.name
  returning id into v_retailer_id;

  insert into public.prices (product_id, retailer_id, price, currency, source, submission_id, observed_at)
  values (v_product_id, v_retailer_id, s.price, s.currency, 'crowd', s.id,
          coalesce(s.photo_taken_at, s.observed_on::timestamptz));
end;
$$;
