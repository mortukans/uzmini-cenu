-- Supabase does not allow `alter database/role set app.settings.*` for the postgres role, so
-- private.notify() now also reads the functions URL from Vault (secret 'functions_url').
create or replace function private.functions_url() returns text
language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  begin
    select ds.decrypted_secret into s from vault.decrypted_secrets ds where ds.name = 'functions_url' limit 1;
  exception when others then
    s := null;
  end;
  return coalesce(s, nullif(current_setting('app.settings.functions_url', true), ''));
end $$;
revoke all on function private.functions_url() from public;

create or replace function private.notify(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := private.functions_url();
  key  text := private.service_key();
begin
  if base is null or key is null then
    raise notice 'notify(%) skipped: functions_url / service_key not set', p_event;
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
