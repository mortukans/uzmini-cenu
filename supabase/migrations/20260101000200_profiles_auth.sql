-- 03 profiles (on top of auth.users), sign-up trigger, push tokens/tickets

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  avatar       text,
  lang         text not null default 'lv',
  is_premium   boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint profiles_lang_chk check (lang in ('lv','ru','en'))
);
-- docs/05 adds then drops profiles.push_token; we never add it (push_tokens below).
-- Usernames are unique case-insensitively (set_username stores lower-case; the
-- index also protects against direct updates through RLS).
create unique index profiles_username_lower_idx on public.profiles (lower(username));

-- Every account is a device-unique anonymous Supabase user. The trigger gives it a
-- placeholder 'player_xxxxxx' name; social features need a chosen one (set_username).
-- profile row auto-created on sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'player_' || left(replace(new.id::text, '-', ''), 6))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- true while the profile still carries the trigger's placeholder (or no name at all)
create or replace function public.is_auto_username(p_username text) returns boolean
language sql immutable parallel safe as $$
  select p_username is null or p_username ~ '^player_[0-9a-f]{6}$'
$$;

-- choose / change the username: ^[a-z0-9_]{3,16}$, unique case-insensitively.
-- Raises username_invalid | username_taken. Granted in 15.
create or replace function public.set_username(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_username, '')));
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if v !~ '^[a-z0-9_]{3,16}$' or public.is_auto_username(v) then raise exception 'username_invalid'; end if;
  if exists (select 1 from profiles where lower(username) = v and id <> auth.uid()) then
    raise exception 'username_taken';
  end if;
  begin
    update profiles set username = v where id = auth.uid();
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  if not found then raise exception 'sign_in_required'; end if;
  return jsonb_build_object('username', v);
end $$;

-- multiple devices per user
create table public.push_tokens (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text primary key,                       -- ExponentPushToken[...]
  platform   text not null default 'ios',
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform_chk check (platform in ('ios','android'))
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.push_tickets (
  ticket_id  text primary key,
  token      text not null,
  event      text,
  sent_at    timestamptz not null default now(),
  checked    boolean not null default false
);
create index push_tickets_unchecked_idx on public.push_tickets (sent_at) where not checked;

-- upsert the caller's Expo push token
create or replace function public.register_push_token(p_token text, p_platform text default 'ios')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required'; end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception 'bad_token';
  end if;
  if p_platform not in ('ios','android') then raise exception 'bad_platform'; end if;
  insert into push_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), p_token, p_platform, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;
