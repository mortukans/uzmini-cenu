-- 08 sliding-window (daily, Europe/Riga) rate limiting inside RPCs
-- Hourly limits reuse the same table with the hour folded into `action`
-- (e.g. 'get_rounds@14'), see private.check_rate_hourly in 09.

create table public.rate_limits (
  user_id   uuid not null,
  action    text not null,                     -- 'duel_invite' | 'room_create' | 'offline_pack@13' | ...
  "window"  date not null default (now() at time zone 'Europe/Riga')::date,
  count     integer not null default 0,
  primary key (user_id, action, "window")
);
create index rate_limits_window_idx on public.rate_limits ("window");
