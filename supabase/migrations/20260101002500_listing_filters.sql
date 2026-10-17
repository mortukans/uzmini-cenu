-- 25 listing filters: period / make / model / sort for free play + streak.
-- Contract: src/api/rpc.ts (getRoundsFiltered, countListings, listCarMakes,
-- listCarModels, getListingStatus).
--
-- One predicate, many consumers. `private.listings_filtered` is a plain SQL
-- table function (no security definer, no SET clause) so Postgres inlines it
-- into every caller and the partial indexes below stay usable. All public
-- entry points are security definer, so the helper itself needs no extra
-- privilege; it is only ever reached through them.
--
-- `first_seen_at` is the listing's publication date, not the time we saw it:
-- the scraper writes the SS.com "Datums" value from the detail page into
-- first_seen_at on insert (scraper/src/writer.ts toRow -> posted_at) and never
-- moves it on an update. Rows that were inserted without a detail page keep
-- the column default (= inserted-at). Period filters and `published_at` in
-- private.strip() are built on that column.

-- ─── indexes ─────────────────────────────────────────────────────────────────

create index if not exists listings_published_idx on public.listings (first_seen_at desc)
  where status = 'active';
create index if not exists listings_car_make_idx on public.listings (lower(attributes ->> 'make'))
  where status = 'active' and category = 'cars';
create index if not exists listings_price_idx on public.listings (category, price_eur)
  where status = 'active';

-- ─── strip: expose the publication date ──────────────────────────────────────

create or replace function private.strip(l public.listings) returns jsonb
language sql immutable parallel safe as $$
  select jsonb_build_object(
    'id', l.id, 'category', l.category, 'region', l.region, 'location', l.location,
    'attributes', l.attributes - '_raw' - 'trim_hint' - 'dup_of' - 'also_at',
    'title_hint', l.title_hint, 'photo_urls', l.photo_urls,
    'source', l.source, 'source_url', l.source_url,
    'published_at', l.first_seen_at)
$$;

-- ─── the filter predicate ────────────────────────────────────────────────────

-- Base WHERE of private.pick_listings (24) + period + make/model.
--   p_period: '24h' | '7d' | '30d' | 'all' (null = 'all'), on first_seen_at
--   p_make / p_model: cars only, case-insensitive; model needs make
create or replace function private.listings_filtered(p_category text, p_region text, p_period text,
                                                     p_make text, p_model text)
returns setof public.listings language sql stable as $$
  select l.* from public.listings l
  where l.status = 'active'
    and l.checked_at > now() - interval '72 hours'
    and (p_category is null or p_category = 'all' or l.category = p_category)
    and (p_region is null or p_region = 'latvia' or l.region = p_region)
    and l.quality >= 0
    and coalesce(array_length(l.photo_urls, 1), 0) >= 1
    and coalesce(l.attributes ->> 'reject_reason', '') <> 'photo_dead'
    and (coalesce(p_period, 'all') = 'all'
         or l.first_seen_at > now() - case p_period when '24h' then interval '24 hours'
                                                    when '7d'  then interval '7 days'
                                                    when '30d' then interval '30 days' end)
    and (p_category is distinct from 'cars' or p_make is null
         or lower(l.attributes ->> 'make') = lower(p_make))
    and (p_category is distinct from 'cars' or p_make is null or p_model is null
         or lower(l.attributes ->> 'model') = lower(p_model))
$$;

-- Sort key for p_sort, as an array so one ORDER BY covers every mode and the
-- tie-break: random | newest (first_seen_at desc, id desc)
--                   | price_asc (price_eur, id) | price_desc (price_eur desc, id)
create or replace function private.listing_sort_key(l public.listings, p_sort text) returns float8[]
language sql volatile as $$
  select case p_sort
    when 'newest'     then array[-extract(epoch from l.first_seen_at), -l.id]::float8[]
    when 'price_asc'  then array[l.price_eur,  l.id]::float8[]
    when 'price_desc' then array[-l.price_eur, l.id]::float8[]
    else                   array[random(), l.id]::float8[]
  end
$$;

create or replace function private.pick_listings_filtered(p_category text, p_region text, p_n int,
                                                           p_exclude bigint[], p_period text,
                                                           p_make text, p_model text, p_sort text)
returns setof public.listings language sql stable security definer set search_path = public as $$
  select l.* from private.listings_filtered(p_category, p_region, p_period, p_make, p_model) l
  where not (l.id = any(coalesce(p_exclude, '{}')))
  order by private.listing_sort_key(l, p_sort)
  limit p_n
$$;

-- shared argument validation (raises bad_category / bad_region / bad_period / bad_filter)
create or replace function private.check_listing_filters(p_category text, p_region text, p_period text,
                                                          p_make text, p_model text) returns void
language plpgsql immutable as $$
begin
  if p_category is null or p_category not in ('all','flats','houses','cars','random','land') then raise exception 'bad_category'; end if;
  if p_region is not null and p_region not in ('riga','riga_region','latvia') then raise exception 'bad_region'; end if;
  if p_period is not null and p_period not in ('24h','7d','30d','all') then raise exception 'bad_period'; end if;
  if length(p_make) > 64 or length(p_model) > 64 then raise exception 'bad_filter'; end if;
end $$;

-- ─── public RPCs ─────────────────────────────────────────────────────────────

-- get_rounds (10) with filters and a deterministic order. p_exclude = ids the
-- session already holds; they are never returned. Shares the get_rounds rate
-- bucket. When the 7-day "seen" filter leaves fewer than p_n rows the pick is
-- topped up with repeats (same fallback as get_rounds), then the whole set is
-- re-sorted so the array order matches p_sort even across the two picks.
create or replace function public.get_rounds_filtered(p_category text default 'all',
                                                      p_region text default null,
                                                      p_n int default 10,
                                                      p_period text default 'all',
                                                      p_make text default null,
                                                      p_model text default null,
                                                      p_sort text default 'random',
                                                      p_exclude bigint[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  result  jsonb := '[]'::jsonb;
  l       listings;
  picked  listings[] := '{}';
  seen    bigint[];
  n_have  int;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception 'bad_n'; end if;
  perform private.check_listing_filters(p_category, p_region, p_period, p_make, p_model);
  if p_sort is not null and p_sort not in ('random','newest','price_asc','price_desc') then raise exception 'bad_sort'; end if;
  if coalesce(array_length(p_exclude, 1), 0) > 2000 then raise exception 'bad_filter'; end if;
  perform private.check_rate_hourly('get_rounds', 60);

  -- avoid repeating listings the player saw in the last 7 days
  select coalesce(array_agg(distinct listing_id), '{}') into seen
  from guesses where user_id = auth.uid() and created_at > now() - interval '7 days';

  select coalesce(array_agg(x), '{}') into picked
  from private.pick_listings_filtered(p_category, p_region, p_n, seen || coalesce(p_exclude, '{}'),
                                      p_period, p_make, p_model, p_sort) x;
  n_have := coalesce(array_length(picked, 1), 0);
  -- pool exhausted by the 7-day filter? fall back to repeats rather than an empty screen
  if n_have < p_n then
    select picked || coalesce(array_agg(x), '{}') into picked
    from private.pick_listings_filtered(p_category, p_region, p_n - n_have,
           (select coalesce(array_agg(p.id), '{}') from unnest(picked) p) || coalesce(p_exclude, '{}'),
           p_period, p_make, p_model, p_sort) x;
  end if;

  for l in select p.* from unnest(picked) p order by private.listing_sort_key(p, p_sort) loop
    result := result || (private.strip(l) || jsonb_build_object(
      'token', private.issue_round_token(l.id, 'solo', null, null, interval '30 minutes')));
  end loop;
  return result;
end $$;

-- How many active listings match (same predicate, no exclusions). A bare count:
-- never ids, never prices.
create or replace function public.count_listings(p_category text default 'all',
                                                 p_region text default null,
                                                 p_period text default 'all',
                                                 p_make text default null,
                                                 p_model text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  perform private.check_listing_filters(p_category, p_region, p_period, p_make, p_model);
  perform private.check_rate_hourly('count_listings', 240);
  select count(*) into n from private.listings_filtered(p_category, p_region, p_period, p_make, p_model);
  return n;
end $$;

-- [{"make": "BMW", "n": 123}, ...] — makes with at least one active car, most common first
create or replace function public.list_car_makes(p_region text default null, p_period text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  perform private.check_listing_filters('cars', p_region, p_period, null, null);
  perform private.check_rate_hourly('list_car_makes', 120);
  select coalesce(jsonb_agg(jsonb_build_object('make', make, 'n', n) order by n desc, make asc), '[]'::jsonb)
    into res
  from (
    select l.attributes ->> 'make' as make, count(*) as n
    from private.listings_filtered('cars', p_region, p_period, null, null) l
    where nullif(l.attributes ->> 'make', '') is not null
    group by 1
    order by n desc, make asc
    limit 100
  ) m;
  return res;
end $$;

-- [{"model": "X5", "n": 12}, ...] — models of one make (case-insensitive), most common first
create or replace function public.list_car_models(p_make text, p_region text default null, p_period text default 'all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if nullif(trim(p_make), '') is null then raise exception 'bad_filter'; end if;
  perform private.check_listing_filters('cars', p_region, p_period, p_make, null);
  perform private.check_rate_hourly('list_car_models', 120);
  select coalesce(jsonb_agg(jsonb_build_object('model', model, 'n', n) order by n desc, model asc), '[]'::jsonb)
    into res
  from (
    select l.attributes ->> 'model' as model, count(*) as n
    from private.listings_filtered('cars', p_region, p_period, p_make, null) l
    where nullif(l.attributes ->> 'model', '') is not null
    group by 1
    order by n desc, model asc
    limit 100
  ) m;
  return res;
end $$;

-- Availability of listings the player guessed on, one row per requested id in
-- request order: [{"id", "status": active|expired|rejected|unknown, "source_url", "checked_at"}].
-- Unknown ids come back as status 'unknown' / '' / null. Never includes price_eur.
create or replace function public.get_listing_status(p_ids bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_ids is null or array_length(p_ids, 1) > 50 then raise exception 'bad_n'; end if;
  perform private.check_rate_hourly('get_listing_status', 120);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id,
           'status', coalesce(l.status, 'unknown'),
           'source_url', coalesce(l.source_url, ''),
           'checked_at', l.checked_at) order by u.ord), '[]'::jsonb)
    into res
  from unnest(p_ids) with ordinality as u(id, ord)
  left join listings l on l.id = u.id;
  return res;
end $$;

-- ─── grants ──────────────────────────────────────────────────────────────────

revoke all on function private.listings_filtered(text, text, text, text, text)                          from public;
revoke all on function private.listing_sort_key(public.listings, text)                                  from public;
revoke all on function private.pick_listings_filtered(text, text, int, bigint[], text, text, text, text) from public;
revoke all on function private.check_listing_filters(text, text, text, text, text)                      from public;

grant execute on function public.get_rounds_filtered(text, text, int, text, text, text, text, bigint[]) to authenticated;
grant execute on function public.count_listings(text, text, text, text, text)                           to authenticated;
grant execute on function public.list_car_makes(text, text)                                             to authenticated;
grant execute on function public.list_car_models(text, text, text)                                      to authenticated;
grant execute on function public.get_listing_status(bigint[])                                           to authenticated;
