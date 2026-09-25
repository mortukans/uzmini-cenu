-- 06 daily challenge + the price side table shared by daily / duel / room

create table public.daily_sets (
  day          date primary key,
  listing_ids  bigint[] not null,
  snapshot     jsonb not null,                -- frozen attributes + photos, PRICE-FREE (prices in context_prices)
  created_at   timestamptz not null default now()
);

create table public.daily_results (
  day          date not null references public.daily_sets (day) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  total        smallint not null,
  grid         text not null,                 -- '🟩🟩🟨🟥🟩'
  submitted_at timestamptz not null default now(),   -- leaderboard tie-break (earlier wins)
  primary key (day, user_id)
);
create index daily_results_day_total_idx on public.daily_results (day, total desc, submitted_at);
create index daily_results_user_idx      on public.daily_results (user_id, day desc);

-- Prices for snapshotted contexts. Never published to Realtime, no RLS policies,
-- read only inside security definer RPCs. context_id: daily = day text,
-- duel = duel uuid text, room = room code.
create table public.context_prices (
  context_type text not null,                 -- 'daily' | 'duel' | 'room'
  context_id   text not null,
  listing_id   bigint not null,
  price_eur    integer not null,
  primary key (context_type, context_id, listing_id),
  constraint context_prices_type_chk check (context_type in ('daily','duel','room'))
);
