-- 19 scrape_runs: scraper operational table (docs/03 "Monitoring and alerting")
-- Written by the scraper with the service role only; no client access.

create table public.scrape_runs (
  id            bigserial primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  requests      int not null default 0,
  new_rows      int not null default 0,
  updated_rows  int not null default 0,
  expired_rows  int not null default 0,
  rejected      jsonb not null default '{}',   -- {reason_code: count}
  errors        int not null default 0,
  blocked_until timestamptz,
  notes         text,
  queue_cursor  jsonb                          -- queue position persisted between invocations
);
create index scrape_runs_source_started_idx on public.scrape_runs (source, started_at desc);
alter table public.scrape_runs enable row level security;
grant all on public.scrape_runs to service_role;
grant usage, select on sequence public.scrape_runs_id_seq to service_role;

-- stock photo blocklist used by the scraper's quality step (docs/03), service role only
create table public.photo_blocklist (
  photo_hash text primary key,
  note       text,
  added_at   timestamptz not null default now()
);
alter table public.photo_blocklist enable row level security;
grant all on public.photo_blocklist to service_role;
