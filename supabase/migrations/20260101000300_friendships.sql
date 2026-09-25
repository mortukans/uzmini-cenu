-- 04 friendships + friend RPCs
-- A friendship is a single row (requester -> friend). Accepted rows are
-- symmetric in meaning; is_friend() checks both directions.

create table public.friendships (
  user_id    uuid not null references public.profiles (id) on delete cascade,   -- requester
  friend_id  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending',                                   -- pending | accepted
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_not_self_chk check (user_id <> friend_id),
  constraint friendships_status_chk check (status in ('pending','accepted'))
);
create index friendships_friend_idx on public.friendships (friend_id, status);

-- RPC wrappers (the app uses these instead of raw inserts so we can rate-limit + push).
-- require_username / check_rate / notify are defined in 09; plpgsql resolves them at call time.

create or replace function public.request_friend(p_friend uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare existing friendships;
begin
  perform private.require_username();
  if p_friend = auth.uid() then raise exception 'self_friend'; end if;
  if not exists (select 1 from profiles where id = p_friend) then raise exception 'user_not_found'; end if;
  perform private.check_rate('friend_request', 20);

  -- already friends or they asked first -> accept instead of duplicating
  select * into existing from friendships where user_id = p_friend and friend_id = auth.uid();
  if existing.user_id is not null then
    if existing.status = 'pending' then
      update friendships set status = 'accepted' where user_id = p_friend and friend_id = auth.uid();
    end if;
    return;
  end if;

  insert into friendships (user_id, friend_id, status) values (auth.uid(), p_friend, 'pending')
  on conflict (user_id, friend_id) do nothing;
  perform private.notify('friend_request', jsonb_build_object('from', auth.uid(), 'to', p_friend));
end $$;

create or replace function public.accept_friend(p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.require_username();
  update friendships set status = 'accepted'
  where user_id = p_friend and friend_id = auth.uid() and status = 'pending';
  if not found then raise exception 'no_pending_request'; end if;
end $$;

create or replace function public.remove_friend(p_friend uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  delete from friendships
  where (user_id = auth.uid() and friend_id = p_friend) or (user_id = p_friend and friend_id = auth.uid());
end $$;

-- {user_id, username, avatar, status: 'pending_in' | 'pending_out' | 'accepted'}[]
create or replace function public.list_friends()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', x.other, 'username', p.username, 'avatar', p.avatar, 'status', x.st)
           order by x.st, p.username), '[]'::jsonb)
  from (
    select case when f.user_id = auth.uid() then f.friend_id else f.user_id end as other,
           case when f.status = 'accepted' then 'accepted'
                when f.user_id = auth.uid() then 'pending_out'
                else 'pending_in' end as st
    from friendships f
    where auth.uid() is not null and (f.user_id = auth.uid() or f.friend_id = auth.uid())
  ) x
  join profiles p on p.id = x.other
$$;
