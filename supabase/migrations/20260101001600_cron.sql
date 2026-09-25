-- 17 pg_cron schedules (guarded: local stacks may lack pg_cron / pg_net)
-- sweep-deadlines : every 10 s backstop for round deadlines + 24 h / 7 d duel invites (docs/06)
-- retention       : nightly anonymise / delete (18)
-- purge-anon      : weekly, accounts with no username and no guesses for 90 d
-- push-receipts   : every 15 min -> Edge Function (token hygiene)
-- build-daily     : 20:00 UTC (22:00/23:00 Riga) builds TOMORROW's set
-- If seconds-level schedules are unsupported on the project, replace '10 seconds' with '* * * * *'.

do $$
declare has_net boolean;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron missing - schedules skipped';
    return;
  end if;
  has_net := exists (select 1 from pg_extension where extname = 'pg_net');

  perform cron.unschedule(jobid) from cron.job
   where jobname in ('sweep-deadlines','retention-nightly','purge-anon-weekly','push-receipts','build-daily');

  perform cron.schedule('sweep-deadlines',   '10 seconds', $j$select private.sweep_deadlines()$j$);
  perform cron.schedule('retention-nightly', '30 3 * * *', $j$select private.run_retention()$j$);
  perform cron.schedule('purge-anon-weekly', '0 4 * * 1',  $j$select private.purge_idle_anonymous()$j$);

  if has_net then
    perform cron.schedule('push-receipts', '*/15 * * * *', $j$
      select net.http_post(
        url     := current_setting('app.settings.functions_url') || '/push-receipts',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || private.service_key()),
        body    := '{}'::jsonb)
      where current_setting('app.settings.functions_url', true) is not null $j$);
    perform cron.schedule('build-daily', '0 20 * * *', $j$
      select net.http_post(
        url     := current_setting('app.settings.functions_url') || '/build-daily',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || private.service_key()),
        body    := '{}'::jsonb)
      where current_setting('app.settings.functions_url', true) is not null $j$);
  else
    raise notice 'pg_net missing - http schedules (push-receipts, build-daily) skipped';
  end if;
end $$;
