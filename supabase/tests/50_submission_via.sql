-- Reports remember whether a travel-day nudge started them (ADR-0014).
\set ON_ERROR_STOP 1
set request.jwt.claim.sub = '';

insert into price_submissions (submitted_by, airport_iata, photo_path, via)
values ('11111111-1111-1111-1111-111111111111', 'BLR', 'u1/via-n.jpg', 'nudge_notification');
insert into price_submissions (submitted_by, airport_iata, photo_path)
values ('11111111-1111-1111-1111-111111111111', 'BLR', 'u1/via-m.jpg');

select photo_path, via from price_submissions where photo_path like 'u1/via-%' order by photo_path;

do $$ begin
  insert into price_submissions (submitted_by, airport_iata, photo_path, via)
  values ('11111111-1111-1111-1111-111111111111', 'BLR', 'u1/via-x.jpg', 'push_from_server');
  raise exception 'should have failed';
exception when check_violation then raise notice 'unknown via rejected: ok';
end $$;
