-- End-to-end check: scraped + crowd prices, FX conversion, latest-price view, admin-only review.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.admins values ('22222222-2222-2222-2222-222222222222');
insert into fx_rates values ('EUR', 95.5, current_date) on conflict (currency) do update set rate_to_inr = excluded.rate_to_inr;
insert into products (match_key, brand, name, volume_ml) values ('johnnie walker black label|1000','Johnnie Walker','Johnnie Walker Black Label 1L',1000);
insert into prices (product_id, retailer_id, price, currency, source) select 1, id, 3450, 'INR', 'scraped' from retailers where airport_iata='BLR';
insert into prices (product_id, retailer_id, price, currency, source) select 1, id, 32.99, 'EUR', 'scraped' from retailers where airport_iata='AMS';
-- older price should be hidden by latest_prices
insert into prices (product_id, retailer_id, price, currency, source, observed_at) select 1, id, 9999, 'INR', 'scraped', now() - interval '3 days' from retailers where airport_iata='BLR';
insert into price_submissions (submitted_by, airport_iata, product_name, brand, volume_ml, price, currency)
  values ('11111111-1111-1111-1111-111111111111','DXB','Black Label 1L','Johnnie Walker',1000,120,'AED');
-- non-admin cannot review
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin perform review_submission(1, true); raise exception 'should have failed'; exception when others then if sqlerrm like 'only admins%' then raise notice 'non-admin blocked: ok'; else raise; end if; end $$;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select review_submission(1, true, 'matches shelf photo', 1);
select airport_iata, retailer_name, price, currency, price_inr, source from latest_prices order by price_inr nulls last;
select status, reviewed_by is not null as reviewed from price_submissions;
