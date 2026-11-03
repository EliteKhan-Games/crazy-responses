-- Crazy Responses: fix phantom players and abandoned empty rooms.
-- Run once in Supabase SQL Editor. Safe to run again if needed.

alter table public.players
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists players_last_seen_room_idx
  on public.players(last_seen_at, room_id);

-- Called by each open game tab every 15 seconds.
create or replace function public.heartbeat_crazy_player(p_room_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.players
  set last_seen_at = now()
  where room_id = p_room_id and user_id = p_user_id;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
grant execute on function public.heartbeat_crazy_player(uuid, uuid) to anon, authenticated;

-- Remove players whose browser has stopped checking in for at least 60 seconds.
-- Then hand host duties to the oldest remaining player and remove truly empty rooms.
create or replace function public.cleanup_crazy_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed_players integer := 0;
        removed_rooms integer := 0;
begin
  delete from public.players
  where last_seen_at < now() - interval '60 seconds';
  get diagnostics removed_players = row_count;

  -- If a room's host disappeared, promote its oldest remaining player.
  update public.rooms r
  set host_id = (
    select p.user_id
    from public.players p
    where p.room_id = r.id
    order by p.created_at asc
    limit 1
  )
  where exists (select 1 from public.players p where p.room_id = r.id)
    and not exists (select 1 from public.players p where p.room_id = r.id and p.user_id = r.host_id);

  update public.players p
  set is_host = (p.user_id = r.host_id)
  from public.rooms r
  where p.room_id = r.id;

  -- Delete dependent round data before deleting empty rooms.
  delete from public.votes v
  where not exists (select 1 from public.players p where p.room_id = v.room_id)
    and not exists (select 1 from public.rooms r where r.id = v.room_id);

  delete from public.votes v
  where exists (select 1 from public.rooms r where r.id = v.room_id)
    and not exists (select 1 from public.players p where p.room_id = v.room_id);

  delete from public.submissions s
  where not exists (select 1 from public.players p where p.room_id = s.room_id);

  delete from public.round_ready rr
  where not exists (select 1 from public.players p where p.room_id = rr.room_id);

  delete from public.rooms r
  where not exists (select 1 from public.players p where p.room_id = r.id);
  get diagnostics removed_rooms = row_count;

  return removed_players + removed_rooms;
end;
$$;
grant execute on function public.cleanup_crazy_rooms() to anon, authenticated;

-- Clear old records immediately on the first run, using the same cleanup rules.
select public.cleanup_crazy_rooms();


-- 30-second voting phase. This is shared by everyone in the room.
alter table public.rooms
  add column if not exists voting_deadline_at timestamptz;

-- Automatically end voting when every eligible player has voted or 30 seconds elapsed.
create or replace function public.advance_crazy_vote_if_done(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.rooms r
  set status = 'results'
  where r.id = p_room_id
    and r.status = 'voting'
    and (
      (r.voting_deadline_at is not null and now() >= r.voting_deadline_at)
      or (
        (select count(*)
         from public.players p
         where p.room_id = r.id
           and not coalesce(p.is_spectator, false)
           and coalesce(p.joined_round, 1) <= r.round_number
           and exists (
             select 1 from public.submissions s
             where s.room_id = r.id
               and s.round_number = r.round_number
               and s.user_id <> p.user_id
           )
        )
        <=
        (select count(*) from public.votes v
         where v.room_id = r.id and v.round_number = r.round_number)
      )
    );
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;
grant execute on function public.advance_crazy_vote_if_done(uuid) to anon, authenticated;

-- Reject votes from spectators, self-votes, wrong rounds, or after the voting deadline.
create or replace function public.validate_crazy_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r public.rooms; target public.submissions; voter public.players;
begin
  select * into r from public.rooms where id = new.room_id;
  if not found or r.status <> 'voting' then raise exception 'Voting is not open.'; end if;
  if r.voting_deadline_at is not null and now() >= r.voting_deadline_at then
    raise exception 'Voting time has ended.';
  end if;
  select * into voter from public.players
    where room_id = new.room_id and user_id = new.user_id;
  if not found or coalesce(voter.is_spectator, false)
     or coalesce(voter.joined_round, 1) > r.round_number then
    raise exception 'Spectators cannot vote.';
  end if;
  select * into target from public.submissions
    where id = new.submission_id and room_id = new.room_id
      and round_number = r.round_number;
  if not found then raise exception 'That answer is not part of this round.'; end if;
  if target.user_id = new.user_id then raise exception 'You cannot vote for your own answer.'; end if;
  return new;
end;
$$;
drop trigger if exists validate_crazy_vote_before_insert on public.votes;
create trigger validate_crazy_vote_before_insert
before insert on public.votes
for each row execute function public.validate_crazy_vote();
