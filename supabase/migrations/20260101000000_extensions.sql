-- 01 extensions + private schema
-- pgcrypto: hmac / gen_random_bytes for round tokens
-- pg_net:   fire-and-forget HTTP to Edge Functions (send-push)
-- pg_cron:  deadline sweep, retention, receipts (may be absent locally; guarded)

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net not available: %', sqlerrm;
end $$;

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

-- Helpers that must never be reachable through PostgREST live here.
-- `private` is not in the API schema list (config.toml), and nothing but the
-- owner (postgres) may use it.
create schema if not exists private;
revoke all on schema private from public;
do $$
begin
  revoke all on schema private from anon, authenticated;
exception when undefined_object then
  null;  -- roles missing outside Supabase
end $$;
