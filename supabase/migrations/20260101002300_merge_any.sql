-- 23 identity merge from ANY signed-in user (not only anonymous ones).
--
-- 22 let only anonymous users prepare_merge(). A device account that is already
-- linked (Apple) and continues with a second, still unused provider (Google) —
-- Profile → Account before the linked state was known, or onboarding "Replay
-- intro" slide 4 — could not carry its progress over: signInWithIdToken simply
-- switched to the Google user. Now:
--   1. prepare_merge()   any valid session may mint the one-time token
--   2. signInWithIdToken (client session is now the provider user)
--   3. claim_merge()     unchanged logic, with one difference in what happens
--                        to the PREVIOUS account:
--        - provider user is new ("fresh")  → everything moves onto it and the previous
--          auth user is deleted as before. For a linked previous account this deletes
--          its Apple/Google identity too: that old link is gone, the merged account is
--          reachable through the new provider only (the app says so in its alert).
--        - provider user already exists     → its data wins. An ANONYMOUS previous
--          account is dropped as before (nothing to sign back into); a LINKED previous
--          account is left untouched, so the user can sign back into it with its own
--          provider (the app says "your previous account is still available via X").

create or replace function public.prepare_merge() returns uuid
language plpgsql security definer set search_path = public as $$
declare tok uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  update profiles set merge_token = tok, merge_token_expires = now() + interval '10 minutes'
   where id = auth.uid();
  if not found then raise exception 'sign_in_required'; end if;
  return tok;
end $$;

create or replace function public.claim_merge(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me       uuid := auth.uid();
  old      profiles%rowtype;
  mine     profiles%rowtype;
  fresh    boolean;
  old_anon boolean;
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
  select coalesce(u.is_anonymous, false) into old_anon from auth.users u where u.id = old.id;
  old_anon := coalesce(old_anon, true);  -- no auth row any more: nothing to keep

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
    -- restore: the caller's data wins; the previous account keeps everything it had
    update profiles set merge_token = null, merge_token_expires = null where id in (me, old.id);
  end if;

  -- drop the previous account when its data moved here, or when it was anonymous
  -- (nothing to sign back into). A linked account that was merely *replaced* by an
  -- existing one stays, together with its Apple/Google identity.
  if fresh or old_anon then
    delete from auth.users where id = old.id;
  end if;

  return jsonb_build_object('merged', fresh, 'restored', not fresh);
end $$;

revoke all on function public.prepare_merge()    from public;
revoke all on function public.claim_merge(uuid)  from public;
grant execute on function public.prepare_merge()   to authenticated;
grant execute on function public.claim_merge(uuid) to authenticated;
