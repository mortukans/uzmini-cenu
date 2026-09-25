-- 15 RLS + grants: the whole client-facing surface in one file.
-- Principle: clients never read listings or context_prices; everything that
-- involves a price goes through security definer RPCs.

-- ─── wipe Supabase's permissive default grants on our tables ─────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
grant  usage on schema public to anon, authenticated, service_role;
grant  all   on all tables    in schema public to service_role;
grant  all   on all sequences in schema public to service_role;

-- ─── enable RLS everywhere ───────────────────────────────────────────────────
alter table public.listings       enable row level security;
alter table public.categories     enable row level security;
alter table public.profiles       enable row level security;
alter table public.friendships    enable row level security;
alter table public.guesses        enable row level security;
alter table public.daily_sets     enable row level security;
alter table public.daily_results  enable row level security;
alter table public.context_prices enable row level security;
alter table public.duels          enable row level security;
alter table public.rooms          enable row level security;
alter table public.room_players   enable row level security;
alter table public.push_tokens    enable row level security;
alter table public.push_tickets   enable row level security;
alter table public.rate_limits    enable row level security;

-- listings, context_prices, push_tickets, rate_limits: no policies at all => no client access.

-- categories: public read
grant select on public.categories to authenticated;
create policy categories_read on public.categories for select to authenticated using (true);

-- profiles: everyone reads (username, avatar), own row updatable on avatar + lang.
-- username changes go through set_username() (format + case-insensitive uniqueness).
-- is_premium is a legacy column (free app, no paid tier) and is never set.
grant select on public.profiles to authenticated;
grant update (avatar, lang) on public.profiles to authenticated;
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- friendships: see rows you are part of; create requests; accept requests sent to you; delete either side.
-- (The app uses request_friend/accept_friend/remove_friend RPCs; direct access is allowed for parity with docs/05.)
grant select, insert, delete on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;
create policy friendships_read on public.friendships for select to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());
create policy friendships_insert on public.friendships for insert to authenticated
  with check (user_id = auth.uid() and friend_id <> auth.uid() and status = 'pending'
              and not public.is_auto_username((select p.username from public.profiles p where p.id = auth.uid())));
create policy friendships_accept on public.friendships for update to authenticated
  using (friend_id = auth.uid() and status = 'pending')
  with check (status = 'accepted');
create policy friendships_delete on public.friendships for delete to authenticated
  using (user_id = auth.uid() or friend_id = auth.uid());

-- guesses: read own + friends' (stats); writes only via submit_guess (security definer)
grant select on public.guesses to authenticated;
create policy guesses_read on public.guesses for select to authenticated
  using (user_id = auth.uid() or is_friend(user_id));

-- daily_sets: snapshot is price-free (prices in context_prices), so the row may be read
-- once its day has started. Not tomorrow's preview.
grant select on public.daily_sets to authenticated;
create policy daily_sets_read on public.daily_sets for select to authenticated
  using (day <= (now() at time zone 'Europe/Riga')::date);

-- daily_results: own + friends; top-N via leaderboard() RPC
grant select on public.daily_results to authenticated;
create policy daily_results_read on public.daily_results for select to authenticated
  using (user_id = auth.uid() or is_friend(user_id));

-- duels: participants only. State changes via RPC, except the opponent's accept/decline
-- which RLS allows as a plain update (kept for docs/06 parity; the app uses the RPCs).
grant select on public.duels to authenticated;
grant update (status) on public.duels to authenticated;
create policy duels_read on public.duels for select to authenticated
  using (challenger = auth.uid() or opponent = auth.uid());
create policy duels_opponent_respond on public.duels for update to authenticated
  using (opponent = auth.uid() and status = 'invited')
  with check (status in ('live', 'declined'));

-- rooms: any member (or the host) reads; host may retune category/rounds in the lobby;
-- status changes only through start_room / close_round.
grant select on public.rooms to authenticated;
grant update (category, rounds) on public.rooms to authenticated;
create policy rooms_read on public.rooms for select to authenticated
  using (in_room(code) or host = auth.uid());
create policy rooms_host_update on public.rooms for update to authenticated
  using (host = auth.uid() and status = 'lobby') with check (host = auth.uid());

-- room_players: members read; leave = delete own row; heartbeat = update own last_seen
grant select, delete on public.room_players to authenticated;
grant update (last_seen) on public.room_players to authenticated;
create policy room_players_read on public.room_players for select to authenticated
  using (in_room(room_code));
create policy room_players_leave on public.room_players for delete to authenticated
  using (user_id = auth.uid());
create policy room_players_heartbeat on public.room_players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- push_tokens: own rows only (register_push_token RPC is the normal path)
grant select, insert, update, delete on public.push_tokens to authenticated;
create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── function grants ─────────────────────────────────────────────────────────
-- Helpers used inside policies + every RPC in src/api/rpc.ts.
grant execute on function public.is_anon()              to authenticated;
grant execute on function public.is_auto_username(text) to authenticated;
grant execute on function public.is_friend(uuid)        to authenticated;
grant execute on function public.in_room(text)          to authenticated;
grant execute on function public.score(integer, integer, numeric) to authenticated;
grant execute on function public.grid_cell(integer, integer)      to authenticated;

grant execute on function public.get_rounds(text, text, int)              to authenticated;
grant execute on function public.submit_guess(text, integer, integer)     to authenticated;
grant execute on function public.get_offline_pack(text, int)              to authenticated;
grant execute on function public.get_daily()                              to authenticated;
grant execute on function public.submit_daily()                           to authenticated;
grant execute on function public.leaderboard(text, text)                  to authenticated;
grant execute on function public.my_rank(text, text)                      to authenticated;
grant execute on function public.invite_duel(uuid, text)                  to authenticated;
grant execute on function public.accept_duel(uuid)                        to authenticated;
grant execute on function public.decline_duel(uuid)                       to authenticated;
grant execute on function public.duel_tokens(uuid)                        to authenticated;
grant execute on function public.poke(text, text)                         to authenticated;
grant execute on function public.create_room(text, smallint)              to authenticated;
grant execute on function public.join_room(text)                          to authenticated;
grant execute on function public.start_room(text)                         to authenticated;
grant execute on function public.room_tokens(text)                        to authenticated;
grant execute on function public.request_friend(uuid)                     to authenticated;
grant execute on function public.accept_friend(uuid)                      to authenticated;
grant execute on function public.remove_friend(uuid)                      to authenticated;
grant execute on function public.list_friends()                           to authenticated;
grant execute on function public.set_username(text)                       to authenticated;
grant execute on function public.register_push_token(text, text)          to authenticated;
-- delete_me is granted in 18 where it is defined; run_sweep only to service_role:
grant execute on function public.run_sweep() to service_role;

-- Future tables/functions created by migrations default to no client access;
-- each later migration grants explicitly.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
