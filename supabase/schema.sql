-- Phrase Reel sync (run once in the Supabase SQL editor, 2026-11-25).
-- Append-only event log + per-user settings. Row-level security: only the signed-in owner can read/write their rows.
create table if not exists public.events (
  seq bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  t bigint not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists events_user_seq on public.events (user_id, seq);
alter table public.events enable row level security;
drop policy if exists "own events read" on public.events;
drop policy if exists "own events add" on public.events;
create policy "own events read" on public.events for select to authenticated using (user_id = (select auth.uid()));
create policy "own events add" on public.events for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.events from anon, authenticated;
grant select, insert on public.events to authenticated;

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
