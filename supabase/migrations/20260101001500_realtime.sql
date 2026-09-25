-- 16 realtime: publication membership + channel authorization
-- Only duels, rooms, room_players are broadcast. guesses (would leak opponents'
-- guesses), listings, daily_*, context_prices are never published.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'duels') then
      alter publication supabase_realtime add table public.duels;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
      alter publication supabase_realtime add table public.rooms;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_players') then
      alter publication supabase_realtime add table public.room_players;
    end if;
  else
    raise notice 'publication supabase_realtime missing (not a Supabase db?) - skipped';
  end if;
end $$;

-- UPDATE payloads carry old + new; DELETE on room_players carries the key
alter table public.duels        replica identity full;
alter table public.rooms        replica identity full;
alter table public.room_players replica identity full;

-- Broadcast / Presence topics `duel:<id>` and `room:<code>` restricted to participants
-- (channels are created with { private: true }). Guarded: realtime.messages exists only on Supabase.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages missing - channel policies skipped';
    return;
  end if;

  execute $p$
    create policy duel_channel_read on realtime.messages for select to authenticated
    using (
      realtime.topic() like 'duel:%'
      and realtime.messages.extension in ('broadcast', 'presence')
      and exists (select 1 from public.duels d
                  where d.id::text = split_part(realtime.topic(), ':', 2)
                    and auth.uid() in (d.challenger, d.opponent))
    ) $p$;
  execute $p$
    create policy duel_channel_write on realtime.messages for insert to authenticated
    with check (
      realtime.topic() like 'duel:%'
      and realtime.messages.extension in ('broadcast', 'presence')
      and exists (select 1 from public.duels d
                  where d.id::text = split_part(realtime.topic(), ':', 2)
                    and auth.uid() in (d.challenger, d.opponent))
    ) $p$;
  execute $p$
    create policy room_channel_read on realtime.messages for select to authenticated
    using (
      realtime.topic() like 'room:%'
      and realtime.messages.extension in ('broadcast', 'presence')
      and public.in_room(split_part(realtime.topic(), ':', 2))
    ) $p$;
  execute $p$
    create policy room_channel_write on realtime.messages for insert to authenticated
    with check (
      realtime.topic() like 'room:%'
      and realtime.messages.extension in ('broadcast', 'presence')
      and public.in_room(split_part(realtime.topic(), ':', 2))
    ) $p$;
exception when duplicate_object then
  raise notice 'realtime channel policies already exist';
end $$;
