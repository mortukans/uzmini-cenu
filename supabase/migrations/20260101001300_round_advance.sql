-- 14 round advance: close_round, guess trigger, maybe_close_expired, poke, sweep_deadlines
-- Pattern (docs/06): "advance on next write" is primary, pg_cron sweep is the backstop.

-- Closes the current round of a room/duel: copies guesses into results, bumps totals,
-- opens the next round (35 s = 5 s scoreboard + 30 s round) or finishes.
-- Idempotent: the `for update` + `not (results ? round)` guard makes a concurrent second close a no-op.
create or replace function private.close_round(p_ctx text, p_ctx_id text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  rno      smallint;
  nrounds  int;
  res      jsonb;
  prev_res jsonb;
  is_async boolean := false;
  done     boolean;
begin
  if p_ctx = 'room' then
    select r.current_round, r.rounds into rno, nrounds
      from rooms r where r.code = p_ctx_id and r.status = 'live' and r.current_round >= 1
      and not (r.results ? r.current_round::text) for update;
    if rno is null then return false; end if;

    select coalesce(jsonb_object_agg(g.user_id, jsonb_build_object('guess', g.guess_eur, 'score', g.score)), '{}')
      into res from guesses g where g.mode = 'room' and g.context_id = p_ctx_id and g.round_no = rno and g.user_id is not null;

    update room_players rp set total = rp.total + coalesce((res -> rp.user_id::text ->> 'score')::int, 0)
      where rp.room_code = p_ctx_id;

    -- abandoned room: two consecutive rounds with zero guesses -> finish now
    select r.results -> (rno - 1)::text into prev_res from rooms r where r.code = p_ctx_id;
    done := rno >= nrounds or (res = '{}'::jsonb and rno > 1 and coalesce(prev_res, '{}'::jsonb) = '{}'::jsonb);

    update rooms set
      results        = results || jsonb_build_object(rno::text, res),
      current_round  = case when done then rno else rno + 1 end,
      status         = case when done then 'finished' else 'live' end,
      finished_at    = case when done then now() else null end,
      round_deadline = case when done then null else now() + interval '35 seconds' end
    where code = p_ctx_id;
    return true;

  elsif p_ctx = 'duel' then
    select d.current_round, array_length(d.listing_ids, 1), d.async into rno, nrounds, is_async
      from duels d where d.id = p_ctx_id::uuid and d.status = 'live'
      and not (d.results ? d.current_round::text) for update;
    if rno is null then return false; end if;

    select coalesce(jsonb_object_agg(g.user_id, jsonb_build_object('guess', g.guess_eur, 'score', g.score)), '{}')
      into res from guesses g where g.mode = 'duel' and g.context_id = p_ctx_id and g.round_no = rno and g.user_id is not null;
    done := rno >= nrounds;

    update duels set
      results        = results || jsonb_build_object(rno::text, res),
      scores         = (select coalesce(jsonb_object_agg(x.u, x.t), '{}') from (
                          select g.user_id::text as u, sum(g.score) as t from guesses g
                          where g.mode = 'duel' and g.context_id = p_ctx_id and g.user_id is not null group by g.user_id) x),
      current_round  = case when done then rno else rno + 1 end,
      status         = case when done then 'finished' else 'live' end,
      finished_at    = case when done then now() else null end,
      round_deadline = case when done or is_async then null else now() + interval '35 seconds' end
    where id = p_ctx_id::uuid;

    if done then
      perform private.notify('duel_finished', jsonb_build_object('duel_id', p_ctx_id));
    end if;
    return true;
  end if;
  return false;
end $$;

-- room: close if everyone "present" (seen < 60 s) has answered the current round
create or replace function private.maybe_close_room_if_all_answered(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare rno smallint; answered int; expected int;
begin
  select current_round into rno from rooms where code = p_code and status = 'live';
  if rno is null then return; end if;
  select count(*) into answered from guesses where mode = 'room' and context_id = p_code and round_no = rno;
  -- only players seen in the last 60 s count as "expected"; idle ones are covered by the deadline
  select count(*) into expected from room_players where room_code = p_code and last_seen > now() - interval '60 seconds';
  if answered >= greatest(expected, 1) then perform private.close_round('room', p_code); end if;
end $$;

-- duel: close while both players have answered the current round. In async
-- duels the late player's final guess closes rounds 1..n in one go.
create or replace function private.maybe_close_duel_rounds(p_duel text) returns void
language plpgsql security definer set search_path = public as $$
declare rno smallint; st text; answered int; guard int := 0;
begin
  loop
    select current_round, status into rno, st from duels where id = p_duel::uuid;
    exit when st is distinct from 'live';
    select count(*) into answered from guesses where mode = 'duel' and context_id = p_duel and round_no = rno;
    exit when answered < 2;
    exit when not private.close_round('duel', p_duel);
    guard := guard + 1;
    exit when guard > 20;
  end loop;
end $$;

create or replace function private.on_guess_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mode = 'room' then
    perform private.maybe_close_room_if_all_answered(new.context_id);
  elsif new.mode = 'duel' then
    perform private.maybe_close_duel_rounds(new.context_id);
  end if;
  return null;
end $$;

drop trigger if exists guesses_advance_round on public.guesses;
create trigger guesses_advance_round after insert on public.guesses
  for each row when (new.mode in ('room', 'duel'))
  execute function private.on_guess_inserted();

-- "advance on next write": called at the top of submit_guess / *_tokens / poke
create or replace function private.maybe_close_expired(p_ctx text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ctx = 'room' and exists (select 1 from rooms where code = p_id and status = 'live'
                                and round_deadline + interval '3 seconds' < now())
  then perform private.close_round('room', p_id); end if;
  if p_ctx = 'duel' and p_id ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from duels where id = p_id::uuid and status = 'live' and not async
                 and round_deadline + interval '3 seconds' < now())
  then perform private.close_round('duel', p_id); end if;
end $$;

-- client calls this when its local countdown hits 0 (+ jitter)
create or replace function public.poke(p_ctx text, p_ctx_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id text := p_ctx_id;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_ctx = 'duel' then
    if not exists (select 1 from duels where id::text = v_id and auth.uid() in (challenger, opponent)) then
      raise exception 'not_participant';
    end if;
  elsif p_ctx = 'room' then
    v_id := upper(v_id);
    if not in_room(v_id) then raise exception 'not_participant'; end if;
  else
    raise exception 'bad_ctx';
  end if;
  perform private.maybe_close_expired(p_ctx, v_id);
end $$;

-- backstop sweep (pg_cron every 10 s, or the `sweep` Edge Function)
create or replace function private.sweep_deadlines() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0; r record;
begin
  for r in select code from rooms where status = 'live' and round_deadline < now() - interval '3 seconds' loop
    perform private.close_round('room', r.code); n := n + 1;
  end loop;
  for r in select id from duels where status = 'live' and not async and round_deadline < now() - interval '3 seconds' loop
    perform private.close_round('duel', r.id::text); n := n + 1;
  end loop;

  -- invites: 24 h -> async (push 'duel_async' to challenger), 7 d -> expired (push 'duel_expired')
  for r in
    with upd as (
      update duels set async = true
      where status = 'invited' and not async and created_at < now() - interval '24 hours'
      returning id, challenger)
    select * from upd
  loop
    perform private.notify('duel_async', jsonb_build_object('duel_id', r.id, 'to', r.challenger));
  end loop;

  for r in
    with upd as (
      update duels set status = 'expired', finished_at = now()
      where status = 'invited' and created_at < now() - interval '7 days'
      returning id, challenger)
    select * from upd
  loop
    perform private.notify('duel_expired', jsonb_build_object('duel_id', r.id, 'to', r.challenger));
  end loop;

  -- lobbies nobody started within 24 h
  update rooms set status = 'finished', finished_at = now()
  where status = 'lobby' and created_at < now() - interval '24 hours';
  return n;
end $$;

-- service-role entry point for the `sweep` Edge Function (private schema is not exposed via PostgREST)
create or replace function public.run_sweep() returns int
language sql security definer set search_path = public as $$ select private.sweep_deadlines() $$;
revoke all on function public.run_sweep() from public;
