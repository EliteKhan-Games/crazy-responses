-- Crazy Responses: compatible Supabase setup / repair script
-- Safe to run on the existing prototype schema: it adds missing objects/columns
-- and replaces only the Crazy Responses helper functions/triggers below.
-- It does NOT drop tables or erase room/player/game data.

create extension if not exists pgcrypto;

-- Core tables (create them if this is a fresh Supabase project)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) = 6),
  host_id uuid not null,
  status text not null default 'lobby' check (status in ('lobby','answering','voting','results','finished')),
  round_number integer not null default 0 check (round_number between 0 and 5),
  prompt text,
  round_started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.rooms add column if not exists is_public boolean not null default false;
alter table public.rooms add column if not exists max_players integer not null default 10;
alter table public.rooms add column if not exists match_number integer not null default 1;
alter table public.rooms add column if not exists response_started_at timestamptz;
alter table public.rooms add column if not exists response_deadline_at timestamptz;
alter table public.rooms add column if not exists prompt_key text;
alter table public.rooms add column if not exists round_deadline_at timestamptz;
alter table public.rooms add column if not exists voting_deadline_at timestamptz;

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
alter table public.players add column if not exists is_spectator boolean not null default false;
alter table public.players add column if not exists round_ready boolean not null default false;
alter table public.players add column if not exists joined_round integer not null default 1;
alter table public.players add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  user_id uuid not null,
  answer text not null check (length(answer) between 2 and 180),
  created_at timestamptz not null default now(),
  unique(room_id,round_number,user_id)
);
alter table public.submissions add column if not exists match_number integer not null default 1;
alter table public.submissions add column if not exists author_name text;

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  user_id uuid not null,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(room_id,round_number,user_id)
);
alter table public.votes add column if not exists match_number integer not null default 1;

-- These are separate tables: app.js subscribes to and reads them directly.
create table if not exists public.round_ready (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 5),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(room_id,round_number,user_id)
);

create table if not exists public.used_prompts (
  id bigint generated always as identity primary key,
  normalized_prompt text not null unique,
  prompt text not null,
  style text not null,
  created_at timestamptz not null default now()
);

-- Persistent weekly vote totals. These are intentionally separate from match
-- scores, so Play Again can clear a match without erasing weekly votes.
create table if not exists public.weekly_scores (
  user_id uuid not null,
  username text not null,
  week_start date not null,
  points integer not null default 0,
  primary key(user_id,week_start)
);

create index if not exists players_room_id_idx on public.players(room_id);
create index if not exists submissions_room_round_idx on public.submissions(room_id,round_number);
create index if not exists votes_room_round_idx on public.votes(room_id,round_number);
create index if not exists round_ready_room_round_idx on public.round_ready(room_id,round_number);
create index if not exists rooms_public_status_created_idx on public.rooms(is_public,status,created_at desc);

-- Enable RLS. This is a no-login prototype policy, matching the original setup.
-- IMPORTANT: anyone with the public site can write game rows; do not store secrets here.
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;
alter table public.round_ready enable row level security;
alter table public.used_prompts enable row level security;
alter table public.weekly_scores enable row level security;

drop policy if exists "prototype rooms access" on public.rooms;
create policy "prototype rooms access" on public.rooms for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype players access" on public.players;
create policy "prototype players access" on public.players for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype submissions access" on public.submissions;
create policy "prototype submissions access" on public.submissions for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype votes access" on public.votes;
create policy "prototype votes access" on public.votes for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype round ready access" on public.round_ready;
create policy "prototype round ready access" on public.round_ready for all to anon, authenticated using (true) with check (true);
drop policy if exists "prototype used prompts insert" on public.used_prompts;
create policy "prototype used prompts insert" on public.used_prompts for insert to anon, authenticated with check (true);
drop policy if exists "prototype weekly scores read" on public.weekly_scores;
create policy "prototype weekly scores read" on public.weekly_scores for select to anon, authenticated using (true);

-- Presence heartbeat and stale-player cleanup. No cleanup is run automatically
-- by this SQL file; the app calls the function while it is in a room.
create or replace function public.heartbeat_crazy_player(p_room_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.players set last_seen_at = now()
  where room_id = p_room_id and user_id = p_user_id;
end;
$$;

create or replace function public.cleanup_crazy_rooms()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.players where last_seen_at < now() - interval '120 seconds';

  update public.rooms r
  set host_id = (
    select p.user_id from public.players p
    where p.room_id = r.id order by p.created_at asc limit 1
  )
  where exists (select 1 from public.players p where p.room_id = r.id)
    and not exists (select 1 from public.players p where p.room_id = r.id and p.user_id = r.host_id);

  update public.players p set is_host = (p.user_id = r.host_id)
  from public.rooms r where p.room_id = r.id and p.is_host is distinct from (p.user_id = r.host_id);

  delete from public.rooms r where r.created_at < now() - interval '2 minutes'
    and not exists (select 1 from public.players p where p.room_id = r.id);
end;
$$;

-- Move a room from voting to results once every eligible voter has voted,
-- or the 30-second voting deadline expires.
create or replace function public.advance_crazy_vote_if_done(p_room_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id = p_room_id;
  if not found or r.status <> 'voting' then return; end if;

  if (r.voting_deadline_at is not null and now() >= r.voting_deadline_at)
     or not exists (
       select 1 from public.players p
       where p.room_id = r.id and p.joined_round <= r.round_number
         and exists (select 1 from public.submissions s where s.room_id = r.id and s.round_number = r.round_number and s.user_id <> p.user_id)
         and not exists (select 1 from public.votes v where v.room_id = r.id and v.round_number = r.round_number and v.user_id = p.user_id)
     ) then
    update public.rooms set status = 'results' where id = r.id and status = 'voting';
  end if;
end;
$$;

-- Validate votes and record one weekly point for the author of the chosen answer.
create or replace function public.validate_crazy_vote()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.submissions%rowtype; author text;
begin
  select * into s from public.submissions where id = new.submission_id;
  if not found or s.room_id <> new.room_id or s.round_number <> new.round_number then
    raise exception 'That answer is not part of this round.';
  end if;
  if s.user_id = new.user_id then raise exception 'You cannot vote for your own answer.'; end if;
  select coalesce(s.author_name, p.username, 'Player') into author
  from public.submissions s left join public.players p on p.room_id=s.room_id and p.user_id=s.user_id
  where s.id=new.submission_id;
  insert into public.weekly_scores(user_id,username,week_start,points)
  values (s.user_id,author,date_trunc('week',now() at time zone 'utc')::date,1)
  on conflict (user_id,week_start) do update
    set points=public.weekly_scores.points+1, username=excluded.username;
  return new;
end;
$$;
drop trigger if exists crazy_vote_weekly_points on public.votes;
create trigger crazy_vote_weekly_points before insert on public.votes
for each row execute function public.validate_crazy_vote();

-- Realtime subscriptions used by app.js.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rooms') then alter publication supabase_realtime add table public.rooms; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='players') then alter publication supabase_realtime add table public.players; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='submissions') then alter publication supabase_realtime add table public.submissions; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='votes') then alter publication supabase_realtime add table public.votes; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='round_ready') then alter publication supabase_realtime add table public.round_ready; end if;
  end if;
end;
$$;

-- Deliberately no SELECT cleanup_crazy_rooms() here: installing the schema
-- must not immediately remove rooms or players.
