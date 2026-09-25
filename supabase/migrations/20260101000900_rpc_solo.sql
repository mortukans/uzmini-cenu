-- 10 solo / streak RPCs: get_rounds, submit_guess, get_offline_pack
-- Contract: src/api/rpc.ts

-- random active listings, price stripped, each with a signed 30 min round token
create or replace function public.get_rounds(p_category text default 'all',
                                             p_region text default null,
                                             p_n int default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  result jsonb := '[]'::jsonb;
  l      listings;
  seen   bigint[];
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception 'bad_n'; end if;
  if p_category not in ('all','flats','houses','cars','random','land') then raise exception 'bad_category'; end if;
  if p_region is not null and p_region not in ('riga','riga_region','latvia') then raise exception 'bad_region'; end if;
  perform private.check_rate_hourly('get_rounds', 60);

  -- avoid repeating listings the player saw in the last 7 days
  select coalesce(array_agg(distinct listing_id), '{}') into seen
  from guesses where user_id = auth.uid() and created_at > now() - interval '7 days';

  for l in select * from private.pick_listings(p_category, p_region, p_n, seen) loop
    result := result || (private.strip(l) || jsonb_build_object(
      'token', private.issue_round_token(l.id, 'solo', null, null, interval '30 minutes')));
  end loop;
  -- pool exhausted by the 7-day filter? fall back to repeats rather than an empty screen
  if jsonb_array_length(result) < p_n then
    for l in select * from private.pick_listings(p_category, p_region, p_n - jsonb_array_length(result),
               (select coalesce(array_agg((e ->> 'id')::bigint), '{}') from jsonb_array_elements(result) e)) loop
      result := result || (private.strip(l) || jsonb_build_object(
        'token', private.issue_round_token(l.id, 'solo', null, null, interval '30 minutes')));
    end loop;
  end if;
  return result;
end $$;

-- validates token, scores, inserts guess, returns price + score
create or replace function public.submit_guess(p_token text, p_guess integer, p_time_ms integer default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  t        jsonb;
  ctx      text;
  ctx_id   text;
  lid      bigint;
  rno      smallint;
  price    integer;
  s        smallint;
  deadline timestamptz;
  nonce    text;
  src_url  text;
begin
  if p_guess is null or p_guess < 1 or p_guess > 100000000 then raise exception 'bad_guess'; end if;
  t      := private.verify_round_token(p_token);
  ctx    := t ->> 'c';
  ctx_id := t ->> 'x';
  lid    := (t ->> 'l')::bigint;
  rno    := (t ->> 'r')::smallint;
  if ctx not in ('solo','streak','daily','duel','room') then raise exception 'bad_token'; end if;

  -- price source: snapshot side table for contexts, live table for solo/streak
  if ctx in ('duel', 'room', 'daily') then
    select price_eur into price from context_prices
    where context_type = ctx and context_id = ctx_id and listing_id = lid;
  else
    select price_eur into price from listings where id = lid;
  end if;
  if price is null then raise exception 'listing_gone'; end if;

  -- close an overdue round first ("advance on next write", docs/06)
  if ctx in ('duel', 'room') then perform private.maybe_close_expired(ctx, ctx_id); end if;

  -- deadline check for synced modes (+3 s grace); async duels have no deadline
  if ctx = 'duel' then
    select case when d.async then 'infinity'::timestamptz else d.round_deadline end into deadline
      from duels d
      where d.id = ctx_id::uuid
        and ((d.status = 'live' and (d.async or d.current_round = rno))
          or (d.status = 'invited' and d.async and d.challenger = auth.uid()));
    if deadline is null then raise exception 'round_closed'; end if;
    if now() > deadline + interval '3 seconds' then raise exception 'too_late'; end if;
  elsif ctx = 'room' then
    select round_deadline into deadline from rooms where code = ctx_id and status = 'live' and current_round = rno;
    if deadline is null then raise exception 'round_closed'; end if;
    if now() > deadline + interval '3 seconds' then raise exception 'too_late'; end if;
  elsif ctx = 'daily' then
    if ctx_id <> (now() at time zone 'Europe/Riga')::date::text then raise exception 'token_expired'; end if;
  end if;

  s := public.score(p_guess, price);
  -- solo/streak: nonce makes each issued token single-use;
  -- contexts: nonce dropped so one answer per (user, context, listing) regardless of re-issued tokens
  nonce := case when ctx in ('solo','streak') then t ->> 'n' else null end;

  begin
    insert into guesses (user_id, listing_id, mode, context_id, round_no, guess_eur, score, token_nonce, time_ms, suspicious)
    values (auth.uid(), lid, ctx, ctx_id, rno, p_guess, s, nonce, p_time_ms,
            coalesce(p_time_ms, 100000) < 400 and abs(p_guess - price)::numeric / price <= 0.02);
  exception when unique_violation then
    raise exception 'already_answered';
  end;
  -- AFTER INSERT trigger (14) advances duel/room rounds when everyone has answered

  select l.source_url into src_url from listings l where l.id = lid;
  return jsonb_build_object('price_eur', price, 'score', s, 'guess_eur', p_guess,
                            'source_url', coalesce(src_url, ''));
end $$;

-- Offline pack: rounds WITH prices, never scored server-side, rate limited
-- (3/h). Token is empty: these can not be submitted.
create or replace function public.get_offline_pack(p_category text default 'all', p_n int default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  result jsonb := '[]'::jsonb;
  l      listings;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception 'bad_n'; end if;
  if p_category not in ('all','flats','houses','cars','random','land') then raise exception 'bad_category'; end if;
  perform private.check_rate_hourly('offline_pack', 3);

  for l in select * from private.pick_listings(p_category, null, p_n) loop
    result := result || (private.strip(l) || jsonb_build_object('token', '', 'price_eur', l.price_eur));
  end loop;
  return result;
end $$;
