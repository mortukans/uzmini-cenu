# 05 Data model (Postgres / Supabase)

```sql
-- listings scraped from portals
create table listings (
  id            bigserial primary key,
  source        text not null,           -- 'ss' | 'city24' | ...
  source_url    text not null unique,
  category      text not null,           -- 'flats' | 'houses' | 'cars' | 'random' | 'land'
  price_eur     integer not null,
  region        text,                    -- 'riga' | 'riga_region' | 'latvia'
  location      text,                    -- district or town, sanitised
  attributes    jsonb not null default '{}',  -- rooms, m2, year, km ...
  title_hint    text,                    -- scrubbed title, optional hint
  photo_urls    text[] not null,
  photo_hash    text,                    -- phash of first photo, dedupe
  status        text not null default 'active', -- active | expired | rejected
  quality       smallint default 0,      -- manual curation score
  first_seen_at timestamptz default now(),
  checked_at    timestamptz default now()
);
create index on listings (category, status, checked_at);

-- users (profile on top of auth.users)
create table profiles (
  id           uuid primary key references auth.users,
  username     text unique,
  avatar       text,
  lang         text default 'lv',
  push_token   text,
  is_premium   boolean default false,
  created_at   timestamptz default now()
);

create table friendships (
  user_id    uuid references profiles,
  friend_id  uuid references profiles,
  status     text default 'pending',     -- pending | accepted
  primary key (user_id, friend_id)
);

-- every scored guess, all modes
create table guesses (
  id          bigserial primary key,
  user_id     uuid references profiles,   -- null for anonymous solo
  listing_id  bigint references listings,
  mode        text not null,              -- solo | streak | daily | duel | room
  context_id  uuid,                       -- daily_set / duel / room id
  round_no    smallint,
  guess_eur   integer not null,
  score       smallint not null,
  created_at  timestamptz default now()
);

create table daily_sets (
  day          date primary key,
  listing_ids  bigint[] not null,
  snapshot     jsonb not null              -- frozen attributes + photos + prices
);

create table daily_results (
  day       date references daily_sets,
  user_id   uuid references profiles,
  total     smallint not null,
  grid      text not null,                 -- '🟩🟩🟨🟥🟩'
  submitted_at timestamptz default now(),  -- leaderboard tie-break (02, earlier wins)
  primary key (day, user_id)
);

create table duels (
  id           uuid primary key default gen_random_uuid(),
  challenger   uuid references profiles,
  opponent     uuid references profiles,
  listing_ids  bigint[] not null,
  snapshot     jsonb not null,             -- frozen listings incl. prices
  status       text default 'invited',     -- invited | live | finished | expired
  scores       jsonb default '{}',         -- {user_id: {round_no: score}}
  created_at   timestamptz default now()
);

create table rooms (
  code          text primary key,          -- 4 letters
  host          uuid references profiles,
  category      text,
  rounds        smallint default 5,
  listing_ids   bigint[],
  snapshot      jsonb,
  status        text default 'lobby',      -- lobby | live | finished
  current_round smallint default 0,
  round_deadline timestamptz,
  created_at    timestamptz default now()
);

create table room_players (
  room_code  text references rooms,
  user_id    uuid references profiles,
  total      smallint default 0,
  primary key (room_code, user_id)
);
```

## Additions to the base schema

Operational scraper tables (`scrape_runs`) are defined in
[03-data-pipeline](03-data-pipeline.md#monitoring-and-alerting) and land in
migration 19, `20260101001800_scrape_runs.sql` (appended to the naming plan below).

Small changes that the RPCs below need. They live in their own migrations
(see naming plan) so the base schema above stays readable.

```sql
-- context ids are not always uuids (daily = date, room = code); store as text
alter table guesses alter column context_id type text using context_id::text;
alter table guesses add column token_nonce text;        -- solo/streak single-use key
alter table guesses add column time_ms integer;          -- time to guess, analytics

-- duels need per-round sync state like rooms
alter table duels
  add column current_round  smallint default 1,
  add column round_deadline timestamptz,
  add column accepted_at    timestamptz,
  add column finished_at    timestamptz,
  add column async          boolean default false, -- set by the 24 h sweep; disables deadlines
  add column results        jsonb default '{}';   -- {round_no: {user_id: {guess, score}}}, written only when round closes
alter table duels alter column status set default 'invited';   -- invited | live | finished | expired | declined
alter table duels drop constraint duels_challenger_fkey, drop constraint duels_opponent_fkey,
  add foreign key (challenger) references profiles on delete set null,
  add foreign key (opponent)   references profiles on delete set null;
-- 'scores' stays as the running total cache: {user_id: total}

-- rooms: results revealed per round, same shape
alter table rooms
  add column results     jsonb default '{}',
  add column started_at  timestamptz,
  add column finished_at timestamptz;
alter table room_players
  add column joined_at   timestamptz default now(),
  add column last_seen   timestamptz default now();

-- multiple devices per user
create table push_tokens (
  user_id    uuid references profiles on delete cascade,
  token      text primary key,               -- ExponentPushToken[...]
  platform   text not null default 'ios',
  updated_at timestamptz default now()
);
alter table profiles drop column push_token;

create table push_tickets (
  ticket_id  text primary key,
  token      text not null,
  sent_at    timestamptz default now(),
  checked    boolean default false
);

-- sliding-window rate limiting inside RPCs
create table rate_limits (
  user_id   uuid not null,
  action    text not null,                   -- 'duel_invite' | 'room_create' | 'offline_pack' | ...
  window    date not null default (now() at time zone 'Europe/Riga')::date,
  count     integer not null default 0,
  primary key (user_id, action, window)
);

-- category labels in 3 languages, editable without app release
create table categories (
  key     text primary key,
  labels  jsonb not null,                   -- {"lv": "Dzīvokļi", "ru": "Квартиры", "en": "Flats"}
  min_eur integer, max_eur integer,
  steps   integer[] not null               -- quick +/- steps, e.g. {1000,10000}
);

-- profile row auto-created on sign-up (anonymous or Apple)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username)
  values (new.id, 'player_' || left(replace(new.id::text, '-', ''), 6));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

## Indexes

```sql
-- round selection: random active fresh listing per category/region
create index listings_pick_idx on listings (category, region, status, checked_at desc)
  where status = 'active';
create index listings_photo_hash_idx on listings (photo_hash) where photo_hash is not null;

-- single-use tokens + "did I already answer" lookups
create unique index guesses_once_idx
  on guesses (user_id, mode, context_id, listing_id, token_nonce) nulls not distinct;
create index guesses_context_idx on guesses (mode, context_id, round_no);
create index guesses_user_time_idx on guesses (user_id, created_at desc);
create index guesses_listing_idx on guesses (listing_id);          -- for retention deletes

-- leaderboards
create index daily_results_day_total_idx on daily_results (day, total desc);
create index daily_results_user_idx on daily_results (user_id, day desc);

-- duels: "my duels" lists + expiry sweeps
create index duels_challenger_idx on duels (challenger, created_at desc);
create index duels_opponent_idx  on duels (opponent, created_at desc);
create index duels_open_idx      on duels (status, round_deadline) where status in ('invited','live');

-- rooms
create index rooms_open_idx on rooms (status, round_deadline) where status = 'live';
create index room_players_user_idx on room_players (user_id);

create index friendships_friend_idx on friendships (friend_id, status);
create index push_tokens_user_idx on push_tokens (user_id);
create index push_tickets_unchecked_idx on push_tickets (sent_at) where not checked;
```

## RLS summary

- `listings`: no direct select from clients. Everything goes through
  `security definer` RPCs that strip `price_eur`.
- `profiles`: users read all (username, avatar), update own.
- `guesses`, `daily_results`: insert via RPC only, read own + friends.
- `duels`, `rooms`, `room_players`: read/write only if participant.
- Realtime is enabled on `duels`, `rooms`, `room_players`.

## RLS policies (full SQL)

Helpers first. `is_friend` is `security definer` so the friendships policy
can not recurse into itself.

```sql
create or replace function public.is_anon() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

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
```

```sql
alter table listings       enable row level security;
alter table profiles       enable row level security;
alter table friendships    enable row level security;
alter table guesses        enable row level security;
alter table daily_sets     enable row level security;
alter table daily_results  enable row level security;
alter table duels          enable row level security;
alter table rooms          enable row level security;
alter table room_players   enable row level security;
alter table push_tokens    enable row level security;
alter table push_tickets   enable row level security;
alter table rate_limits    enable row level security;
alter table categories     enable row level security;

-- listings: no policies at all => no client access. RPCs are security definer.

-- categories: public read
create policy categories_read on categories for select to authenticated using (true);

-- profiles
create policy profiles_read   on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_premium = (select is_premium from profiles where id = auth.uid()));
-- is_premium is only changed by the RevenueCat webhook (service role). Column-level:
revoke update on profiles from authenticated;
grant  update (username, avatar, lang) on profiles to authenticated;

-- friendships: see rows you are part of; create requests; accept requests sent to you; delete either side
create policy friendships_read on friendships for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());
create policy friendships_insert on friendships for insert to authenticated
  with check (user_id = auth.uid() and friend_id <> auth.uid() and status = 'pending' and not is_anon());
create policy friendships_accept on friendships for update to authenticated
  using (friend_id = auth.uid() and status = 'pending')
  with check (status = 'accepted');
create policy friendships_delete on friendships for delete to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- guesses: read own + friends' (for duel reveal / stats); writes only via RPC
create policy guesses_read on guesses for select to authenticated
  using (user_id = auth.uid() or is_friend(user_id));
-- no insert/update/delete policies: submit_guess is security definer

-- daily_sets: readable, but prices live in snapshot -> expose through a view instead
revoke select on daily_sets from authenticated;
create view daily_sets_public with (security_invoker = false) as
  select day, listing_ids,
         (select jsonb_agg(item - 'price_eur' - 'source_url') from jsonb_array_elements(snapshot) item) as snapshot
  from daily_sets
  where day <= (now() at time zone 'Europe/Riga')::date;
grant select on daily_sets_public to authenticated;

-- daily_results: own + friends, and top-N via leaderboard() RPC
create policy daily_results_read on daily_results for select to authenticated
  using (user_id = auth.uid() or is_friend(user_id));

-- duels: participants only; state changes via RPC, except accept/decline which are simple updates
create policy duels_read on duels for select to authenticated
  using (challenger = auth.uid() or opponent = auth.uid());
create policy duels_opponent_respond on duels for update to authenticated
  using (opponent = auth.uid() and status = 'invited')
  with check (status in ('live', 'declined'));
-- price leak guard: snapshot is exposed via view without prices; raw table select revoked
revoke select on duels from authenticated;
create view duels_public with (security_invoker = true) as
  select id, challenger, opponent, listing_ids, status, scores, results,
         current_round, round_deadline, accepted_at, finished_at, created_at,
         (select jsonb_agg(item - 'price_eur') from jsonb_array_elements(snapshot) item) as snapshot
  from duels;
grant select on duels_public to authenticated;
grant update (status) on duels to authenticated;

-- rooms: any member reads; host controls status; joins via join_room RPC
revoke select on rooms from authenticated;
create policy rooms_read on rooms for select to authenticated using (in_room(code) or host = auth.uid());
create view rooms_public with (security_invoker = true) as
  select code, host, category, rounds, listing_ids, status, current_round, round_deadline,
         results, started_at, finished_at, created_at,
         (select jsonb_agg(item - 'price_eur') from jsonb_array_elements(snapshot) item) as snapshot
  from rooms;
grant select on rooms_public to authenticated;
create policy rooms_host_update on rooms for update to authenticated
  using (host = auth.uid()) with check (host = auth.uid());
grant update (status, category, rounds) on rooms to authenticated;   -- start_room RPC does the rest

create policy room_players_read on room_players for select to authenticated using (in_room(room_code));
create policy room_players_leave on room_players for delete to authenticated using (user_id = auth.uid());
create policy room_players_heartbeat on room_players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (last_seen) on room_players to authenticated;

-- push_tokens: own rows only
create policy push_tokens_own on push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- push_tickets, rate_limits: service/RPC only, no policies.
```

Realtime note: Postgres Changes respects RLS on the *table*, not the view,
so clients subscribing to `duels`/`rooms` receive the raw row including
`snapshot` with prices. Fix: keep prices **out of the Realtime row** by
storing them in a side table `context_prices (context_type, context_id,
listing_id, price_eur)` that has no policies and is never published. The
`snapshot` column on `duels`/`rooms` then only holds price-free data, the
views above become unnecessary, and the `duels_read` / `rooms_read`
policies do the work. **Decision: use `context_prices`.** The views are
kept in this doc as the fallback if we ever need prices in the snapshot.

```sql
create table context_prices (
  context_type text not null,           -- 'daily' | 'duel' | 'room'
  context_id   text not null,
  listing_id   bigint not null,
  price_eur    integer not null,
  primary key (context_type, context_id, listing_id)
);
alter table context_prices enable row level security;   -- no policies
```

## Scoring function

```sql
-- score = round(1000 * exp(-k * |guess - price| / price)), k = 8 (02-game-design)
create or replace function public.score(guess integer, price integer, k numeric default 8)
returns smallint
language sql immutable parallel safe as $$
  select case
    when price <= 0 or guess is null then 0
    else greatest(0, least(1000,
      round(1000 * exp(-k * abs(guess - price)::numeric / price))))::smallint
  end
$$;

-- 🟩 within 10%, 🟨 within 25%, 🟥 otherwise
create or replace function public.grid_cell(guess integer, price integer)
returns text language sql immutable as $$
  select case
    when abs(guess - price)::numeric / price <= 0.10 then '🟩'
    when abs(guess - price)::numeric / price <= 0.25 then '🟨'
    else '🟥' end
$$;
```

`k` is a parameter so the `k_factor` feature flag from 04 can be tested
by passing a different value from `submit_guess` without a migration.

## Round token functions

```sql
create extension if not exists pgcrypto with schema extensions;

create or replace function private.token_secret() returns bytea
language sql stable security definer set search_path = vault as $$
  select convert_to(decrypted_secret, 'utf8')
  from vault.decrypted_secrets where name = 'round_token_secret' limit 1
$$;
revoke all on function private.token_secret() from public;

create or replace function private.b64url(data bytea) returns text
language sql immutable as $$
  select translate(rtrim(encode(data, 'base64'), '='), '+/', '-_')
$$;
create or replace function private.b64url_decode(s text) returns bytea
language sql immutable as $$
  select decode(translate(s, '-_', '+/') || repeat('=', (4 - length(s) % 4) % 4), 'base64')
$$;

create or replace function private.issue_round_token(
  p_listing bigint, p_ctx text, p_ctx_id text, p_round smallint, p_ttl interval)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  payload text;
  sig     text;
begin
  payload := private.b64url(convert_to(jsonb_build_object(
    'l', p_listing, 'u', auth.uid(), 'c', p_ctx, 'x', p_ctx_id, 'r', p_round,
    'e', extract(epoch from now() + p_ttl)::bigint,
    'n', encode(gen_random_bytes(3), 'hex')
  )::text, 'utf8'));
  sig := private.b64url(hmac(convert_to(payload, 'utf8'), private.token_secret(), 'sha256'));
  return payload || '.' || sig;
end $$;

create or replace function private.verify_round_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  parts   text[];
  payload jsonb;
  expected text;
begin
  parts := string_to_array(p_token, '.');
  if array_length(parts, 1) <> 2 then raise exception 'token_malformed'; end if;
  expected := private.b64url(hmac(convert_to(parts[1], 'utf8'), private.token_secret(), 'sha256'));
  if expected <> parts[2] then raise exception 'token_invalid'; end if;
  payload := convert_from(private.b64url_decode(parts[1]), 'utf8')::jsonb;
  if (payload ->> 'u')::uuid <> auth.uid() then raise exception 'token_wrong_user'; end if;
  if (payload ->> 'e')::bigint < extract(epoch from now()) then raise exception 'token_expired'; end if;
  return payload;
end $$;
```

The `private` schema is not exposed through PostgREST (`api` schemas are
`public` only), so these helpers are unreachable from clients even though
they are `security definer`.

## RPCs

| Function | Purpose |
|----------|---------|
| `get_rounds(category, region, n)` | random active listings, price stripped, returns signed round tokens |
| `submit_guess(round_token, guess)` | validates token, scores, inserts guess, returns price + score |
| `get_daily()` | today's set without prices, plus whether user already played |
| `submit_daily(guesses[])` | scores 5, writes daily_results, returns grid |
| `invite_duel(opponent)` | picks 5 listings, snapshots, inserts duel, triggers push |
| `create_room(category, rounds)` / `join_room(code)` | |
| `leaderboard(scope, period)` | global / friends, day / week / all |

All are `security definer`, `set search_path = public, extensions`, and
`revoke execute on function ... from public; grant execute ... to authenticated;`
Postgres error messages are stable codes (`token_expired`, `rate_limited`)
that the app maps to i18n keys.

### Shared helpers

```sql
create or replace function private.pick_listings(p_category text, p_region text, p_n int,
                                                  p_exclude bigint[] default '{}')
returns setof listings language sql stable security definer set search_path = public as $$
  -- TABLESAMPLE is fast but uneven on small tables; random() over a fresh index range is fine at 50k rows
  select * from listings l
  where l.status = 'active'
    and l.checked_at > now() - interval '72 hours'
    and (p_category = 'all' or l.category = p_category)
    and (p_region is null or p_region = 'latvia' or l.region = p_region)
    and not (l.id = any(p_exclude))
    and l.quality >= 0
  order by random()
  limit p_n
$$;

create or replace function private.strip(l listings) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', l.id, 'category', l.category, 'region', l.region, 'location', l.location,
    'attributes', l.attributes, 'title_hint', l.title_hint, 'photo_urls', l.photo_urls,
    'source', l.source, 'source_url', l.source_url)
$$;

create or replace function private.check_rate(p_action text, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into rate_limits (user_id, action) values (auth.uid(), p_action)
  on conflict (user_id, action, window) do update set count = rate_limits.count + 1
  returning count into c;
  if c > p_limit then raise exception 'rate_limited' using hint = p_action; end if;
end $$;

create or replace function private.notify(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- fire-and-forget HTTP call to the send-push Edge Function via pg_net
  perform net.http_post(
    url := current_setting('app.settings.functions_url') || '/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || current_setting('app.settings.service_key')),
    body := jsonb_build_object('event', p_event, 'payload', p_payload));
end $$;
```

`app.settings.*` are set with `alter database postgres set app.settings.functions_url = '...'`
at deploy time (the service key lives in Vault in prod; `private.notify`
reads it the same way as `token_secret`).

### get_rounds

```sql
create or replace function public.get_rounds(p_category text default 'all',
                                             p_region text default null,
                                             p_n int default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  out jsonb := '[]';
  l   listings;
  seen bigint[];
begin
  if p_n < 1 or p_n > 20 then raise exception 'bad_n'; end if;
  -- avoid repeating listings the player saw in the last 7 days
  select coalesce(array_agg(distinct listing_id), '{}') into seen
  from guesses where user_id = auth.uid() and created_at > now() - interval '7 days';

  for l in select * from private.pick_listings(p_category, p_region, p_n, seen) loop
    out := out || (private.strip(l) || jsonb_build_object(
      'token', private.issue_round_token(l.id, 'solo', null, null, interval '30 minutes')));
  end loop;
  return out;
end $$;
```

### submit_guess

```sql
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
  listing  jsonb;
begin
  if p_guess is null or p_guess < 1 or p_guess > 100000000 then raise exception 'bad_guess'; end if;
  t      := private.verify_round_token(p_token);
  ctx    := t ->> 'c';
  ctx_id := t ->> 'x';
  lid    := (t ->> 'l')::bigint;
  rno    := (t ->> 'r')::smallint;

  -- price source: snapshot side table for contexts, live table for solo/streak
  if ctx in ('duel', 'room', 'daily') then
    select price_eur into price from context_prices
    where context_type = ctx and context_id = ctx_id and listing_id = lid;
  else
    select price_eur into price from listings where id = lid;
  end if;
  if price is null then raise exception 'listing_gone'; end if;

  -- close an overdue round first ("advance on next write", 06-multiplayer)
  if ctx in ('duel', 'room') then perform private.maybe_close_expired(ctx, ctx_id); end if;

  -- deadline check for synced modes (+3 s grace, 06-multiplayer); async duels have no deadline
  if ctx = 'duel' then
    select case when async then 'infinity'::timestamptz else round_deadline end into deadline
      from duels where id = ctx_id::uuid and status = 'live' and (async or current_round = rno);
    if deadline is null then raise exception 'round_closed'; end if;
    if now() > deadline + interval '3 seconds' then raise exception 'too_late'; end if;
  elsif ctx = 'room' then
    select round_deadline into deadline from rooms where code = ctx_id and status = 'live' and current_round = rno;
    if deadline is null then raise exception 'round_closed'; end if;
    if now() > deadline + interval '3 seconds' then raise exception 'too_late'; end if;
  end if;

  s := public.score(p_guess, price);

  begin
    insert into guesses (user_id, listing_id, mode, context_id, round_no, guess_eur, score, token_nonce, time_ms)
    values (auth.uid(), lid, ctx, ctx_id, rno, p_guess, s, t ->> 'n', p_time_ms);
  exception when unique_violation then
    raise exception 'already_answered';
  end;
  -- the AFTER INSERT trigger (below) advances duel/room rounds when everyone has answered

  select private.strip(l) into listing from listings l where l.id = lid;
  return jsonb_build_object('price_eur', price, 'score', s, 'guess_eur', p_guess,
                            'source_url', listing ->> 'source_url');
end $$;
```

For duels and rooms the client already has the round's listing (from the
snapshot); the return value gives the price and own score. Opponents'
guesses arrive via Realtime when the round closes, never from this call.

### get_daily / submit_daily

```sql
create or replace function public.get_daily()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  today date := (now() at time zone 'Europe/Riga')::date;
  ds    daily_sets;
  played daily_results;
  items jsonb := '[]';
  item  jsonb;
  i     int := 0;
begin
  select * into ds from daily_sets where day = today;
  if ds is null then raise exception 'daily_not_ready'; end if;
  select * into played from daily_results where day = today and user_id = auth.uid();

  for item in select * from jsonb_array_elements(ds.snapshot) loop
    i := i + 1;
    items := items || (item || jsonb_build_object(
      'round_no', i,
      'token', private.issue_round_token((item ->> 'id')::bigint, 'daily', today::text, i::smallint,
                                         (today + 1)::timestamptz at time zone 'Europe/Riga' - now())));
  end loop;

  return jsonb_build_object(
    'day', today,
    'number', today - date '2026-01-01' + 1,            -- "Uzmini Cenu #37"
    'rounds', items,
    'already_played', played is not null,
    'result', case when played is null then null else to_jsonb(played) end);
end $$;
```

The daily snapshot in `daily_sets.snapshot` is price-free; prices for the
day are written by `build_daily` into `context_prices ('daily', day, ...)`.
Each of the 5 rounds is submitted through `submit_guess` (so a crash after
round 3 does not lose progress); `submit_daily` then closes the day:

```sql
create or replace function public.submit_daily()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  today date := (now() at time zone 'Europe/Riga')::date;
  tot   int;
  g     text;
  n     int;
begin
  if is_anon() then raise exception 'sign_in_required'; end if;
  select count(*), coalesce(sum(score), 0),
         string_agg(public.grid_cell(gs.guess_eur, cp.price_eur), '' order by gs.round_no)
    into n, tot, g
  from guesses gs
  join context_prices cp on cp.context_type = 'daily' and cp.context_id = today::text and cp.listing_id = gs.listing_id
  where gs.user_id = auth.uid() and gs.mode = 'daily' and gs.context_id = today::text;
  if n <> 5 then raise exception 'daily_incomplete' using hint = n::text; end if;

  insert into daily_results (day, user_id, total, grid) values (today, auth.uid(), tot, g)
  on conflict (day, user_id) do nothing;
  return jsonb_build_object('total', tot, 'grid', g,
    'share_text', format('Uzmini Cenu #%s  %s / 5,000%s%s', today - date '2026-01-01' + 1, to_char(tot, 'FM9,999'), chr(10), g));
end $$;
```

Anonymous users can play the daily (tokens issue for them) but the result
is only recorded on leaderboards after sign-in; the client stores the
guesses locally and calls `submit_daily` once linked.

### invite_duel

```sql
create or replace function public.invite_duel(p_opponent uuid, p_category text default 'all')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d    duels;
  ids  bigint[];
  snap jsonb;
  l    listings;
begin
  if is_anon() then raise exception 'sign_in_required'; end if;
  if p_opponent = auth.uid() then raise exception 'self_duel'; end if;
  if not is_friend(p_opponent) then raise exception 'not_friends'; end if;
  perform private.check_rate('duel_invite',
    case when (select is_premium from profiles where id = auth.uid()) then 100 else 3 end);
  if exists (select 1 from duels where status in ('invited','live')
             and ((challenger = auth.uid() and opponent = p_opponent) or (challenger = p_opponent and opponent = auth.uid())))
  then raise exception 'duel_already_open'; end if;

  select array_agg(id), jsonb_agg(private.strip(pl.*)) into ids, snap
  from private.pick_listings(p_category, null, 5) pl;
  if coalesce(array_length(ids, 1), 0) < 5 then raise exception 'not_enough_listings'; end if;

  insert into duels (challenger, opponent, listing_ids, snapshot, status)
  values (auth.uid(), p_opponent, ids, snap, 'invited') returning * into d;

  insert into context_prices (context_type, context_id, listing_id, price_eur)
  select 'duel', d.id::text, id, price_eur from listings where id = any(ids);

  perform private.notify('duel_invite', jsonb_build_object('duel_id', d.id, 'from', auth.uid(), 'to', p_opponent));
  return jsonb_build_object('duel_id', d.id);
end $$;

-- opponent taps accept: sets live + first deadline, issues round tokens for the caller
create or replace function public.accept_duel(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d duels;
begin
  update duels set status = 'live', accepted_at = now(), current_round = 1,
                   round_deadline = now() + interval '30 seconds'
  where id = p_duel and opponent = auth.uid() and status = 'invited' returning * into d;
  if d is null then raise exception 'duel_not_invited'; end if;
  perform private.notify('duel_accepted', jsonb_build_object('duel_id', d.id, 'to', d.challenger));
  return public.duel_tokens(p_duel);
end $$;

-- tokens for whichever round the duel is on (called on accept, on each round change, on reconnect)
create or replace function public.duel_tokens(p_duel uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d duels; out jsonb := '[]'; i int;
begin
  select * into d from duels where id = p_duel and auth.uid() in (challenger, opponent);
  if d is null then raise exception 'not_participant'; end if;
  for i in 1..array_length(d.listing_ids, 1) loop
    out := out || jsonb_build_object('round_no', i, 'listing_id', d.listing_ids[i],
      'token', private.issue_round_token(d.listing_ids[i], 'duel', d.id::text, i::smallint,
        case when d.status = 'live' then interval '10 minutes' else interval '7 days' end));
  end loop;
  return out;
end $$;
```

Async fallback (opponent accepts after 24 h, see 06): `accept_duel` still
works, but the deadline check in `submit_guess` is skipped when
`duels.accepted_at - created_at > 24 h` (add `or d.async` once an `async`
boolean is set by the expiry sweep).

### create_room / join_room

```sql
create or replace function public.create_room(p_category text default 'all', p_rounds smallint default 5)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  code text; tries int := 0; ids bigint[]; snap jsonb;
begin
  if is_anon() then raise exception 'sign_in_required'; end if;
  if p_rounds not in (5, 10) then raise exception 'bad_rounds'; end if;
  perform private.check_rate('room_create', 20);
  loop
    -- consonants only, 4 letters, ~160k combinations
    code := (select string_agg(substr('BCDFGHJKLMNPQRSTVWXZ', 1 + floor(random() * 20)::int, 1), '')
             from generate_series(1, 4));
    exit when not exists (select 1 from rooms where rooms.code = code and status <> 'finished');
    tries := tries + 1;
    if tries > 10 then raise exception 'code_collision'; end if;
  end loop;

  select array_agg(id), jsonb_agg(private.strip(pl.*)) into ids, snap
  from private.pick_listings(p_category, null, p_rounds) pl;

  insert into rooms (code, host, category, rounds, listing_ids, snapshot) values (code, auth.uid(), p_category, p_rounds, ids, snap);
  insert into context_prices select 'room', code, id, price_eur from listings where id = any(ids);
  insert into room_players (room_code, user_id) values (code, auth.uid());
  return jsonb_build_object('code', code, 'link', 'https://uzminicenu.lv/r/' || code);
end $$;

create or replace function public.join_room(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r rooms; n int;
begin
  if is_anon() then raise exception 'sign_in_required'; end if;
  select * into r from rooms where code = upper(p_code);
  if r is null then raise exception 'room_not_found'; end if;
  if r.status <> 'lobby' then raise exception 'room_already_started'; end if;
  select count(*) into n from room_players where room_code = r.code;
  if n >= 10 then raise exception 'room_full'; end if;
  insert into room_players (room_code, user_id) values (r.code, auth.uid()) on conflict do nothing;
  return jsonb_build_object('code', r.code, 'host', r.host, 'rounds', r.rounds, 'category', r.category);
end $$;

create or replace function public.start_room(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update rooms set status = 'live', current_round = 1, started_at = now(),
                   round_deadline = now() + interval '30 seconds'
  where code = p_code and host = auth.uid() and status = 'lobby';
  if not found then raise exception 'not_host_or_not_lobby'; end if;
end $$;

create or replace function public.room_tokens(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r rooms; out jsonb := '[]'; i int;
begin
  select * into r from rooms where code = p_code;
  if r is null or not in_room(p_code) then raise exception 'not_participant'; end if;
  for i in 1..array_length(r.listing_ids, 1) loop
    out := out || jsonb_build_object('round_no', i, 'listing_id', r.listing_ids[i],
      'token', private.issue_round_token(r.listing_ids[i], 'room', r.code, i::smallint, interval '30 minutes'));
  end loop;
  return out;
end $$;
```

### leaderboard

```sql
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
  people as (
    select id from profiles
    where p_scope = 'global'
       or id = auth.uid()
       or is_friend(id)
  ),
  agg as (
    select dr.user_id, sum(dr.total) as total
    from daily_results dr, range
    where dr.day >= range.from_day and dr.user_id in (select id from people)
    group by dr.user_id
  )
  select rank() over (order by a.total desc, p.username), a.user_id, p.username, p.avatar, a.total,
         a.user_id = auth.uid()
  from agg a join profiles p on p.id = a.user_id
  order by a.total desc
  limit 100
$$;
```

Own rank when outside the top 100: a second tiny query
`select count(*) + 1 from agg where total > my_total` wrapped as
`my_rank(p_scope, p_period)`; skipped here for brevity.

## Round-advance trigger (rooms and duels)

Fires after each guess. When every participant has answered the current
round (or the deadline sweep calls `private.close_round` directly), it
copies that round's guesses into `results`, bumps totals, and either opens
the next round or finishes.

```sql
create or replace function private.close_round(p_ctx text, p_ctx_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  rno smallint; nrounds int; res jsonb;
begin
  if p_ctx = 'room' then
    select current_round, rounds into rno, nrounds from rooms where code = p_ctx_id and status = 'live'
      and not (results ? current_round::text) for update;   -- idempotent: a second concurrent close is a no-op
    if rno is null then return; end if;

    select coalesce(jsonb_object_agg(g.user_id, jsonb_build_object('guess', g.guess_eur, 'score', g.score)), '{}')
      into res from guesses g where g.mode = 'room' and g.context_id = p_ctx_id and g.round_no = rno;

    update room_players rp set total = rp.total + coalesce((res -> rp.user_id::text ->> 'score')::int, 0)
      where rp.room_code = p_ctx_id;

    update rooms set
      results       = results || jsonb_build_object(rno::text, res),
      current_round = case when rno >= nrounds then rno else rno + 1 end,
      status        = case when rno >= nrounds then 'finished' else 'live' end,
      finished_at   = case when rno >= nrounds then now() else null end,
      -- 5 s scoreboard + 30 s round (06-multiplayer)
      round_deadline = case when rno >= nrounds then null else now() + interval '35 seconds' end
    where code = p_ctx_id;

  elsif p_ctx = 'duel' then
    select current_round, array_length(listing_ids, 1) into rno, nrounds
      from duels where id = p_ctx_id::uuid and status = 'live'
      and not (results ? current_round::text) for update;
    if rno is null then return; end if;

    select coalesce(jsonb_object_agg(g.user_id, jsonb_build_object('guess', g.guess_eur, 'score', g.score)), '{}')
      into res from guesses g where g.mode = 'duel' and g.context_id = p_ctx_id and g.round_no = rno;

    update duels d set
      results = results || jsonb_build_object(rno::text, res),
      scores  = (select coalesce(jsonb_object_agg(u, t), '{}') from (
                   select g.user_id::text as u, sum(g.score) as t from guesses g
                   where g.mode = 'duel' and g.context_id = p_ctx_id group by g.user_id) x),
      current_round = case when rno >= nrounds then rno else rno + 1 end,
      status        = case when rno >= nrounds then 'finished' else 'live' end,
      finished_at   = case when rno >= nrounds then now() else null end,
      round_deadline = case when rno >= nrounds then null else now() + interval '35 seconds' end
    where id = p_ctx_id::uuid;

    if rno >= nrounds then
      perform private.notify('duel_finished', jsonb_build_object('duel_id', p_ctx_id));
    end if;
  end if;
end $$;

create or replace function private.on_guess_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
declare answered int; expected int;
begin
  if new.mode = 'room' then
    select count(*) into answered from guesses where mode = 'room' and context_id = new.context_id and round_no = new.round_no;
    -- only players seen in the last 60 s count as "expected"; idle ones are covered by the deadline
    select count(*) into expected from room_players where room_code = new.context_id and last_seen > now() - interval '60 seconds';
    if answered >= greatest(expected, 1) then perform private.close_round('room', new.context_id); end if;
  elsif new.mode = 'duel' then
    select count(*) into answered from guesses where mode = 'duel' and context_id = new.context_id and round_no = new.round_no;
    if answered >= 2 then perform private.close_round('duel', new.context_id); end if;
  end if;
  return null;
end $$;

create trigger guesses_advance_round after insert on guesses
  for each row when (new.mode in ('room', 'duel'))
  execute function private.on_guess_inserted();
```

Deadline sweep (the "who advances an idle round" decision is in 06):

```sql
create or replace function private.sweep_deadlines() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select code from rooms where status = 'live' and round_deadline < now() - interval '3 seconds' loop
    perform private.close_round('room', r.code); n := n + 1;
  end loop;
  for r in select id from duels where status = 'live' and round_deadline < now() - interval '3 seconds' loop
    perform private.close_round('duel', r.id::text); n := n + 1;
  end loop;
  -- invites: 24 h -> async (push 'duel_async'), 7 d -> expired
  for r in update duels set async = true where status = 'invited' and not async
             and created_at < now() - interval '24 hours' returning id, challenger loop
    perform private.notify('duel_async', jsonb_build_object('duel_id', r.id, 'to', r.challenger));
  end loop;
  update duels set status = 'expired' where status = 'invited' and created_at < now() - interval '7 days';
  return n;
end $$;
```

## Migration file naming plan

Supabase CLI convention: `supabase/migrations/<YYYYMMDDHHMMSS>_<slug>.sql`,
generated with `supabase migration new <slug>`. One concern per file, never
edit an applied migration; add a new one.

| Order | File | Contents |
|-------|------|----------|
| 1 | `20260101000000_extensions.sql` | pgcrypto, pg_net, pg_cron, `private` schema |
| 2 | `20260101000100_listings.sql` | listings, categories, indexes |
| 3 | `20260101000200_profiles_auth.sql` | profiles, handle_new_user trigger, push_tokens, push_tickets |
| 4 | `20260101000300_friendships.sql` | |
| 5 | `20260101000400_guesses.sql` | guesses (+ token_nonce, time_ms), indexes |
| 6 | `20260101000500_daily.sql` | daily_sets, daily_results, context_prices |
| 7 | `20260101000600_duels_rooms.sql` | duels, rooms, room_players with extra columns |
| 8 | `20260101000700_rate_limits.sql` | |
| 9 | `20260101000800_functions_core.sql` | score, grid_cell, b64url, token secret, issue/verify token, pick_listings, strip, check_rate, notify |
| 10 | `20260101000900_rpc_solo.sql` | get_rounds, submit_guess, get_offline_pack |
| 11 | `20260101001000_rpc_daily.sql` | get_daily, submit_daily, leaderboard |
| 12 | `20260101001100_rpc_duel.sql` | invite_duel, accept_duel, decline_duel, duel_tokens |
| 13 | `20260101001200_rpc_room.sql` | create_room, join_room, start_room, room_tokens, host handover trigger |
| 14 | `20260101001300_round_advance.sql` | close_round, on_guess_inserted trigger, sweep_deadlines |
| 15 | `20260101001400_rls.sql` | enable RLS + all policies + grants (kept in one file so a review sees the whole surface) |
| 16 | `20260101001500_realtime.sql` | publication membership |
| 17 | `20260101001600_cron.sql` | pg_cron schedules: sweep every 5 s, retention nightly, push receipts |
| 18 | `20260101001700_retention.sql` | anonymise/delete functions, delete_me |
| 19 | `20260101001800_scrape_runs.sql` | scrape_runs operational table (defined in 03) |

Later phases append (`..._hints.sql`, `..._premium_webhook.sql`). Vault
secrets are **not** in migrations; they are created once per environment
with `select vault.create_secret(...)` from a documented runbook.

## Seed data for dev

`supabase/seed.sql` runs after migrations on `supabase db reset`:

- `categories`: 5 rows with lv/ru/en labels, min/max, steps.
- `listings`: 60 rows (15 flats, 10 houses, 20 cars, 15 random) with
  realistic Riga attributes and prices, `photo_urls` pointing to
  `https://picsum.photos/seed/<id>/800/600` so the app renders without
  touching SS.com. Generated by `scripts/gen-seed.ts` from a small JSON
  fixture so numbers stay plausible (Purvciems 2-room 55k, Golf 2008 3.5k).
- 4 test users inserted into `auth.users` with fixed uuids
  (`00000000-0000-0000-0000-00000000000{1..4}`) and password `password`,
  two of them friends, one anonymous.
- 1 `daily_sets` row for today + `context_prices`, so the daily works on
  first run.
- 1 duel in `invited`, 1 in `live` at round 3 with results filled, 1 room
  in `lobby` with 3 players; enough to develop every screen without
  clicking through flows.
- Vault secret for local: `select vault.create_secret('dev-secret-not-for-prod', 'round_token_secret');`
  is in seed.sql (local only; prod runbook sets a real one).
- Scraper in dev mode (`SCRAPER_LIMIT=20`) can top up real listings when
  photo behaviour needs testing.

## Realtime

Enabled per table via the publication; nothing else is broadcast.

```sql
alter publication supabase_realtime add table duels, rooms, room_players;
alter table duels set replica identity full;   -- so UPDATE payloads carry old + new
alter table rooms set replica identity full;
```

| Table | Enabled | Why |
|-------|---------|-----|
| `duels` | yes | status changes (accept/decline), `current_round`, `results` per round, `finished` |
| `rooms` | yes | lobby -> live, round advance, results, host handover |
| `room_players` | yes | avatars appearing in the lobby, totals between rounds |
| `guesses` | no | would leak opponents' guesses before the round closes; results are copied into the context row on close |
| `listings`, `daily_sets`, `daily_results` | no | read on demand; the daily leaderboard polls every 60 s while visible |
| `profiles`, `friendships` | no | friend requests use push, not Realtime |
| `context_prices` | never | prices |

Postgres Changes runs RLS per subscriber, so the `duels_read` and
`rooms_read` policies also gate who receives events. Broadcast and
Presence (emoji, "is typing", online list) do not touch tables; the
channel is joined with the user's JWT and Realtime Authorization policies
on `realtime.messages` restrict `duel:*` / `room:*` topics to participants
(see 06).

## Data retention and anonymisation

Guesses are the most personal thing we store (what you think a flat in
Purvciems costs). Keep them useful for stats without keeping them personal
forever.

| Data | Retention | Action |
|------|-----------|--------|
| `guesses` for solo/streak | 90 days | nightly: `update guesses set user_id = null where mode in ('solo','streak') and created_at < now() - interval '90 days'` keeps aggregate stats (category bias per listing) but breaks the link to a person |
| `guesses` for daily/duel/room | 1 year | same anonymisation; `daily_results` keeps the total and grid indefinitely as leaderboard history |
| anonymous `auth.users` with no guesses in 30 days | delete | weekly; cascades profile, push tokens |
| `duels` finished/expired | 180 days | delete row + `context_prices`; win/loss counts are pre-aggregated into `friend_stats (user_id, friend_id, wins, losses)` |
| `rooms`, `room_players` finished | 30 days | delete |
| `push_tickets` | 7 days | delete |
| `rate_limits` | 7 days | delete |
| `listings` expired/rejected | 60 days | delete (they were only URLs + facts); keep `photo_hash` in `listing_hashes` for dedupe |
| PostHog | 1 year default retention, EU | |

Account deletion (App Store requirement):

```sql
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  update guesses set user_id = null where user_id = me;
  delete from daily_results where user_id = me;
  delete from friendships where user_id = me or friend_id = me;
  delete from push_tokens where user_id = me;
  delete from room_players where user_id = me;
  update duels set status = 'expired' where (challenger = me or opponent = me) and status in ('invited','live');
  update duels set challenger = null where challenger = me;
  update duels set opponent   = null where opponent   = me;
  delete from profiles where id = me;
  delete from auth.users where id = me;   -- ends the session
end $$;
```

`duels.challenger`/`opponent` become `on delete set null` so historical
duel rows survive for the other player as "deleted user". PostHog gets a
`$delete_person` call from the client right before `delete_me()`.

pg_cron schedules (from migration 17):

```sql
select cron.schedule('sweep-deadlines', '5 seconds', $$select private.sweep_deadlines()$$);
select cron.schedule('retention-nightly', '30 3 * * *', $$select private.run_retention()$$);
select cron.schedule('push-receipts', '*/15 * * * *',
  $$select net.http_post(current_setting('app.settings.functions_url') || '/push-receipts', '{}'::jsonb)$$);
select cron.schedule('build-daily', '5 0 * * *',    -- 00:05 UTC = 02:05/03:05 Riga; daily flips at midnight Riga via get_daily() date math
  $$select net.http_post(current_setting('app.settings.functions_url') || '/build-daily', '{}'::jsonb)$$);
```

Note: `build-daily` must produce tomorrow's row before midnight Riga time,
so schedule it at `0 20 * * *` UTC (22:00/23:00 Riga) for the next day
and have `get_daily()` read `day = today`.
