-- 11 daily RPCs: get_daily, submit_daily, leaderboard, my_rank

-- today's set (Europe/Riga) without prices + whether the caller already played
create or replace function public.get_daily()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  today  date := (now() at time zone 'Europe/Riga')::date;
  ds     daily_sets;
  played daily_results;
  items  jsonb := '[]'::jsonb;
  item   jsonb;
  i      int := 0;
  ttl    interval;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select * into ds from daily_sets where day = today;
  if ds.day is null then raise exception 'daily_not_ready'; end if;
  select * into played from daily_results where day = today and user_id = auth.uid();

  -- tokens die at midnight Riga
  ttl := ((today + 1)::timestamp at time zone 'Europe/Riga') - now();
  if ttl < interval '1 minute' then ttl := interval '1 minute'; end if;

  for item in select * from jsonb_array_elements(ds.snapshot) loop
    i := i + 1;
    items := items || ((item - 'price_eur') || jsonb_build_object(
      'round_no', i,
      'token', private.issue_round_token((item ->> 'id')::bigint, 'daily', today::text, i::smallint, ttl)));
  end loop;

  return jsonb_build_object(
    'day', today,
    'number', today - date '2026-01-01' + 1,            -- "Uzmini Cenu #37"
    'rounds', items,
    'already_played', played.day is not null,
    'result', case when played.day is null then null else to_jsonb(played) end);
end $$;

-- closes the day: 5 guesses via submit_guess must exist; writes daily_results, returns grid
create or replace function public.submit_daily()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  today date := (now() at time zone 'Europe/Riga')::date;
  tot   int;
  g     text;
  n     int;
  num   int := today - date '2026-01-01' + 1;
begin
  perform private.require_username();   -- the board shows usernames, so one is needed to be on it
  if not exists (select 1 from daily_sets where day = today) then raise exception 'daily_not_ready'; end if;

  select count(*), coalesce(sum(gs.score), 0),
         string_agg(public.grid_cell(gs.guess_eur, cp.price_eur), '' order by gs.round_no)
    into n, tot, g
  from guesses gs
  join context_prices cp on cp.context_type = 'daily' and cp.context_id = today::text and cp.listing_id = gs.listing_id
  where gs.user_id = auth.uid() and gs.mode = 'daily' and gs.context_id = today::text;
  if n <> 5 then raise exception 'daily_incomplete' using hint = n::text; end if;

  insert into daily_results (day, user_id, total, grid) values (today, auth.uid(), tot, g)
  on conflict (day, user_id) do nothing;
  -- if already submitted earlier, return the stored row so the share text is stable
  select dr.total, dr.grid into tot, g from daily_results dr where dr.day = today and dr.user_id = auth.uid();

  return jsonb_build_object('total', tot, 'grid', g,
    'share_text', format('Uzmini Cenu #%s  %s / 5 000%s%s%suzminicenu.lv',
                         num, replace(to_char(tot, 'FM9G999'), ',', ' '), chr(10), g, chr(10)));
end $$;

-- global / friends, day / week / all. Sum of daily totals in the period.
create or replace function public.leaderboard(p_scope text default 'global',   -- global | friends
                                              p_period text default 'day')     -- day | week | all
returns table (rank bigint, user_id uuid, username text, avatar text, total bigint, is_me boolean)
language sql stable security definer set search_path = public as $$
  with range as (
    select case p_period
             when 'day'  then (now() at time zone 'Europe/Riga')::date
             when 'week' then date_trunc('week', now() at time zone 'Europe/Riga')::date
             else date '2000-01-01' end as from_day
  ),
  agg as (
    select dr.user_id, sum(dr.total)::bigint as total, min(dr.submitted_at) as first_at
    from daily_results dr, range
    where dr.day >= range.from_day
      and (p_scope = 'global' or dr.user_id = auth.uid() or is_friend(dr.user_id))
    group by dr.user_id
  )
  select rank() over (order by a.total desc, a.first_at, p.username) as rank,
         a.user_id, p.username, p.avatar, a.total,
         a.user_id = auth.uid() as is_me
  from agg a join profiles p on p.id = a.user_id
  order by a.total desc, a.first_at, p.username
  limit 100
$$;

-- caller's rank in the same board (null if not on it), for the "you are #412" row
create or replace function public.my_rank(p_scope text default 'global', p_period text default 'day')
returns integer language sql stable security definer set search_path = public as $$
  with range as (
    select case p_period
             when 'day'  then (now() at time zone 'Europe/Riga')::date
             when 'week' then date_trunc('week', now() at time zone 'Europe/Riga')::date
             else date '2000-01-01' end as from_day
  ),
  agg as (
    select dr.user_id, sum(dr.total)::bigint as total
    from daily_results dr, range
    where dr.day >= range.from_day
      and (p_scope = 'global' or dr.user_id = auth.uid() or is_friend(dr.user_id))
    group by dr.user_id
  ),
  me as (select total from agg where user_id = auth.uid())
  select case when (select total from me) is null then null
         else (select count(*)::int + 1 from agg, me where agg.total > me.total) end
$$;
