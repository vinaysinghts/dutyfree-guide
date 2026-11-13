-- Minimal stand-ins for Supabase-managed schemas so migrations run on plain Postgres in tests.
do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth; create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id serial, bucket_id text, name text, created_at timestamptz not null default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;

-- Supabase's grants, so tests see what the Data API roles really can do (problems log #20).
-- Every table, view and function created in `public` is granted to the API roles; RLS and
-- explicit REVOKEs are what actually restrict them. Without these lines a missing REVOKE
-- is invisible in tests.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant usage on all sequences in schema storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
