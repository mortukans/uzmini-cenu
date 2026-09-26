-- 22 identity linking: anonymous device account → Apple / Google account.
--
-- Native id-token sign-in (supabase.auth.signInWithIdToken) always signs in AS the
-- provider user (creating it on first use); it cannot link into the current anonymous
-- user. So the app does a two-step merge:
--   1. while still anonymous:  prepare_merge()  → one-time token on the anonymous profile
--   2. signInWithIdToken(...)  (client session is now the provider user)
--   3. as the provider user:   claim_merge(p_token)
--        - provider user is brand new (still has the trigger's placeholder name):
--          move everything from the anonymous user onto it ("save progress")
--        - provider user already has a chosen username ("restore on a fresh device"):
--          keep its data, drop the anonymous user
--      either way the anonymous auth user is deleted at the end.
--
-- handle_new_user() (03) already runs for provider users exactly like for anonymous
-- ones: they get a 'player_xxxxxx' placeholder and pick a username via set_username.

alter table public.profiles
  add column if not exists merge_token         uuid,
  add column if not exists merge_token_expires timestamptz;
create index if not exists profiles_merge_token_idx on public.profiles (merge_token) where merge_token is not null;

-- Step 1: called by the ANONYMOUS user right before signInWithIdToken.
create or replace function public.prepare_merge() returns uuid
language plpgsql security definer set search_path = public as $$
declare tok uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if not public.is_anon() then raise exception 'not_anonymous'; end if;
  update profiles set merge_token = tok, merge_token_expires = now() + interval '10 minutes'
   where id = auth.uid();
  if not found then raise exception 'sign_in_required'; end if;
  return tok;
end $$;

-- Step 3: called by the PROVIDER user. Returns {merged: bool, restored: bool}.
--   merged   = anonymous data moved onto the caller
--   restored = caller already existed; anonymous data discarded
create or replace function public.claim_merge(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  old  profiles%rowtype;
  mine profiles%rowtype;
  fresh boolean;
begin
  if me is null then raise exception 'sign_in_required'; end if;
  if public.is_anon() then raise exception 'not_linked'; end if;
  if p_token is null then raise exception 'merge_invalid'; end if;

  select * into old from profiles
   where merge_token = p_token and merge_token_expires > now() for update;
  if old.id is null then raise exception 'merge_expired'; end if;
  if old.id = me then
    update profiles set merge_token = null, merge_token_expires = null where id = me;
    return jsonb_build_object('merged', false, 'restored', false);
  end if;

  select * into mine from profiles where id = me for update;
  if mine.id is null then raise exception 'sign_in_required'; end if;

  fresh := public.is_auto_username(mine.username);

  if fresh then
    -- never let the two accounts be "friends" with each other after the merge
    delete from friendships  where (user_id = old.id and friend_id = me) or (user_id = me and friend_id = old.id);
    delete from friend_stats where (user_id = old.id and friend_id = me) or (user_id = me and friend_id = old.id);

    update guesses set user_id = me where user_id = old.id;

    -- daily: keep the caller's row when both played the same day (cannot happen for a fresh user, but be safe)
    update daily_results d set user_id = me where d.user_id = old.id
      and not exists (select 1 from daily_results x where x.user_id = me and x.day = d.day);
    delete from daily_results where user_id = old.id;

    update friendships f set user_id = me where f.user_id = old.id
      and not exists (select 1 from friendships x where x.user_id = me and x.friend_id = f.friend_id);
    update friendships f set friend_id = me where f.friend_id = old.id
      and not exists (select 1 from friendships x where x.user_id = f.user_id and x.friend_id = me);
    delete from friendships where user_id = old.id or friend_id = old.id;

    update friend_stats s set user_id = me where s.user_id = old.id
      and not exists (select 1 from friend_stats x where x.user_id = me and x.friend_id = s.friend_id);
    update friend_stats s set friend_id = me where s.friend_id = old.id
      and not exists (select 1 from friend_stats x where x.user_id = s.user_id and x.friend_id = me);
    delete from friend_stats where user_id = old.id or friend_id = old.id;

    update push_tokens set user_id = me, updated_at = now() where user_id = old.id;

    update room_players r set user_id = me where r.user_id = old.id
      and not exists (select 1 from room_players x where x.room_code = r.room_code and x.user_id = me);
    delete from room_players where user_id = old.id;
    update rooms set host = me where host = old.id;
    update rooms set results = replace(results::text, old.id::text, me::text)::jsonb
      where results::text like '%' || old.id::text || '%';

    update duels set challenger = me where challenger = old.id;
    update duels set opponent   = me where opponent   = old.id;
    update duels set
        scores  = replace(scores::text,  old.id::text, me::text)::jsonb,
        results = replace(results::text, old.id::text, me::text)::jsonb
      where scores::text like '%' || old.id::text || '%' or results::text like '%' || old.id::text || '%';

    -- carry the chosen username / prefs over (free the unique name first)
    update profiles set username = null, merge_token = null, merge_token_expires = null where id = old.id;
    update profiles set
        username   = case when public.is_auto_username(old.username) then mine.username else old.username end,
        avatar     = coalesce(mine.avatar, old.avatar),
        lang       = old.lang,
        is_premium = mine.is_premium or old.is_premium,
        merge_token = null, merge_token_expires = null
      where id = me;
  else
    update profiles set merge_token = null, merge_token_expires = null where id = me;
  end if;

  -- drop the anonymous account (cascades: profile + anything left behind)
  delete from auth.users where id = old.id;

  return jsonb_build_object('merged', fresh, 'restored', not fresh);
end $$;

revoke all on function public.prepare_merge()    from public;
revoke all on function public.claim_merge(uuid)  from public;
grant execute on function public.prepare_merge()   to authenticated;
grant execute on function public.claim_merge(uuid) to authenticated;

-- profiles are readable by every authenticated user (15): never expose the token columns.
-- The app selects explicit columns (src/api/rpc.ts getMyProfile), so `select *` is not needed.
revoke select on public.profiles from authenticated;
grant select (id, username, avatar, lang, is_premium, created_at) on public.profiles to authenticated;
