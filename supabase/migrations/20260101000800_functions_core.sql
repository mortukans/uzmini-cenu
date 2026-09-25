-- 09 core functions: scoring, tokens, listing pick/strip, rate limit, notify, RLS helpers

-- ─── RLS / auth helpers ───────────────────────────────────────────────────────

create or replace function public.is_anon() returns boolean
language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- Social RPCs (friends, duels, rooms, daily board) need a chosen username, not the
-- trigger's 'player_xxxxxx' placeholder. Raises username_required (or sign_in_required
-- when there is no session at all).
create or replace function private.require_username() returns void
language plpgsql stable security definer set search_path = public as $$
declare u text;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  select username into u from profiles where id = auth.uid();
  if public.is_auto_username(u) then raise exception 'username_required'; end if;
end $$;

-- security definer so the friendships policy can not recurse into itself
create or replace function public.is_friend(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.user_id = auth.uid() and f.friend_id = other)
        or (f.user_id = other and f.friend_id = auth.uid()))
  )
$$;

create or replace function public.in_room(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_players where room_code = p_code and user_id = auth.uid())
$$;

-- ─── scoring ─────────────────────────────────────────────────────────────────

-- score = round(1000 * exp(-k * |guess - price| / price)), k = 8 (docs/02)
create or replace function public.score(guess integer, price integer, k numeric default 8)
returns smallint
language sql immutable parallel safe as $$
  select case
    when price is null or price <= 0 or guess is null then 0::smallint
    else greatest(0, least(1000,
      round(1000 * exp(-k * abs(guess - price)::numeric / price))))::smallint
  end
$$;

-- 🟩 within 10%, 🟨 within 25%, 🟥 otherwise
create or replace function public.grid_cell(guess integer, price integer)
returns text language sql immutable parallel safe as $$
  select case
    when price is null or price <= 0 or guess is null then '🟥'
    when abs(guess - price)::numeric / price <= 0.10 then '🟩'
    when abs(guess - price)::numeric / price <= 0.25 then '🟨'
    else '🟥' end
$$;

-- ─── round tokens ────────────────────────────────────────────────────────────

-- HMAC key: Supabase Vault secret 'round_token_secret' in prod; dev fallback is the
-- GUC app.settings.token_secret (alter database postgres set app.settings.token_secret = '...').
create or replace function private.token_secret() returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  begin
    select ds.decrypted_secret into s
    from vault.decrypted_secrets ds where ds.name = 'round_token_secret' limit 1;
  exception when others then
    s := null;   -- vault missing (plain postgres) or not readable
  end;
  if s is null or s = '' then
    s := nullif(current_setting('app.settings.token_secret', true), '');
  end if;
  if s is null then
    raise exception 'token_secret_missing'
      using hint = 'select vault.create_secret(''...'', ''round_token_secret'') or alter database postgres set app.settings.token_secret';
  end if;
  return convert_to(s, 'utf8');
end $$;
revoke all on function private.token_secret() from public;

create or replace function private.b64url(data bytea) returns text
language sql immutable parallel safe as $$
  select translate(replace(rtrim(encode(data, 'base64'), '='), E'\n', ''), '+/', '-_')
$$;

create or replace function private.b64url_decode(s text) returns bytea
language sql immutable parallel safe as $$
  select decode(translate(s, '-_', '+/') || repeat('=', (4 - length(s) % 4) % 4), 'base64')
$$;

-- token = b64url(payload) || '.' || b64url(hmac_sha256(secret, b64url(payload)))
-- payload: {l: listing, u: uid, c: ctx, x: ctx_id, r: round_no, e: expiry epoch, n: nonce}
create or replace function private.issue_round_token(
  p_listing bigint, p_ctx text, p_ctx_id text, p_round smallint, p_ttl interval)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  payload text;
  sig     text;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  payload := private.b64url(convert_to(jsonb_build_object(
    'l', p_listing, 'u', auth.uid(), 'c', p_ctx, 'x', p_ctx_id, 'r', p_round,
    'e', extract(epoch from now() + p_ttl)::bigint,
    'n', encode(extensions.gen_random_bytes(3), 'hex')
  )::text, 'utf8'));
  sig := private.b64url(extensions.hmac(convert_to(payload, 'utf8'), private.token_secret(), 'sha256'));
  return payload || '.' || sig;
end $$;

create or replace function private.verify_round_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  parts    text[];
  payload  jsonb;
  expected text;
begin
  if p_token is null then raise exception 'bad_token'; end if;
  parts := string_to_array(p_token, '.');
  if coalesce(array_length(parts, 1), 0) <> 2 then raise exception 'bad_token'; end if;
  expected := private.b64url(extensions.hmac(convert_to(parts[1], 'utf8'), private.token_secret(), 'sha256'));
  if expected <> parts[2] then raise exception 'bad_token'; end if;
  begin
    payload := convert_from(private.b64url_decode(parts[1]), 'utf8')::jsonb;
  exception when others then
    raise exception 'bad_token';
  end;
  if (payload ->> 'u') is null or (payload ->> 'u')::uuid <> auth.uid() then raise exception 'bad_token'; end if;
  if (payload ->> 'e')::bigint < extract(epoch from now()) then raise exception 'token_expired'; end if;
  return payload;
end $$;

-- ─── listings helpers ────────────────────────────────────────────────────────

create or replace function private.pick_listings(p_category text, p_region text, p_n int,
                                                  p_exclude bigint[] default '{}')
returns setof public.listings language sql stable security definer set search_path = public as $$
  -- random() over the fresh index range is fine at 50k rows
  select * from listings l
  where l.status = 'active'
    and l.checked_at > now() - interval '72 hours'
    and (p_category is null or p_category = 'all' or l.category = p_category)
    and (p_region is null or p_region = 'latvia' or l.region = p_region)
    and not (l.id = any(coalesce(p_exclude, '{}')))
    and l.quality >= 0
  order by random()
  limit p_n
$$;

-- a listing without its price (the only shape that ever leaves the server pre-guess)
create or replace function private.strip(l public.listings) returns jsonb
language sql immutable parallel safe as $$
  select jsonb_build_object(
    'id', l.id, 'category', l.category, 'region', l.region, 'location', l.location,
    'attributes', l.attributes - '_raw' - 'trim_hint' - 'dup_of' - 'also_at',
    'title_hint', l.title_hint, 'photo_urls', l.photo_urls,
    'source', l.source, 'source_url', l.source_url)
$$;

-- ─── rate limiting ───────────────────────────────────────────────────────────

create or replace function private.check_rate(p_action text, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  insert into rate_limits (user_id, action, count) values (auth.uid(), p_action, 1)
  on conflict (user_id, action, "window") do update set count = rate_limits.count + 1
  returning count into c;
  if c > p_limit then raise exception 'rate_limited' using hint = p_action; end if;
end $$;

-- hourly variant: folds the Riga hour into the action key, same table
create or replace function private.check_rate_hourly(p_action text, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform private.check_rate(p_action || '@' || to_char(now() at time zone 'Europe/Riga', 'HH24'), p_limit);
end $$;

-- ─── notify (pg_net -> send-push Edge Function) ──────────────────────────────

-- Fire-and-forget. Never fails the calling transaction: missing pg_net or
-- missing settings only raise a NOTICE.
-- Settings: alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
--           alter database postgres set app.settings.service_key   = '<service role key>';
--           (or vault secret 'service_key')
create or replace function private.service_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  begin
    select ds.decrypted_secret into s from vault.decrypted_secrets ds where ds.name = 'service_key' limit 1;
  exception when others then
    s := null;
  end;
  return coalesce(s, nullif(current_setting('app.settings.service_key', true), ''));
end $$;
revoke all on function private.service_key() from public;

create or replace function private.notify(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := nullif(current_setting('app.settings.functions_url', true), '');
  key  text := private.service_key();
begin
  if base is null or key is null then
    raise notice 'notify(%) skipped: app.settings.functions_url / service_key not set', p_event;
    return;
  end if;
  perform net.http_post(
    url     := base || '/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('event', p_event, 'payload', p_payload));
exception when others then
  raise notice 'notify(%) failed: %', p_event, sqlerrm;
end $$;

revoke all on all functions in schema private from public;
