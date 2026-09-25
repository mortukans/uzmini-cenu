-- 13 room RPCs: create_room, join_room, start_room, room_tokens + host handover trigger

create or replace function public.create_room(p_category text default 'all', p_rounds smallint default 5)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_code  text;
  tries   int := 0;
  ids     bigint[];
  snap    jsonb;
begin
  perform private.require_username();
  if p_category not in ('all','flats','houses','cars','random','land') then raise exception 'bad_category'; end if;
  if p_rounds is null or p_rounds not in (5, 10) then raise exception 'bad_rounds'; end if;
  perform private.check_rate('room_create', 20);   -- 20 rooms / day for everyone

  loop
    -- consonants only, 4 letters, ~160k combinations, no accidental words
    select string_agg(substr('BCDFGHJKLMNPQRSTVWXZ', 1 + floor(random() * 20)::int, 1), '')
      into v_code from generate_series(1, 4);
    exit when not exists (select 1 from rooms r where r.code = v_code and r.status <> 'finished');
    tries := tries + 1;
    if tries > 10 then raise exception 'code_collision'; end if;
  end loop;
  -- a finished room may still own the code: recycle it (and its snapshot prices)
  delete from rooms where code = v_code and status = 'finished';
  delete from context_prices where context_type = 'room' and context_id = v_code;

  select array_agg(pl.id), jsonb_agg(private.strip(pl.*)) into ids, snap
  from private.pick_listings(p_category, null, p_rounds) pl;
  if coalesce(array_length(ids, 1), 0) < p_rounds then raise exception 'not_enough_listings'; end if;

  insert into rooms (code, host, category, rounds, listing_ids, snapshot)
  values (v_code, auth.uid(), p_category, p_rounds, ids, snap);
  insert into context_prices (context_type, context_id, listing_id, price_eur)
  select 'room', v_code, id, price_eur from listings where id = any(ids);
  insert into room_players (room_code, user_id) values (v_code, auth.uid());

  return jsonb_build_object('code', v_code, 'link', 'https://uzminicenu.lv/r/' || v_code);
end $$;

create or replace function public.join_room(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r rooms; n int;
begin
  perform private.require_username();
  perform private.check_rate_hourly('room_join', 30);
  select * into r from rooms where code = upper(trim(p_code));
  if r.code is null then raise exception 'room_not_found'; end if;
  if in_room(r.code) then
    return jsonb_build_object('code', r.code, 'host', r.host, 'rounds', r.rounds, 'category', r.category);
  end if;
  if r.status <> 'lobby' then raise exception 'room_already_started'; end if;
  select count(*) into n from room_players where room_code = r.code;
  if n >= 10 then raise exception 'room_full'; end if;
  insert into room_players (room_code, user_id) values (r.code, auth.uid()) on conflict do nothing;
  return jsonb_build_object('code', r.code, 'host', r.host, 'rounds', r.rounds, 'category', r.category);
end $$;

create or replace function public.start_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update rooms set status = 'live', current_round = 1, started_at = now(),
                   round_deadline = now() + interval '30 seconds'
  where code = upper(p_code) and host = auth.uid() and status = 'lobby';
  if not found then raise exception 'not_host_or_not_lobby'; end if;
end $$;

create or replace function public.room_tokens(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r      rooms;
  result jsonb := '[]'::jsonb;
  i      int;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  perform private.maybe_close_expired('room', upper(p_code));
  select * into r from rooms where code = upper(p_code);
  if r.code is null or not in_room(r.code) then raise exception 'not_participant'; end if;
  if r.status = 'finished' then raise exception 'round_closed'; end if;
  for i in 1..array_length(r.listing_ids, 1) loop
    result := result || jsonb_build_object('round_no', i, 'listing_id', r.listing_ids[i],
      'token', private.issue_round_token(r.listing_ids[i], 'room', r.code, i::smallint, interval '30 minutes'));
  end loop;
  return result;
end $$;

-- ─── host handover ───────────────────────────────────────────────────────────
-- Fires on room_players heartbeat (last_seen update) and on leave (delete).
-- If the host has not been seen for 60 s (or left), the oldest player seen in
-- the last 60 s becomes host. The old host rejoining is a normal player.

create or replace function private.handover_host_if_idle(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur_host uuid;
  st       text;
  new_host uuid;
begin
  select host, status into cur_host, st from rooms where code = p_code;
  if st is null or st = 'finished' then return; end if;
  if cur_host is not null and exists (
       select 1 from room_players rp where rp.room_code = p_code and rp.user_id = cur_host
         and rp.last_seen > now() - interval '60 seconds')
  then return; end if;

  select user_id into new_host from room_players
  where room_code = p_code and last_seen > now() - interval '60 seconds' and user_id is distinct from cur_host
  order by joined_at, user_id limit 1;
  if new_host is not null then
    update rooms set host = new_host where code = p_code;
  end if;
end $$;

create or replace function private.on_room_player_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.handover_host_if_idle(coalesce(new.room_code, old.room_code));
  -- a leaver mid-round may have been the last one everyone was waiting for (defined in 14)
  if tg_op = 'DELETE' then perform private.maybe_close_room_if_all_answered(old.room_code); end if;
  return null;
end $$;

drop trigger if exists room_players_handover on public.room_players;
create trigger room_players_handover
  after update of last_seen or delete on public.room_players
  for each row execute function private.on_room_player_changed();
