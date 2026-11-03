-- Crazy Responses expansion migration
-- BACK UP YOUR PROJECT BEFORE RUNNING. This extends the starter schema you supplied.
-- Prototype-only open RLS is retained for compatibility; it is NOT secure for public launch.

create extension if not exists pgcrypto;

alter table public.rooms add column if not exists server_name text not null default 'Crazy Responses';
alter table public.rooms add column if not exists round_count integer not null default 5;
alter table public.rooms add column if not exists prompt_style text not null default 'mixed';
alter table public.rooms add column if not exists is_public boolean not null default true;
alter table public.rooms add column if not exists max_players integer not null default 6;
alter table public.rooms add column if not exists round_deadline_at timestamptz;
alter table public.rooms add column if not exists voting_deadline_at timestamptz;
alter table public.rooms add column if not exists results_deadline_at timestamptz;
alter table public.rooms add column if not exists round_winner_submission_id uuid;

alter table public.players add column if not exists joined_round integer not null default 1;
alter table public.players add column if not exists last_seen_at timestamptz not null default now();
alter table public.players add column if not exists round_wins integer not null default 0;

alter table public.submissions add column if not exists author_name text;
update public.submissions s set author_name=p.username from public.players p
where p.room_id=s.room_id and p.user_id=s.user_id and s.author_name is null;

-- Expand round constraints from the original 5-round starter to 10 rounds.
alter table public.rooms drop constraint if exists rooms_round_number_check;
alter table public.rooms add constraint rooms_round_number_check check (round_number between 0 and 10);
alter table public.submissions drop constraint if exists submissions_round_number_check;
alter table public.submissions add constraint submissions_round_number_check check (round_number between 1 and 10);
alter table public.votes drop constraint if exists votes_round_number_check;
alter table public.votes add constraint votes_round_number_check check (round_number between 1 and 10);

do $$ begin
  alter table public.rooms add constraint rooms_round_count_check check (round_count in (3,5,10));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.rooms add constraint rooms_max_players_check check (max_players between 3 and 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.rooms add constraint rooms_prompt_style_check check (prompt_style in ('mixed','comedy','chaotic'));
exception when duplicate_object then null; end $$;

create table if not exists public.round_ready (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 10),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(room_id,round_number,user_id)
);

create table if not exists public.weekly_scores (
  user_id uuid not null,
  username text not null,
  week_start date not null,
  points integer not null default 0 check(points >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,week_start)
);

create table if not exists public.lobby_chat (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  username text not null,
  message text not null check(length(message) between 1 and 240),
  created_at timestamptz not null default now()
);

create index if not exists rooms_public_lobby_idx on public.rooms(is_public,created_at desc) where status='lobby';
create index if not exists players_room_idx on public.players(room_id);
create index if not exists submissions_room_round_idx on public.submissions(room_id,round_number);
create index if not exists votes_room_round_idx on public.votes(room_id,round_number);
create index if not exists weekly_scores_week_points_idx on public.weekly_scores(week_start,points desc);
create index if not exists lobby_chat_room_time_idx on public.lobby_chat(room_id,created_at);

alter table public.round_ready enable row level security;
alter table public.weekly_scores enable row level security;
alter table public.lobby_chat enable row level security;
drop policy if exists "prototype round_ready access" on public.round_ready;
create policy "prototype round_ready access" on public.round_ready for all to anon,authenticated using(true) with check(true);
drop policy if exists "prototype weekly_scores access" on public.weekly_scores;
create policy "prototype weekly_scores access" on public.weekly_scores for all to anon,authenticated using(true) with check(true);
drop policy if exists "prototype lobby_chat access" on public.lobby_chat;
create policy "prototype lobby_chat access" on public.lobby_chat for all to anon,authenticated using(true) with check(true);

do $$ begin alter publication supabase_realtime add table public.round_ready;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.weekly_scores;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.lobby_chat;
exception when duplicate_object then null; end $$;

-- NOTE: The current browser prototype uses the open policies above. For public release,
-- replace them with server-authorized RPC/Edge Function actions and rate limiting.

-- Reliability fixes for the playable rebuild.
alter table public.submissions add column if not exists edit_count integer not null default 0;
alter table public.weekly_scores add column if not exists first_reached_at timestamptz not null default now();
create index if not exists round_ready_room_round_idx on public.round_ready(room_id,round_number);

-- A player can mark ready once. The response clock begins only when every
-- currently active player (not a mid-round spectator) is ready.
create or replace function public.cr_mark_ready(p_room_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype; active_count integer; ready_count integer;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not found or r.status <> 'answering' then raise exception 'This round is not accepting ready checks'; end if;
  if not exists(select 1 from public.players where room_id=p_room_id and user_id=p_user_id and joined_round<=r.round_number) then
    raise exception 'Player is not active in this round';
  end if;
  insert into public.round_ready(room_id,round_number,user_id)
  values(p_room_id,r.round_number,p_user_id) on conflict do nothing;
  select count(*) into active_count from public.players where room_id=p_room_id and joined_round<=r.round_number;
  select count(*) into ready_count from public.round_ready where room_id=p_room_id and round_number=r.round_number
    and user_id in (select user_id from public.players where room_id=p_room_id and joined_round<=r.round_number);
  if active_count>0 and ready_count>=active_count and r.round_deadline_at is null then
    update public.rooms set round_started_at=now(),round_deadline_at=now()+interval '60 seconds' where id=p_room_id;
  end if;
end; $$;

-- Host-only, deadline-checked phase transition. Safe if multiple host tabs race.
create or replace function public.cr_advance_to_voting(p_room_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not found or r.host_id<>p_user_id then raise exception 'Only the host can advance the round'; end if;
  if r.status<>'answering' then return; end if;
  if r.round_deadline_at is null or r.round_deadline_at>now() then raise exception 'The response timer has not expired'; end if;
  update public.rooms set status='voting',voting_deadline_at=now()+interval '30 seconds' where id=p_room_id;
end; $$;

-- Exactly-once settlement in one transaction. A room row lock prevents duplicate
-- score awards when multiple tabs or reconnecting hosts try to finish voting.
create or replace function public.cr_settle_round(p_room_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype; winner uuid; week date; rec record;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not found or r.host_id<>p_user_id then raise exception 'Only the host can finish voting'; end if;
  if r.status<>'voting' then return; end if;
  if r.voting_deadline_at is null or r.voting_deadline_at>now() then raise exception 'Voting is still open'; end if;

  select v.submission_id into winner
  from public.votes v
  join public.submissions s on s.id=v.submission_id
  where v.room_id=p_room_id and v.round_number=r.round_number
  group by v.submission_id
  order by count(*) desc, min(v.created_at) asc
  limit 1;

  for rec in
    select s.user_id,s.author_name,count(v.id)::integer as earned
    from public.submissions s left join public.votes v on v.submission_id=s.id
      and v.room_id=p_room_id and v.round_number=r.round_number
    where s.room_id=p_room_id and s.round_number=r.round_number
    group by s.user_id,s.author_name
  loop
    update public.players p set score=p.score+rec.earned,
      round_wins=p.round_wins+case when exists(
        select 1 from public.submissions sw where sw.id=winner and sw.user_id=rec.user_id
      ) then 1 else 0 end
    where p.room_id=p_room_id and p.user_id=rec.user_id;
    if rec.earned>0 then
      week := date_trunc('week',now())::date;
      insert into public.weekly_scores(user_id,username,week_start,points,updated_at,first_reached_at)
      values(rec.user_id,coalesce(rec.author_name,'Player'),week,rec.earned,now(),now())
      on conflict(user_id,week_start) do update set
        points=public.weekly_scores.points+excluded.points,
        username=excluded.username,updated_at=now(),first_reached_at=now();
    end if;
  end loop;
  update public.rooms set status='results',round_winner_submission_id=winner,
    results_deadline_at=now()+interval '15 seconds' where id=p_room_id;
end; $$;

revoke all on function public.cr_mark_ready(uuid,uuid) from public;
revoke all on function public.cr_advance_to_voting(uuid,uuid) from public;
revoke all on function public.cr_settle_round(uuid,uuid) from public;
grant execute on function public.cr_mark_ready(uuid,uuid) to anon,authenticated;
grant execute on function public.cr_advance_to_voting(uuid,uuid) to anon,authenticated;
grant execute on function public.cr_settle_round(uuid,uuid) to anon,authenticated;

-- IMPORTANT SECURITY NOTE:
-- These RPCs fix atomic game-state transitions and prevent accidental duplicate
-- scoring, but this prototype still uses client-supplied guest UUIDs and the
-- permissive policies from the starter schema. A public launch needs Supabase
-- anonymous Auth (auth.uid()), membership-checked RPCs, strict RLS, abuse limits,
-- and server-side moderation. Do not treat the publishable anon key as a secret.

-- Presence cleanup and host handoff. A disconnected player has a 90-second
-- grace period to reconnect; after that their stale player row is removed.
create or replace function public.cr_maintain_room(p_room_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype; active_count integer; ready_count integer; host_seen timestamptz;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not found then return; end if;
  delete from public.players where room_id=p_room_id and last_seen_at < now()-interval '90 seconds';
  if not exists(select 1 from public.players where room_id=p_room_id) then
    delete from public.rooms where id=p_room_id;
    return;
  end if;
  select last_seen_at into host_seen from public.players where room_id=p_room_id and user_id=r.host_id;
  if host_seen is null or host_seen < now()-interval '45 seconds' then
    update public.players set is_host=false where room_id=p_room_id;
    update public.players set is_host=true where room_id=p_room_id and user_id=(
      select user_id from public.players where room_id=p_room_id
      order by score desc,created_at asc limit 1
    );
    update public.rooms set host_id=(select user_id from public.players where room_id=p_room_id and is_host=true limit 1) where id=p_room_id;
  end if;
  if r.status='answering' and r.round_deadline_at is null then
    select count(*) into active_count from public.players where room_id=p_room_id and joined_round<=r.round_number;
    select count(*) into ready_count from public.round_ready where room_id=p_room_id and round_number=r.round_number
      and user_id in (select user_id from public.players where room_id=p_room_id and joined_round<=r.round_number);
    if active_count>0 and ready_count>=active_count then
      update public.rooms set round_started_at=now(),round_deadline_at=now()+interval '60 seconds' where id=p_room_id and round_deadline_at is null;
    end if;
  end if;
end; $$;
revoke all on function public.cr_maintain_room(uuid) from public;
grant execute on function public.cr_maintain_room(uuid) to anon,authenticated;

create or replace function public.cr_submit_answer(p_room_id uuid,p_user_id uuid,p_answer text,p_username text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype;
begin
  select * into r from public.rooms where id=p_room_id for update;
  if not found or r.status<>'answering' or r.round_deadline_at is null or r.round_deadline_at<now() then raise exception 'The answer window is closed'; end if;
  if not exists(select 1 from public.players where room_id=p_room_id and user_id=p_user_id and joined_round<=r.round_number) then raise exception 'You are not active this round'; end if;
  if length(trim(p_answer))<2 or length(trim(p_answer))>180 then raise exception 'Answer must be 2–180 characters'; end if;
  insert into public.submissions(room_id,round_number,user_id,answer,author_name,edit_count)
  values(p_room_id,r.round_number,p_user_id,trim(p_answer),left(trim(p_username),18),0);
end; $$;

create or replace function public.cr_edit_submission(p_submission_id uuid,p_user_id uuid,p_answer text)
returns void language plpgsql security definer set search_path=public as $$
declare s public.submissions%rowtype; r public.rooms%rowtype;
begin
  select * into s from public.submissions where id=p_submission_id for update;
  if not found or s.user_id<>p_user_id then raise exception 'Answer not found'; end if;
  select * into r from public.rooms where id=s.room_id;
  if r.status<>'answering' or r.round_number<>s.round_number or r.round_deadline_at is null or r.round_deadline_at<now() then raise exception 'Answers are locked'; end if;
  if s.edit_count>=1 then raise exception 'Your one edit has already been used'; end if;
  if length(trim(p_answer))<2 or length(trim(p_answer))>180 then raise exception 'Answer must be 2–180 characters'; end if;
  update public.submissions set answer=trim(p_answer),edit_count=edit_count+1 where id=p_submission_id;
end; $$;

create or replace function public.cr_cast_vote(p_room_id uuid,p_user_id uuid,p_submission_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.rooms%rowtype; target public.submissions%rowtype;
begin
  select * into r from public.rooms where id=p_room_id;
  if not found or r.status<>'voting' or r.voting_deadline_at is null or r.voting_deadline_at<now() then raise exception 'Voting is closed'; end if;
  if not exists(select 1 from public.players where room_id=p_room_id and user_id=p_user_id and joined_round<=r.round_number) then raise exception 'You are not active this round'; end if;
  select * into target from public.submissions where id=p_submission_id and room_id=p_room_id and round_number=r.round_number;
  if not found then raise exception 'That answer is not available'; end if;
  if target.user_id=p_user_id then raise exception 'You cannot vote for your own answer'; end if;
  insert into public.votes(room_id,round_number,user_id,submission_id) values(p_room_id,r.round_number,p_user_id,p_submission_id);
end; $$;

revoke all on function public.cr_submit_answer(uuid,uuid,text,text) from public;
revoke all on function public.cr_edit_submission(uuid,uuid,text) from public;
revoke all on function public.cr_cast_vote(uuid,uuid,uuid) from public;
grant execute on function public.cr_submit_answer(uuid,uuid,text,text) to anon,authenticated;
grant execute on function public.cr_edit_submission(uuid,uuid,text) to anon,authenticated;
grant execute on function public.cr_cast_vote(uuid,uuid,uuid) to anon,authenticated;

-- Opportunistic cleanup on game load: rooms with no players, or only players
-- whose heartbeat is older than the 90-second grace period, are removed.
create or replace function public.cr_cleanup_empty_rooms()
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.rooms r
  where not exists(select 1 from public.players p where p.room_id=r.id and p.last_seen_at>=now()-interval '90 seconds');
end; $$;
revoke all on function public.cr_cleanup_empty_rooms() from public;
grant execute on function public.cr_cleanup_empty_rooms() to anon,authenticated;
