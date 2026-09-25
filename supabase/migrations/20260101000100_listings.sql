-- 02 listings + categories

create table public.listings (
  id            bigserial primary key,
  source        text not null,                       -- 'ss' | 'city24' | ...
  source_url    text not null unique,
  category      text not null,                       -- 'flats' | 'houses' | 'cars' | 'random' | 'land'
  price_eur     integer not null,
  region        text,                                -- 'riga' | 'riga_region' | 'latvia'
  location      text,                                -- district or town, sanitised
  attributes    jsonb not null default '{}',         -- rooms, m2, year, km ...
  title_hint    text,                                -- scrubbed title, optional hint
  photo_urls    text[] not null,
  photo_hash    text,                                -- phash of first photo, dedupe
  status        text not null default 'active',      -- active | expired | rejected
  quality       smallint not null default 0,         -- manual curation score (-9 .. 3)
  first_seen_at timestamptz not null default now(),
  checked_at    timestamptz not null default now(),
  constraint listings_category_chk check (category in ('flats','houses','cars','random','land')),
  constraint listings_status_chk   check (status in ('active','expired','rejected')),
  constraint listings_price_chk    check (price_eur > 0)
);

create index listings_cat_status_checked_idx on public.listings (category, status, checked_at);
-- round selection: random active fresh listing per category/region
create index listings_pick_idx on public.listings (category, region, status, checked_at desc)
  where status = 'active';
create index listings_photo_hash_idx on public.listings (photo_hash) where photo_hash is not null;

-- category labels in 3 languages, editable without an app release
create table public.categories (
  key     text primary key,
  labels  jsonb not null,                            -- {"lv": "Dzīvokļi", "ru": "Квартиры", "en": "Flats"}
  min_eur integer,
  max_eur integer,
  steps   integer[] not null                         -- quick +/- steps, e.g. {1000,10000}
);
