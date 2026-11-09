-- Photo-first reports: optional fields, server-side location check, completeness before approval.
\set ON_ERROR_STOP 1
set request.jwt.claim.sub = '';

-- Photo only, taken inside Schiphol: allowed, and flagged at_airport.
insert into price_submissions (submitted_by, airport_iata, photo_path, capture_latitude, capture_longitude, location_source)
values ('11111111-1111-1111-1111-111111111111', 'AMS', 'u1/a.jpg', 52.3105, 4.7683, 'device');

-- Photo taken in Bengaluru but reported as Schiphol: flagged far.
insert into price_submissions (submitted_by, airport_iata, photo_path, capture_latitude, capture_longitude, location_source)
values ('11111111-1111-1111-1111-111111111111', 'AMS', 'u1/b.jpg', 12.9716, 77.5946, 'exif');

-- Client can't fake the verdict: the trigger recomputes it.
insert into price_submissions (submitted_by, airport_iata, photo_path, location_check)
values ('11111111-1111-1111-1111-111111111111', 'AMS', 'u1/c.jpg', 'at_airport');

select photo_path, location_check, distance_km from price_submissions where photo_path is not null order by photo_path;

-- Neither a photo nor complete details: rejected by the check constraint.
do $$ begin
  insert into price_submissions (submitted_by, airport_iata, product_name)
  values ('11111111-1111-1111-1111-111111111111', 'AMS', 'Black Label');
  raise exception 'should have failed';
exception when check_violation then raise notice 'incomplete report without photo blocked: ok';
end $$;

-- Nearest airport from GPS.
select iata, round(distance_km::numeric, 1) as km from nearest_airports(52.3105, 4.7683, 1);

-- Admin can't approve until details are filled in, then can.
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform review_submission((select id from price_submissions where photo_path = 'u1/a.jpg'), true);
  raise exception 'should have failed';
exception when others then
  if sqlerrm like 'fill in product%' then raise notice 'approval needs details: ok'; else raise; end if;
end $$;
update price_submissions set product_name = 'Black Label', brand = 'Johnnie Walker', volume_ml = 1000, price = 31.99, currency = 'EUR'
 where photo_path = 'u1/a.jpg';
select review_submission((select id from price_submissions where photo_path = 'u1/a.jpg'), true, 'read from photo', 1);
select airport_iata, retailer_name, price, currency, source from latest_prices where source = 'crowd' and airport_iata = 'AMS';
