-- 12 duel RPCs: invite_duel, accept_duel, decline_duel, duel_tokens

-- picks 5 listings, snapshots (price-free), writes prices to context_prices, pushes the invite
create or replace function public.invite_duel(p_opponent uuid, p_category text default 'all')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d       duels;
  ids     bigint[];
  snap    jsonb;
  open_n  int;
begin
  perform private.require_username();
  if p_opponent is null or p_opponent = auth.uid() then raise exception 'self_duel'; end if;
  if not is_friend(p_opponent) then raise exception 'not_friends'; end if;
  if p_category not in ('all','flats','houses','cars','random','land') then raise exception 'bad_category'; end if;

  -- free app, no premium tier: 20 invites / day for everyone
  perform private.check_rate('duel_invite', 20);

  if exists (select 1 from duels where status in ('invited','live')
             and ((challenger = auth.uid() and opponent = p_opponent) or (challenger = p_opponent and opponent = auth.uid())))
  then raise exception 'duel_already_open'; end if;

  select count(*) into open_n from duels where status in ('invited','live') and auth.uid() in (challenger, opponent);
  if open_n >= 20 then raise exception 'too_many_open_duels'; end if;

  select array_agg(pl.id), jsonb_agg(private.strip(pl.*)) into ids, snap
  from private.pick_listings(p_category, null, 5) pl;
  if coalesce(array_length(ids, 1), 0) < 5 then raise exception 'not_enough_listings'; end if;

  insert into duels (challenger, opponent, listing_ids, snapshot, status)
  values (auth.uid(), p_opponent, ids, snap, 'invited') returning * into d;

  insert into context_prices (context_type, context_id, listing_id, price_eur)
  select 'duel', d.id::text, id, price_eur from listings where id = any(ids);

  perform private.notify('duel_invite', jsonb_build_object('duel_id', d.id, 'from', auth.uid(), 'to', p_opponent));
  return jsonb_build_object('duel_id', d.id);
end $$;

-- tokens for every round (called on accept, on each round change, on reconnect).
-- Solo-style TTL: 10 min while live and synced, 7 days for async / not yet accepted.
create or replace function public.duel_tokens(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d      duels;
  result jsonb := '[]'::jsonb;
  i      int;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  perform private.maybe_close_expired('duel', p_duel::text);
  select * into d from duels where id = p_duel and auth.uid() in (challenger, opponent);
  if d.id is null then raise exception 'not_participant'; end if;
  if d.status in ('finished','expired','declined') then raise exception 'round_closed'; end if;
  for i in 1..array_length(d.listing_ids, 1) loop
    result := result || jsonb_build_object('round_no', i, 'listing_id', d.listing_ids[i],
      'token', private.issue_round_token(d.listing_ids[i], 'duel', d.id::text, i::smallint,
        case when d.status = 'live' and not d.async then interval '10 minutes' else interval '7 days' end));
  end loop;
  return result;
end $$;

-- opponent taps accept: live + first deadline (none when async), returns round tokens
create or replace function public.accept_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d duels;
begin
  perform private.require_username();
  update duels set status = 'live', accepted_at = now(), current_round = 1,
                   round_deadline = case when async then null else now() + interval '30 seconds' end
  where id = p_duel and opponent = auth.uid() and status = 'invited' returning * into d;
  if d.id is null then raise exception 'duel_not_invited'; end if;
  perform private.notify('duel_accepted', jsonb_build_object('duel_id', d.id, 'from', auth.uid(), 'to', d.challenger));
  return public.duel_tokens(p_duel);
end $$;

-- plain status update behind RLS, wrapped for the push (declined duels do not refund the quota)
create or replace function public.decline_duel(p_duel uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare d duels;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update duels set status = 'declined', finished_at = now()
  where id = p_duel and opponent = auth.uid() and status = 'invited' returning * into d;
  if d.id is null then raise exception 'duel_not_invited'; end if;
  perform private.notify('duel_declined', jsonb_build_object('duel_id', d.id, 'from', auth.uid(), 'to', d.challenger));
end $$;
