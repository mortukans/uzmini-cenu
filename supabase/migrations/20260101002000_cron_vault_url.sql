-- Re-schedule the two HTTP cron jobs to use private.functions_url() (Vault-backed) instead of the GUC.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then return; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('push-receipts', 'build-daily');
  perform cron.schedule('push-receipts', '*/15 * * * *', $j$
    select net.http_post(
      url     := private.functions_url() || '/push-receipts',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || private.service_key()),
      body    := '{}'::jsonb)
    where private.functions_url() is not null $j$);
  perform cron.schedule('build-daily', '0 20 * * *', $j$
    select net.http_post(
      url     := private.functions_url() || '/build-daily',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || private.service_key()),
      body    := '{}'::jsonb)
    where private.functions_url() is not null $j$);
end $$;
