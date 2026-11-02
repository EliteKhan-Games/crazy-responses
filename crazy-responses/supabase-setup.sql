-- Crazy Responses: initial database schema
-- Run this entire file in Supabase -> SQL Editor -> New query -> Run.
-- This starter schema is intentionally open for a small private prototype.
-- Anyone with your public website link can read/write game data. Do not use it
-- for sensitive information or a public competitive launch without server-side
-- validation, stricter RLS policies, and rate limiting.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) = 6),
  host_id uuid not null,
  status text not null default 'lobby'
    check (status in ('lobby','answering','voting','results','finished')),
  round_number integer not null default 0 check (round_number between 0 and 5),
  prompt text,
  round_started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  username text not null check (length(username) between 2 and 18),
  is_host boolean not null default false,
  score integer not null default 0 check (score >= 0),
  created_at timestamptz not null default now(),
  unique(room_id,user_id)
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  user_id uuid not null,
  answer text not null check (length(answer) between 2 and 180),
  created_at timestamptz not null default now(),
  unique(room_id,round_number,user_id)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  user_id uuid not null,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(room_id,round_number,user_id)
);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;

-- Prototype-only policies: allow anonymous browser clients to play.
drop policy if exists "prototype rooms access" on public.rooms;
create policy "prototype rooms access" on public.rooms for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype players access" on public.players;
create policy "prototype players access" on public.players for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype submissions access" on public.submissions;
create policy "prototype submissions access" on public.submissions for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype votes access" on public.votes;
create policy "prototype votes access" on public.votes for all to anon, authenticated using (true) with check (true);

-- Enable database change events so all browsers in a room stay in sync.
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.votes;
exception when duplicate_object then null;
end $$;