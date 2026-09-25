-- 07 duels, rooms, room_players (base columns + docs/05 additions in one go)

create table public.duels (
  id             uuid primary key default gen_random_uuid(),
  challenger     uuid references public.profiles (id) on delete set null,
  opponent       uuid references public.profiles (id) on delete set null,
  listing_ids    bigint[] not null,
  snapshot       jsonb not null,                 -- frozen listings, PRICE-FREE
  status         text not null default 'invited',-- invited | live | finished | expired | declined
  scores         jsonb not null default '{}',    -- running total cache {user_id: total}
  current_round  smallint not null default 1,
  round_deadline timestamptz,
  accepted_at    timestamptz,
  finished_at    timestamptz,
  async          boolean not null default false, -- set by the 24 h sweep; disables deadlines
  results        jsonb not null default '{}',    -- {round_no: {user_id: {guess, score}}}, written when a round closes
  created_at     timestamptz not null default now(),
  constraint duels_status_chk check (status in ('invited','live','finished','expired','declined'))
);
create index duels_challenger_idx on public.duels (challenger, created_at desc);
create index duels_opponent_idx  on public.duels (opponent, created_at desc);
create index duels_open_idx      on public.duels (status, round_deadline) where status in ('invited','live');

create table public.rooms (
  code           text primary key,               -- 4 consonants
  host           uuid references public.profiles (id) on delete set null,
  category       text not null default 'all',
  rounds         smallint not null default 5,
  listing_ids    bigint[],
  snapshot       jsonb,                          -- PRICE-FREE
  status         text not null default 'lobby',  -- lobby | live | finished
  current_round  smallint not null default 0,
  round_deadline timestamptz,
  results        jsonb not null default '{}',
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint rooms_status_chk check (status in ('lobby','live','finished')),
  constraint rooms_code_chk   check (code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}$')
);
create index rooms_open_idx on public.rooms (status, round_deadline) where status = 'live';

create table public.room_players (
  room_code  text not null references public.rooms (code) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  total      smallint not null default 0,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (room_code, user_id)
);
create index room_players_user_idx on public.room_players (user_id);
