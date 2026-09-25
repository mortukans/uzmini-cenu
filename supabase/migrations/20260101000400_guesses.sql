-- 05 guesses: every scored guess, all modes
-- context_id is text from the start (docs/05 alters uuid -> text; we skip the detour):
--   daily = 'YYYY-MM-DD', duel = uuid text, room = 4-letter code, solo/streak = null.

create table public.guesses (
  id          bigserial primary key,
  user_id     uuid references public.profiles (id) on delete set null,   -- null after anonymisation
  listing_id  bigint not null references public.listings (id) on delete cascade,
  mode        text not null,                                              -- solo | streak | daily | duel | room
  context_id  text,
  round_no    smallint,
  guess_eur   integer not null,
  score       smallint not null,
  token_nonce text,                                                       -- solo/streak single-use key
  time_ms     integer,                                                    -- time to guess, analytics
  suspicious  boolean not null default false,                             -- anti-cheat flag (06), manual review
  created_at  timestamptz not null default now(),
  constraint guesses_mode_chk check (mode in ('solo','streak','daily','duel','room'))
);

-- single-use tokens + "did I already answer" lookups.
-- For daily/duel/room token_nonce is stored as NULL so a re-issued token can not
-- answer the same listing twice; NULLS NOT DISTINCT makes that enforceable (PG15+).
create unique index guesses_once_idx
  on public.guesses (user_id, mode, context_id, listing_id, token_nonce) nulls not distinct;
create index guesses_context_idx   on public.guesses (mode, context_id, round_no);
create index guesses_user_time_idx on public.guesses (user_id, created_at desc);
create index guesses_listing_idx   on public.guesses (listing_id);           -- retention deletes
