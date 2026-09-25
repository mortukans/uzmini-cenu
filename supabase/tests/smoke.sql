-- Plain SQL smoke test (no pgTAP needed). Run against a fresh local stack:
--   supabase db reset && psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -f supabase/tests/smoke.sql
-- or paste into Studio's SQL editor. Every block raises on failure; success prints NOTICEs.
-- Requires seed.sql (categories, listings, today's daily set, dev token secret).

\set ON_ERROR_STOP on
begin;

-- ─── 1. score() table from docs/02: 0/5/10/25/50 % error -> 1000/670/449/135/18 ──
do $$
begin
  assert public.score(1000, 1000) = 1000, 'exact guess must score 1000';
  assert public.score(1050, 1000) = 670,  format('5%% off -> 670, got %s', public.score(1050, 1000));
  assert public.score(1100, 1000) = 449,  format('10%% off -> 449, got %s', public.score(1100, 1000));
  assert public.score(750, 1000)  = 135,  format('25%% off -> 135, got %s', public.score(750, 1000));
  assert public.score(1500, 1000) = 18,   format('50%% off -> 18, got %s', public.score(1500, 1000));
  assert public.score(1, 1000) = 0 and public.score(null, 1000) = 0 and public.score(500, 0) = 0, 'edge cases -> 0';
  assert public.score(1100, 1000, 4) = 670, 'k parameter must be honoured';
  assert public.grid_cell(1050, 1000) = '🟩' and public.grid_cell(1200, 1000) = '🟨' and public.grid_cell(2000, 1000) = '🟥', 'grid cells';
  raise notice 'score()/grid_cell(): ok';
end $$;

-- ─── 2. impersonate a user (creates auth.users row -> profile via trigger) ────
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'smoke1@example.test', '{"provider":"email","providers":["email"]}', '{}', false, now(), now())
on conflict (id) do nothing;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'smoke2@example.test', '{"provider":"email","providers":["email"]}', '{}', false, now(), now())
on conflict (id) do nothing;

do $$
begin
  assert (select count(*) from public.profiles where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')) = 2,
    'handle_new_user trigger must create profiles';
  raise notice 'profiles trigger: ok';
end $$;

-- auth.uid() reads request.jwt.claims ->> 'sub' (do not set request.jwt.claim.sub: it would win over later switches)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);

-- ─── 2b. set_username: format, uniqueness (case-insensitive), require_username gate ──
do $$
begin
  begin
    perform public.submit_daily();
    raise exception 'social RPC without a chosen username must fail';
  exception when others then
    assert sqlerrm in ('username_required', 'daily_not_ready'), format('expected username_required, got %s', sqlerrm);
  end;
  begin
    perform public.set_username('ab');
    raise exception 'short username must fail';
  exception when others then
    assert sqlerrm = 'username_invalid', format('expected username_invalid, got %s', sqlerrm);
  end;
  perform public.set_username('Smoke_One');
  assert (select username from public.profiles where id = auth.uid()) = 'smoke_one', 'username stored lower-case';
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true);
  begin
    perform public.set_username('SMOKE_ONE');
    raise exception 'duplicate username must fail';
  exception when others then
    assert sqlerrm = 'username_taken', format('expected username_taken, got %s', sqlerrm);
  end;
  perform public.set_username('smoke_two');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true);
  raise notice 'set_username: ok';
end $$;

-- ─── 3. token issue -> verify roundtrip, tamper, wrong user ──────────────────
do $$
declare tok text; payload jsonb; parts text[];
begin
  tok := private.issue_round_token(1, 'solo', null, null, interval '5 minutes');
  assert tok ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$', 'token must be b64url.b64url';
  payload := private.verify_round_token(tok);
  assert (payload ->> 'l')::bigint = 1 and payload ->> 'c' = 'solo' and (payload ->> 'u')::uuid = auth.uid(), 'payload roundtrip';
  assert length(payload ->> 'n') = 6, 'nonce is 6 hex chars';

  parts := string_to_array(tok, '.');
  begin
    perform private.verify_round_token(parts[1] || '.' || 'AAAA' || substr(parts[2], 5));
    raise exception 'tampered signature must fail';
  exception when others then
    assert sqlerrm = 'bad_token', format('expected bad_token, got %s', sqlerrm);
  end;

  begin
    perform private.verify_round_token(private.issue_round_token(1, 'solo', null, null, interval '-1 minute'));
    raise exception 'expired token must fail';
  exception when others then
    assert sqlerrm = 'token_expired', format('expected token_expired, got %s', sqlerrm);
  end;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  begin
    perform private.verify_round_token(tok);
    raise exception 'other user token must fail';
  exception when others then
    assert sqlerrm = 'bad_token', format('expected bad_token for wrong user, got %s', sqlerrm);
  end;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  raise notice 'token roundtrip: ok';
end $$;

-- ─── 4. get_rounds shape + submit_guess + single use ─────────────────────────
do $$
declare rounds jsonb; r jsonb; res jsonb; k text;
begin
  rounds := public.get_rounds('all', null, 5);
  assert jsonb_typeof(rounds) = 'array', 'get_rounds returns an array';
  assert jsonb_array_length(rounds) = 5, format('expected 5 rounds, got %s', jsonb_array_length(rounds));
  r := rounds -> 0;
  for k in select unnest(array['id','category','region','location','attributes','title_hint','photo_urls','source','source_url','token']) loop
    assert r ? k, format('round is missing key %s', k);
  end loop;
  assert not (r ? 'price_eur'), 'PRICE LEAK: get_rounds must not include price_eur';
  assert jsonb_array_length(r -> 'photo_urls') >= 1, 'photos present';

  res := public.submit_guess(r ->> 'token', 50000, 1234);
  for k in select unnest(array['price_eur','score','guess_eur','source_url']) loop
    assert res ? k, format('submit_guess result missing %s', k);
  end loop;
  assert (res ->> 'score')::int = public.score(50000, (res ->> 'price_eur')::int), 'score matches score()';

  begin
    perform public.submit_guess(r ->> 'token', 50000, null);
    raise exception 'second submit must fail';
  exception when others then
    assert sqlerrm = 'already_answered', format('expected already_answered, got %s', sqlerrm);
  end;

  begin
    perform public.get_rounds('all', null, 21);
    raise exception 'n > 20 must fail';
  exception when others then
    assert sqlerrm = 'bad_n', format('expected bad_n, got %s', sqlerrm);
  end;
  raise notice 'get_rounds/submit_guess: ok';
end $$;

-- ─── 5. daily: shape, 5 guesses, submit, leaderboard ─────────────────────────
do $$
declare d jsonb; r jsonb; res jsonb; rk int;
begin
  d := public.get_daily();
  assert (d ->> 'day')::date = (now() at time zone 'Europe/Riga')::date, 'daily day';
  assert jsonb_array_length(d -> 'rounds') = 5, 'daily has 5 rounds';
  assert (d ->> 'already_played')::boolean = false, 'not yet played';
  for r in select * from jsonb_array_elements(d -> 'rounds') loop
    assert not (r ? 'price_eur'), 'PRICE LEAK in daily snapshot';
    perform public.submit_guess(r ->> 'token', 10000, null);
  end loop;
  res := public.submit_daily();
  assert res ? 'total' and res ? 'grid' and res ? 'share_text', 'submit_daily shape';
  assert length(res ->> 'grid') = 5, format('grid has 5 cells, got %s', res ->> 'grid');
  assert (public.get_daily() ->> 'already_played')::boolean, 'already_played after submit';
  assert (select count(*) from public.leaderboard('global', 'day')) >= 1, 'leaderboard has me';
  assert (select bool_or(is_me) from public.leaderboard('global', 'day')), 'is_me flag';
  rk := public.my_rank('global', 'day');
  assert rk = 1, format('my_rank should be 1, got %s', rk);
  raise notice 'daily: ok (total %, grid %)', res ->> 'total', res ->> 'grid';
end $$;

-- ─── 6. friends + duel: invite, accept, both guess -> round closes ───────────
do $$
declare u1 uuid := '00000000-0000-0000-0000-000000000001'; u2 uuid := '00000000-0000-0000-0000-000000000002';
        did uuid; toks jsonb; t jsonb; dr duels; n int;
begin
  perform public.request_friend(u2);
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u2), true);
  perform public.accept_friend(u1);
  assert public.is_friend(u1), 'friendship accepted';

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u1), true);
  did := (public.invite_duel(u2, 'all') ->> 'duel_id')::uuid;
  assert (select count(*) from context_prices where context_type = 'duel' and context_id = did::text) = 5, 'duel prices snapshotted';
  assert not exists (select 1 from jsonb_array_elements((select snapshot from duels where id = did)) e where e ? 'price_eur'), 'PRICE LEAK in duel snapshot';

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u2), true);
  toks := public.accept_duel(did);
  assert jsonb_array_length(toks) = 5, 'accept returns 5 tokens';
  select * into dr from duels where id = did;
  assert dr.status = 'live' and dr.current_round = 1 and dr.round_deadline is not null, 'duel live';
  perform public.submit_guess(toks -> 0 ->> 'token', 12345, null);
  select * into dr from duels where id = did;
  assert dr.current_round = 1, 'one guess does not close the round';

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u1), true);
  toks := public.duel_tokens(did);
  perform public.submit_guess(toks -> 0 ->> 'token', 54321, null);
  select * into dr from duels where id = did;
  assert dr.current_round = 2, format('both guessed -> round 2, got %s', dr.current_round);
  assert dr.results ? '1' and (dr.results -> '1') ? u1::text and (dr.results -> '1') ? u2::text, 'results.1 has both';
  assert dr.scores ? u1::text, 'scores cache updated';

  -- late guess: force the deadline into the past, next write closes round 2 -> round_closed for a round-2 token
  update duels set round_deadline = now() - interval '10 seconds' where id = did;
  begin
    perform public.submit_guess(toks -> 1 ->> 'token', 1000, null);
    raise exception 'late guess must fail';
  exception when others then
    assert sqlerrm in ('round_closed', 'too_late'), format('expected round_closed/too_late, got %s', sqlerrm);
  end;
  select * into dr from duels where id = did;
  assert dr.current_round = 3, format('overdue round 2 closed on next write, now %s', dr.current_round);
  raise notice 'duel: ok';
end $$;

-- ─── 7. room: create, join, start, tokens, sweep ────────────────────────────
do $$
declare u1 uuid := '00000000-0000-0000-0000-000000000001'; u2 uuid := '00000000-0000-0000-0000-000000000002';
        rc text; toks jsonb; rr rooms; n int;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u1), true);
  rc := public.create_room('all', 5) ->> 'code';
  assert rc ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}$', 'room code shape';
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u2), true);
  perform public.join_room(lower(rc));
  assert (select count(*) from room_players where room_code = rc) = 2, 'two players';
  begin
    perform public.start_room(rc);
    raise exception 'non-host start must fail';
  exception when others then
    assert sqlerrm = 'not_host_or_not_lobby', format('expected not_host_or_not_lobby, got %s', sqlerrm);
  end;
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u1), true);
  perform public.start_room(rc);
  toks := public.room_tokens(rc);
  assert jsonb_array_length(toks) = 5, 'room tokens';
  perform public.submit_guess(toks -> 0 ->> 'token', 777, null);
  select * into rr from rooms where code = rc;
  assert rr.current_round = 1, 'waiting for second player';
  update rooms set round_deadline = now() - interval '10 seconds' where code = rc;
  n := private.sweep_deadlines();
  select * into rr from rooms where code = rc;
  assert rr.current_round = 2 and rr.results ? '1', format('sweep closed round 1 (n=%s)', n);
  raise notice 'room: ok';
end $$;

-- ─── 8. RLS: client role can not see listings / context_prices / others' duels ──
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  set local role authenticated;
  begin
    select count(*) into n from public.listings;
    raise exception 'authenticated must not select listings';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into n from public.context_prices;
    raise exception 'authenticated must not select context_prices';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.duels;     -- participant: sees the duel from step 6
  assert n = 1, format('u2 sees exactly its duel, got %s', n);
  reset role;
  raise notice 'rls: ok';
end $$;

select 'smoke test passed' as result;
rollback;   -- nothing persists
