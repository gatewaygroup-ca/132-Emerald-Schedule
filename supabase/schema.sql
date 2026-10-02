-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- One row per project. The whole schedule is stored as JSON in `data`.
create table if not exists public.projects (
  slug       text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Lock the table down. The app talks to Supabase only from the server
-- using the service role key, which bypasses RLS. No public access.
alter table public.projects enable row level security;
