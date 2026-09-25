-- 18 retention / anonymisation + account deletion (docs/05 "Data retention")

-- win/loss counts survive duel deletion
create table public.friend_stats (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  wins      integer not null default 0,
  losses    integer not null default 0,
  draws     integer not null default 0,
  primary key (user_id, friend_id)
);
alter table public.friend_stats enable row level security;
grant select on public.friend_stats to authenticated;
create policy friend_stats_read on public.friend_stats for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- photo hashes of deleted listings, kept for dedupe
create table public.listing_hashes (
  photo_hash text primary key,
  category   text,
  deleted_at timestamptz not null default now()
);
alter table public.listing_hashes enable row level security;

-- fold a finished duel into friend_stats (both directions)
create or replace function private.record_duel_stats(d public.duels) returns void
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  if d.challenger is null or d.opponent is null or d.status <> 'finished' then return; end if;
  a := coalesce((d.scores ->> d.challenger::text)::int, 0);
  b := coalesce((d.scores ->> d.opponent::text)::int, 0);
  insert into friend_stats (user_id, friend_id, wins, losses, draws)
  values (d.challenger, d.opponent, (a > b)::int, (a < b)::int, (a = b)::int),
         (d.opponent, d.challenger, (b > a)::int, (b < a)::int, (a = b)::int)
  on conflict (user_id, friend_id) do update
    set wins = friend_stats.wins + excluded.wins,
        losses = friend_stats.losses + excluded.losses,
        draws = friend_stats.draws + excluded.draws;
end $$;

create or replace function private.run_retention() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_guesses int; n_duels int; n_rooms int; n_tickets int; n_rates int; n_listings int; n_runs int;
  d duels;
begin
  -- guesses: solo/streak 90 d, contexts 1 y -> break the link to a person, keep the stats
  with u as (
    update guesses set user_id = null
    where user_id is not null and (
      (mode in ('solo','streak') and created_at < now() - interval '90 days') or
      (mode in ('daily','duel','room') and created_at < now() - interval '1 year'))
    returning 1)
  select count(*) into n_guesses from u;

  -- duels finished/expired/declined 180 d -> stats, then delete row + prices
  n_duels := 0;
  for d in select * from duels
           where status in ('finished','expired','declined')
             and coalesce(finished_at, created_at) < now() - interval '180 days' loop
    perform private.record_duel_stats(d);
    delete from context_prices where context_type = 'duel' and context_id = d.id::text;
    delete from duels where id = d.id;
    n_duels := n_duels + 1;
  end loop;

  -- rooms finished 30 d
  with del as (
    delete from rooms where status = 'finished' and coalesce(finished_at, created_at) < now() - interval '30 days'
    returning code)
  select count(*) into n_rooms from del;
  delete from context_prices cp where cp.context_type = 'room'
    and not exists (select 1 from rooms r where r.code = cp.context_id);
  -- daily prices older than 60 d are only needed while the set can be replayed
  delete from context_prices cp where cp.context_type = 'daily' and cp.context_id < (current_date - 60)::text;

  with del as (delete from push_tickets where sent_at < now() - interval '7 days' returning 1)
  select count(*) into n_tickets from del;
  with del as (delete from rate_limits where "window" < current_date - 7 returning 1)
  select count(*) into n_rates from del;

  -- listings expired/rejected 60 d, unless something still references them
  insert into listing_hashes (photo_hash, category)
  select l.photo_hash, l.category from listings l
  where l.status in ('expired','rejected') and l.checked_at < now() - interval '60 days' and l.photo_hash is not null
  on conflict (photo_hash) do nothing;
  with del as (
    delete from listings l
    where l.status in ('expired','rejected') and l.checked_at < now() - interval '60 days'
      and not exists (select 1 from guesses g where g.listing_id = l.id)
      and not exists (select 1 from daily_sets ds where l.id = any(ds.listing_ids))
      and not exists (select 1 from duels d2 where l.id = any(d2.listing_ids))
      and not exists (select 1 from rooms r where l.id = any(r.listing_ids))
    returning 1)
  select count(*) into n_listings from del;
  -- attributes._raw: 30 d
  update listings set attributes = attributes - '_raw'
  where attributes ? '_raw' and first_seen_at < now() - interval '30 days';

  -- scrape_runs 180 d (table from 19; may not exist yet on first run)
  n_runs := 0;
  if to_regclass('public.scrape_runs') is not null then
    with del as (delete from scrape_runs where started_at < now() - interval '180 days' returning 1)
    select count(*) into n_runs from del;
  end if;

  return jsonb_build_object('guesses_anonymised', n_guesses, 'duels', n_duels, 'rooms', n_rooms,
                            'push_tickets', n_tickets, 'rate_limits', n_rates, 'listings', n_listings,
                            'scrape_runs', n_runs);
end $$;

-- Every account is anonymous; purge only the ones that never became a player:
-- no chosen username AND no guesses for 90 days (and older than 90 days).
-- A profile with a chosen username is a real player and is never deleted here.
create or replace function private.purge_idle_anonymous() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with del as (
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - interval '90 days'
      and public.is_auto_username((select p.username from profiles p where p.id = u.id))
      and not exists (select 1 from guesses g where g.user_id = u.id and g.created_at > now() - interval '90 days')
    returning 1)
  select count(*) into n from del;
  return n;
end $$;

-- Account deletion (App Store requirement). Historical duel rows survive for the
-- other player as "deleted user" (challenger/opponent are on delete set null).
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign_in_required'; end if;
  update guesses set user_id = null where user_id = me;
  delete from daily_results where user_id = me;
  delete from friendships where user_id = me or friend_id = me;
  delete from friend_stats where user_id = me or friend_id = me;
  delete from push_tokens where user_id = me;
  delete from room_players where user_id = me;
  update rooms set status = 'finished', finished_at = now() where host = me and status <> 'finished'
    and not exists (select 1 from room_players rp where rp.room_code = rooms.code);
  update duels set status = 'expired', finished_at = now()
    where (challenger = me or opponent = me) and status in ('invited','live');
  update duels set challenger = null where challenger = me;
  update duels set opponent   = null where opponent   = me;
  delete from profiles where id = me;
  delete from auth.users where id = me;   -- ends the session
end $$;
grant execute on function public.delete_me() to authenticated;
