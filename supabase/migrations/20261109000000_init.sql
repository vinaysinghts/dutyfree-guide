-- Duty-free price guide: initial schema.
-- Prices come from two sources: daily scrapes and crowdsourced submissions
-- that only become visible once an admin approves them.

create extension if not exists pg_trgm;

-- Reference data -----------------------------------------------------------

create table public.airports (
  iata          char(3) primary key,
  name          text not null,
  city          text,
  country_code  char(2) not null,
  latitude      double precision,
  longitude     double precision,
  -- Search helper: "bengaluru blr kempegowda ..." for fuzzy matching.
  search_text   text generated always as (
    lower(iata || ' ' || name || ' ' || coalesce(city, ''))
  ) stored
);
create index airports_search_trgm on public.airports using gin (search_text gin_trgm_ops);

create table public.retailers (
  id            bigint generated always as identity primary key,
  airport_iata  char(3) not null references public.airports (iata),
  name          text not null,
  -- Which scraper adapter collects this retailer (null = crowdsourced only).
  adapter       text,
  base_url      text,
  currency      char(3) not null,
  -- Departure/arrival/both; Indian airports also have arrival duty free.
  zone          text not null default 'departure' check (zone in ('departure', 'arrival', 'both')),
  active        boolean not null default true,
  unique (airport_iata, name)
);

-- Products are matched across airports by a normalized key built from
-- brand + name + volume (see scrapers/dutyfree_scrapers/normalize.py).
create table public.products (
  id            bigint generated always as identity primary key,
  match_key     text not null unique,
  brand         text,
  name          text not null,
  volume_ml     integer,
  category      text not null default 'spirits',
  image_url     text,
  created_at    timestamptz not null default now()
);
create index products_name_trgm on public.products using gin (lower(name) gin_trgm_ops);

create table public.fx_rates (
  currency      char(3) primary key,
  -- How many INR one unit of `currency` buys.
  rate_to_inr   numeric(14, 6) not null check (rate_to_inr > 0),
  as_of         date not null
);

-- Crowdsourced submissions (review queue) ---------------------------------

create table public.price_submissions (
  id              bigint generated always as identity primary key,
  submitted_by    uuid references auth.users (id) on delete set null,
  airport_iata    char(3) not null references public.airports (iata),
  product_name    text not null check (length(product_name) between 2 and 200),
  brand           text,
  volume_ml       integer check (volume_ml between 50 and 5000),
  price           numeric(12, 2) not null check (price > 0),
  currency        char(3) not null,
  observed_on     date not null default current_date,
  photo_path      text,
  note            text check (length(note) <= 500),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by     uuid references auth.users (id),
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now()
);
create index price_submissions_pending on public.price_submissions (created_at) where status = 'pending';

-- Prices ------------------------------------------------------------------

create table public.prices (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references public.products (id) on delete cascade,
  retailer_id     bigint not null references public.retailers (id) on delete cascade,
  price           numeric(12, 2) not null check (price > 0),
  currency        char(3) not null,
  source          text not null check (source in ('scraped', 'crowd')),
  product_url     text,
  submission_id   bigint references public.price_submissions (id) on delete set null,
  observed_at     timestamptz not null default now()
);
create index prices_latest on public.prices (product_id, retailer_id, observed_at desc);

-- Admins who can review submissions.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Latest price per product per retailer, converted to INR.
create or replace view public.latest_prices with (security_invoker = true) as
select distinct on (p.product_id, p.retailer_id)
  p.product_id,
  p.retailer_id,
  r.airport_iata,
  r.name                                as retailer_name,
  pr.brand,
  pr.name                               as product_name,
  pr.volume_ml,
  pr.category,
  pr.image_url,
  p.price,
  p.currency,
  round(p.price * coalesce(fx.rate_to_inr, case when p.currency = 'INR' then 1 end), 2) as price_inr,
  p.source,
  p.product_url,
  p.observed_at
from public.prices p
join public.retailers r on r.id = p.retailer_id and r.active
join public.products pr on pr.id = p.product_id
left join public.fx_rates fx on fx.currency = p.currency
order by p.product_id, p.retailer_id, p.observed_at desc;

-- Approving a submission publishes it as a crowd price.
-- Parameters are prefixed p_ so they can't collide with column names
-- (PL/pgSQL raises "column reference is ambiguous" otherwise).
create or replace function public.review_submission(
  p_submission_id bigint,
  p_approve boolean,
  p_note text default null,
  -- Reviewer can link the submission to an existing product so it compares
  -- against scraped prices; otherwise a new product is created.
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

  update public.price_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_submission_id;

  if not p_approve then
    return;
  end if;

  v_product_id := p_existing_product_id;
  if v_product_id is null then
  -- Simplified version of the scrapers' match_key; the reviewer links to an
  -- existing product when the names differ.
  v_key := regexp_replace(lower(coalesce(s.brand, '') || ' ' || s.product_name), '[^a-z0-9]+', ' ', 'g');
  v_key := trim(regexp_replace(v_key, '\s+', ' ', 'g')) || '|' || coalesce(s.volume_ml::text, '?');

  insert into public.products (match_key, brand, name, volume_ml)
  values (v_key, s.brand, s.product_name, s.volume_ml)
  on conflict (match_key) do update set match_key = excluded.match_key
  returning id into v_product_id;
  end if;

  -- Crowd prices hang off a per-airport "Reported by travellers" retailer.
  insert into public.retailers (airport_iata, name, currency)
  values (s.airport_iata, 'Reported by travellers', s.currency)
  on conflict (airport_iata, name) do update set name = excluded.name
  returning id into v_retailer_id;

  insert into public.prices (product_id, retailer_id, price, currency, source, submission_id, observed_at)
  values (v_product_id, v_retailer_id, s.price, s.currency, 'crowd', s.id, s.observed_on::timestamptz);
end;
$$;

-- Trips (saved routes) ----------------------------------------------------

create table public.trips (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'My trip',
  created_at  timestamptz not null default now()
);

create table public.trip_airports (
  trip_id       bigint not null references public.trips (id) on delete cascade,
  position      smallint not null,
  airport_iata  char(3) not null references public.airports (iata),
  primary key (trip_id, position)
);

-- Row level security --------------------------------------------------------

alter table public.airports          enable row level security;
alter table public.retailers         enable row level security;
alter table public.products          enable row level security;
alter table public.prices            enable row level security;
alter table public.fx_rates          enable row level security;
alter table public.price_submissions enable row level security;
alter table public.admins            enable row level security;
alter table public.trips             enable row level security;
alter table public.trip_airports     enable row level security;

-- Public catalogue: anyone can read. Writes come from the scraper using the
-- service role key, which bypasses RLS.
create policy "public read" on public.airports  for select using (true);
create policy "public read" on public.retailers for select using (true);
create policy "public read" on public.products  for select using (true);
create policy "public read" on public.prices    for select using (true);
create policy "public read" on public.fx_rates  for select using (true);

-- Submissions: signed-in users create their own and see their own; admins see all.
create policy "submit own" on public.price_submissions for insert to authenticated
  with check (submitted_by = auth.uid() and status = 'pending');
create policy "read own or admin" on public.price_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

create policy "admins read admins" on public.admins for select to authenticated using (public.is_admin());

create policy "own trips" on public.trips for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy "own trip airports" on public.trip_airports for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.owner = auth.uid()));

-- Storage bucket for shelf-tag photos (private; admins review them).
insert into storage.buckets (id, name, public) values ('submission-photos', 'submission-photos', false)
on conflict (id) do nothing;

create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'submission-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own photos or admin" on storage.objects for select to authenticated
  using (bucket_id = 'submission-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
