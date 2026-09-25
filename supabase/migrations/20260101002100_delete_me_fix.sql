-- delete_me collided on guesses_once_idx: anonymised rows (user_id = null) of two deleted users
-- who answered the same daily listing are "equal" under NULLS NOT DISTINCT. Guesses are personal
-- data anyway, so account deletion now removes them; the index ignores anonymised rows.
drop index if exists public.guesses_once_idx;
create unique index guesses_once_idx
  on public.guesses (user_id, mode, context_id, listing_id, token_nonce) nulls not distinct
  where user_id is not null;

create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'sign_in_required'; end if;
  delete from guesses where user_id = me;
  delete from daily_results where user_id = me;
  delete from friendships where user_id = me or friend_id = me;
  delete from friend_stats where user_id = me or friend_id = me;
  delete from push_tokens where user_id = me;
  delete from room_players where user_id = me;
  update rooms set status = 'finished', finished_at = now() where host = me and status <> 'finished'
    and not exists (select 1 from room_players rp where rp.room_code = rooms.code);
  update duels set status = 'expired', finished_at = now()
    where (challenger = me or opponent = me) and status in ('invited','live');
  update duels set challenger = null where challenger = me;
  update duels set opponent   = null where opponent   = me;
  delete from profiles where id = me;
  delete from auth.users where id = me;   -- ends the session
end $$;
grant execute on function public.delete_me() to authenticated;
