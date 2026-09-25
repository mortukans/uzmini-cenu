# 06 Multiplayer

Both duel and party room use the same pattern: a Postgres row is the source
of truth, Supabase Realtime broadcasts row changes, clients react. No custom
game server.

## Duel (1v1)

```
challenger                Supabase                     opponent
   │ invite_duel(opp) ───▶ insert duels(status=invited)
   │                        └─ edge fn: push "X challenges you"
   │                                                     │ taps push
   │                        update status=live  ◀────────┤ accept
   │◀── realtime: live ─────┘
   │ round 1 guess ───▶ submit_guess(duel, r1)           │ round 1 guess
   │                        both guesses for r1 present? │
   │◀── realtime: scores.r1 updated ────────────────────▶│
   │  (reveal screen shows both guesses + prices)        │
   ... rounds 2-5 ...
   │                        status=finished, push result to both
```

Rules:
- Each round waits for both players or 30 s, whichever first. Timer runs on
  the client but the reveal is authoritative from the server row.
- If opponent does not accept in 24 h, the challenger's completed guesses
  stand and the duel becomes async: the opponent can still play later and
  the result push goes out when done. `status = expired` after 7 days.
- Rematch button creates a new duel with roles swapped.

### Sequence: accept (happy path)

```
challenger (C)            Postgres / Realtime / Edge            opponent (O)
──────────────────────────────────────────────────────────────────────────────
C: rpc invite_duel(O) ──▶ insert duels {status: invited}
                          insert context_prices (5 rows)
                          pg_net ─▶ send-push {duel_invite} ─▶ Expo ─▶ APNs ─▶ O
C: subscribe duel:{id}
C: screen = WAITING_ACCEPT (shows "waiting for O", 24 h hint)
                                                              O: taps push (cold start)
                                                              O: route /duel/{id}
                                                              O: select duels_public where id
                                                              O: screen = INVITED (accept/decline)
                                                              O: rpc accept_duel(id)
                          update duels {status: live, current_round: 1,
                                        round_deadline: now+30s}
                          pg_net ─▶ send-push {duel_accepted} ─▶ C (only if C backgrounded)
                          returns duel_tokens to O
C ◀── postgres_changes UPDATE (status=live) ── Realtime ──▶ O (own change, ignored)
C: rpc duel_tokens(id)
C: screen = ROUND(1)                                          O: screen = ROUND(1)
C: submit_guess(tok r1, 61000)
                          insert guesses; trigger: 1 of 2 answered -> no-op
C: screen = ROUND_WAITING(1)  (shows "O is thinking", local 30 s bar)
C ── broadcast {type:'guessed', round:1} ──▶ O   (ephemeral "C has guessed" pill)
                                                              O: submit_guess(tok r1, 55000)
                          insert guesses; trigger: 2 of 2 -> close_round('duel')
                          update duels {results.1: {...}, scores, current_round: 2,
                                        round_deadline: now+35s}
C ◀── postgres_changes UPDATE ──────────────────────────────▶ O
C: screen = REVEAL(1) 5 s  ─▶ ROUND(2)                        O: same
... rounds 2-5 ...
                          close_round: status=finished, finished_at
                          pg_net ─▶ send-push {duel_finished} ─▶ C and O (if backgrounded)
C: screen = RESULT (rematch)                                   O: screen = RESULT
```

### Sequence: decline

```
C: invite_duel(O) ──▶ insert {invited}; push ─▶ O
C: WAITING_ACCEPT
                                                O: taps push, sees INVITED
                                                O: rpc decline_duel(id)
                     update duels {status: declined}   -- RLS: opponent may set invited -> declined
                     pg_net ─▶ send-push {duel_declined} ─▶ C (silent if C is foregrounded on the screen)
C ◀── postgres_changes UPDATE (status=declined)
C: screen = DECLINED ("O is busy. Play solo / invite someone else")
C: rate_limits: declined duels do NOT refund the daily quota (prevents spam-by-decline)
```

`decline_duel` is a plain `update duels set status='declined' where id=$1
and opponent=auth.uid() and status='invited'` behind the RLS policy in 05;
no RPC needed, but wrapped in one for the push and analytics.

### Sequence: expire / async

```
t=0        C: invite_duel(O); push ─▶ O. C may play immediately? No: in sync mode rounds
           only open on accept. C sees WAITING_ACCEPT and may leave the screen.
t=24 h     sweep_deadlines: update duels set async=true where status='invited'
           and created_at < now()-24h        -- status stays 'invited'
           pg_net ─▶ send-push {duel_async} ─▶ C: "O hasn't answered. Play your 5 rounds now,
           they can catch up later."
C: opens duel, rpc duel_tokens(id) (TTL 7 d), plays 5 rounds via submit_guess.
           submit_guess skips the deadline check when duels.async = true
           trigger: 1 of 2 answered per round -> no close; results stay hidden.
C: screen = WAITING_OPPONENT_ASYNC ("your 4,210 pts are locked in")
t=3 d      O: opens push / friends tab, sees "pending duel from C", accept_duel(id)
           -> status live, async=true, no deadlines. O plays 5 rounds at own pace.
           after O's round 5 insert: trigger sees 2 of 2 for every round -> close_round runs
           for rounds 1..5 in a loop (close_round is called per round until current_round=5)
           status=finished; push {duel_finished} ─▶ C and O
t=7 d      (if O never accepted) sweep: status='expired'; push {duel_expired} ─▶ C;
           C's guesses remain in `guesses` for stats; results never revealed.
```

Reveal in async mode: each player sees their own guess/price immediately
after each round (from `submit_guess`); the opponent's guesses appear only
at the final RESULT screen when both are done.

## Party room

- `create_room` returns a 4-letter code (consonants only to avoid words, e.g.
  `KTRP`) and a share link `uzminicenu.lv/r/KTRP` (universal link).
- Lobby screen subscribes to `room_players` for the code and shows avatars
  joining live.
- Host presses start: `rooms.status = live, current_round = 1`. All clients
  render round 1 from `snapshot[0]`.
- Guesses via `submit_guess(room, round)`. A Postgres trigger advances
  `current_round` when all players have guessed; a 30 s server-side deadline
  (`round_deadline`, checked by pg_cron every 5 s or on the next write)
  advances if someone is idle.
- Between rounds a 5 s scoreboard, then next round. End screen: podium,
  "play again" keeps the room and players.

### Sequence: room

```
host (H)                      Postgres / Realtime                 players (P1..Pn)
H: create_room(cars, 5) ──▶ insert rooms {lobby}, context_prices, room_players(H)
H: subscribe room:KTRP (postgres_changes + presence + broadcast)
H: share link uzminicenu.lv/r/KTRP
                                                                   P1: universal link -> /room/KTRP
                                                                   P1: join_room(KTRP) -> insert room_players
H ◀── postgres_changes INSERT room_players ──────────────────────  P1: subscribe room:KTRP, presence.track
H: lobby shows P1 avatar (from row) + green dot (from presence)
H: start_room(KTRP)  ──▶ update rooms {live, current_round 1, deadline now+30s}
H ◀── UPDATE ───────────────────────────────────────────────────▶ P1..Pn
all: rpc room_tokens(KTRP); screen = ROUND(1); local 30 s bar from round_deadline - now()
each: submit_guess(tok r1, x)  ──▶ trigger counts answered vs players seen <60 s
                                    all answered -> close_round -> UPDATE rooms {results.1, current_round 2,
                                                                                deadline now+35s}
                                    else idle player -> sweep or next write closes at deadline+3s
all ◀── UPDATE ──▶ screen = SCOREBOARD(1) for 5 s (deadline - 30 s), then ROUND(2)
... after round 5: status=finished ─▶ PODIUM
H: "play again" -> rpc replay_room(KTRP): new listings, current_round 0, status lobby, totals 0
```

## Realtime channel design

- One channel per duel / room: `duel:{id}`, `room:{code}`.
- Postgres Changes for state (rows). Broadcast for ephemeral things
  like "opponent is typing" or emoji reactions.
- Presence on the room channel to detect disconnects and show who is online.

### Authorization

Broadcast and Presence topics are gated by Realtime Authorization
(`realtime.messages` RLS). Channels are created with `config: { private: true }`
and the client's JWT.

```sql
create policy duel_channel_read on realtime.messages for select to authenticated
using (
  realtime.topic() like 'duel:%'
  and exists (select 1 from duels d where d.id::text = split_part(realtime.topic(), ':', 2)
              and auth.uid() in (d.challenger, d.opponent))
  and realtime.messages.extension in ('broadcast', 'presence')
);
create policy duel_channel_write on realtime.messages for insert to authenticated
with check ( /* same predicate */ );
create policy room_channel_read on realtime.messages for select to authenticated
using (
  realtime.topic() like 'room:%'
  and public.in_room(split_part(realtime.topic(), ':', 2))
  and realtime.messages.extension in ('broadcast', 'presence')
);
create policy room_channel_write on realtime.messages for insert to authenticated
with check ( /* same predicate */ );
```

Postgres Changes are gated by the table RLS from 05 (`duels_read`,
`rooms_read`, `room_players_read`).

### Duel subscription (TypeScript)

```ts
// src/realtime/useDuelChannel.ts
import { useEffect } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import { useDuelStore } from '@/game/duelStore';
import type { Database } from '@/api/database.types';

type DuelRow = Database['public']['Tables']['duels']['Row'];
type DuelBroadcast =
  | { type: 'guessed'; round: number; userId: string }
  | { type: 'emoji'; emoji: string; userId: string }
  | { type: 'typing'; userId: string };

export function useDuelChannel(duelId: string, myId: string) {
  const apply = useDuelStore((s) => s.applyRow);
  const onPeer = useDuelStore((s) => s.onPeerEvent);

  useEffect(() => {
    let channel: RealtimeChannel | undefined;

    (async () => {
      // 1. hydrate from the price-free view, then subscribe (order matters: never miss the gap)
      channel = supabase.channel(`duel:${duelId}`, { config: { private: true, broadcast: { self: false } } });

      channel
        .on<DuelRow>('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'duels', filter: `id=eq.${duelId}` },
          (payload) => apply(payload.new))
        .on('broadcast', { event: 'peer' }, ({ payload }) => onPeer(payload as DuelBroadcast))
        .subscribe(async (status, err) => {
          if (status === 'SUBSCRIBED') {
            // refetch after (re)subscribe: covers events missed while offline
            const { data } = await supabase.from('duels_public').select('*').eq('id', duelId).single();
            if (data) apply(data as DuelRow);
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            useDuelStore.getState().setConnection('reconnecting');
          }
        });
    })();

    return () => { channel && supabase.removeChannel(channel); };
  }, [duelId]);

  const send = (msg: DuelBroadcast) =>
    supabase.channel(`duel:${duelId}`).send({ type: 'broadcast', event: 'peer', payload: { ...msg, userId: myId } });

  return { send };
}
```

Note that `postgres_changes` `filter` supports a single `eq` per
subscription, which is enough here. The `snapshot` column arrives in the
row but is price-free (prices live in `context_prices`, see 05).

### Room subscription (TypeScript)

```ts
// src/realtime/useRoomChannel.ts
type RoomRow = Database['public']['Tables']['rooms']['Row'];
type PlayerRow = Database['public']['Tables']['room_players']['Row'];
type PresenceMeta = { userId: string; username: string; avatar: string | null; at: number };

export function useRoomChannel(code: string, me: PresenceMeta) {
  const store = useRoomStore;

  useEffect(() => {
    const channel = supabase.channel(`room:${code}`, {
      config: { private: true, presence: { key: me.userId }, broadcast: { self: true, ack: false } },
    });

    channel
      .on<RoomRow>('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
        ({ new: row }) => store.getState().applyRoom(row))
      .on<PlayerRow>('postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${code}` },
        ({ eventType, new: row, old }) => {
          if (eventType === 'DELETE') store.getState().removePlayer((old as PlayerRow).user_id);
          else store.getState().upsertPlayer(row as PlayerRow);
        })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceMeta>();
        store.getState().setOnline(Object.keys(state));     // keys are userIds
      })
      .on('presence', { event: 'leave' }, ({ key }) => store.getState().markOffline(key))
      .on('broadcast', { event: 'reaction' }, ({ payload }) => store.getState().pushReaction(payload))
      .on('broadcast', { event: 'guessed' }, ({ payload }) => store.getState().markGuessed(payload.userId))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ ...me, at: Date.now() });
          const [{ data: room }, { data: players }] = await Promise.all([
            supabase.from('rooms_public').select('*').eq('code', code).single(),
            supabase.from('room_players').select('*').eq('room_code', code),
          ]);
          if (room) store.getState().applyRoom(room as RoomRow);
          if (players) store.getState().setPlayers(players);
        }
      });

    // heartbeat so the trigger's "seen in last 60 s" count is accurate; presence alone is not in Postgres
    const hb = setInterval(() =>
      supabase.from('room_players').update({ last_seen: new Date().toISOString() })
        .eq('room_code', code).eq('user_id', me.userId), 20_000);

    return () => { clearInterval(hb); supabase.removeChannel(channel); };
  }, [code]);

  return {
    react: (emoji: string) => supabase.channel(`room:${code}`)
      .send({ type: 'broadcast', event: 'reaction', payload: { userId: me.userId, emoji } }),
  };
}
```

Presence is for the UI (green dots, "3/5 online"); the server-side
`last_seen` heartbeat is what the round-advance trigger trusts, since
Postgres cannot see Presence.

## Client state machines

Implemented as a Zustand store with a `state` discriminant and pure
transition functions in `src/game/`, unit-tested without React.

### Duel screen

```
                 ┌──────────┐  row.status=invited & me=opponent
  open /duel/id ─▶ LOADING  ├──────────────────────────────────▶ INVITED ──accept──▶ (rpc) ─┐
                 └────┬─────┘                                       │ decline               │
                      │ me=challenger & invited                     ▼                        │
                      ├───────────────────────────────▶ WAITING_ACCEPT ──row.live──▶ ROUND(n) ◀┘
                      │ row.declined                                │ row.async               ▲
                      ├──────────────▶ DECLINED                      ▼                        │
                      │ row.expired                            ROUND_ASYNC(n) ─5 done─▶ WAITING_OPPONENT_ASYNC
                      ├──────────────▶ EXPIRED
                      │ row.finished
                      ├──────────────▶ RESULT ◀────────────── row.finished ◀───────────────┐
                      │ row.live                                                           │
                      └──────────────▶ ROUND(n) ──guess sent──▶ ROUND_WAITING(n)            │
                                          ▲                          │ row.current_round=n+1 │
                                          │                          │ or results[n] present │
                                          │                          ▼                        │
                                          └──── 5 s / tap ────── REVEAL(n) ── n=5 ───────────┘

  any state ── app background ──▶ SUSPENDED ── foreground ──▶ LOADING (refetch row, rehydrate)
  any state ── channel error ──▶ same state + connection='reconnecting' banner
```

Guards:
- `ROUND(n)` shows `snapshot[n-1]`, local countdown from
  `row.round_deadline` (server time; correct for clock skew using the
  `Date` header of the last RPC response, stored as `serverOffsetMs`).
- Local timer hitting zero does **not** change state. It disables input
  and shows "waiting for server"; the row update moves to `REVEAL`.
- `already_answered` from `submit_guess` (double tap / retry) transitions
  to `ROUND_WAITING` as if the guess succeeded.
- `too_late` transitions to `ROUND_WAITING` with a "0 points" pill; the
  server will close the round on the sweep.
- `REVEAL(n)` reads `results[n]` (both guesses) and `scores`.

### Room screen

```
  open /room/CODE ─▶ LOADING ─┬─ not a member ─▶ JOINING (rpc join_room) ─▶ LOBBY
                              ├─ row.lobby ────▶ LOBBY (host: start button when players>=2)
                              ├─ row.live ─────▶ ROUND(current_round) or SCOREBOARD if results[n] exists and deadline-now > 30 s
                              └─ row.finished ─▶ PODIUM ── host "play again" ──▶ LOBBY

  LOBBY ── row.live ──▶ ROUND(1) ── guess ──▶ ROUND_WAITING(n) ── row.current_round=n+1 ──▶ SCOREBOARD(n)
                                                                 ── row.finished ──────────▶ PODIUM
  SCOREBOARD(n) ── deadline - 30 s reached ──▶ ROUND(n+1)
  any ── room_players DELETE me ──▶ KICKED/LEFT ──▶ home
  any ── row.host changed to me ──▶ same state + host controls
```

The 5 s scoreboard is derived, not stored: `close_round` sets the next
deadline to `now + 35 s`, so clients show the scoreboard while
`deadline - now > 30 s` and the round while `<= 30 s`. One server
timestamp drives both phases.

## Server-side round deadline mechanism

Options considered:

| Option | How | Pros | Cons |
|--------|-----|------|------|
| A. pg_cron sweep | `cron.schedule('5 seconds', sweep_deadlines())` | zero extra infra, runs inside Postgres, survives everyone disconnecting | 5 s granularity (deadline+3 s grace becomes up to +8 s); pg_cron seconds-level schedules need Supabase's pg_cron >= 1.5 (available); a sweep every 5 s forever, even with zero games |
| B. Edge Function scheduler | cron-triggered function or a long-running Deno loop | can be 1 s precise | Edge Functions have no persistent loop; cron minimum is 1 min; cold starts; another moving part |
| C. Advance on next write | any `submit_guess`/`heartbeat`/`poll` on the context first runs `close_round` if `round_deadline + 3 s < now()` | exact, no background work, zero cost when idle | if every remaining client is silent, nothing advances; needs the client to poke the server when its local timer fires |

**Recommendation: C as primary, A as backstop.**

- `submit_guess`, `room_tokens`, `duel_tokens` and a tiny
  `poke(ctx, id)` RPC all start with
  `perform private.maybe_close_expired(ctx, id)`.
- The client calls `poke` when its local countdown reaches 0 (+ jitter
  0-500 ms so ten players in a room do not hit the same millisecond; the
  `for update` lock in `close_round` makes duplicates harmless).
- pg_cron `sweep_deadlines()` every **10 s** catches the case where all
  clients backgrounded mid-round or the last active player's poke was lost.
  Worst case for an abandoned room is a 13 s stall, which nobody is
  watching anyway.
- Cost: the sweep is one indexed query on `rooms_open_idx` /
  `duels_open_idx`; at zero live games it does nothing.
- If Supabase's pg_cron on the project cannot do seconds-level schedules,
  fall back to `'* * * * *'` (1 min) for the backstop; C still gives the
  exact behaviour for anyone actually present.

```sql
create or replace function private.maybe_close_expired(p_ctx text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ctx = 'room' and exists (select 1 from rooms where code = p_id and status = 'live'
                                and round_deadline + interval '3 seconds' < now())
  then perform private.close_round('room', p_id); end if;
  if p_ctx = 'duel' and exists (select 1 from duels where id = p_id::uuid and status = 'live' and not async
                                and round_deadline + interval '3 seconds' < now())
  then perform private.close_round('duel', p_id); end if;
end $$;

create or replace function public.poke(p_ctx text, p_id text) returns void
language sql security definer set search_path = public as $$ select private.maybe_close_expired(p_ctx, p_id) $$;
```

## Conflict and race cases

| Case | What happens | Resolution |
|------|--------------|------------|
| Both duel guesses arrive in the same millisecond | two `submit_guess` transactions insert concurrently; both triggers count `answered`; one may see 1, the other 2, or both see 2 | `close_round` takes `select ... for update` on the duel row, so the second caller blocks, then re-reads `current_round`; if the round already advanced (`rno` moved) the `results || {rno: ...}` merge is idempotent for the same key. Add `and not (results ? rno::text)` guard so a second close is a no-op. Neither client sees a double reveal because Realtime delivers the final row state |
| Both see `answered = 1` (read-committed anomaly) | round does not close although 2 guesses exist | the deadline sweep / next poke closes it within 3-13 s; also `submit_guess` re-checks `answered` after insert inside the trigger which runs post-insert in the same transaction, so at least the later committer sees 2 in practice |
| Guess arrives after close (late by network) | `submit_guess` finds `current_round <> rno` | raises `round_closed`; client shows 0 for that round; the trigger never fires for it. If it arrives within the 3 s grace and the round is still open it counts |
| Host disconnects during a live room round | Presence `leave` fires within ~30 s; `last_seen` heartbeat stops | room continues: the trigger only counts players seen in the last 60 s, so the round closes without the host; after 60 s of silence a trigger on `room_players` UPDATE of `last_seen` (or the sweep) runs `handover_host()`: oldest `joined_at` among players seen in last 60 s becomes `rooms.host`. The old host rejoining is a normal player. Nothing about the game depended on the host after `start_room` |
| Host disconnects in lobby | nobody can start | same handover after 60 s; lobby shows "KTRP is now hosted by Anna" |
| Player joins after start | `join_room` raises `room_already_started` | client offers "watch" (subscribe read-only; RLS blocks since not in `room_players`) — v1: show "Game in progress, ask for a new code". v1.1: spectator flag row in `room_players` with `spectator=true`, excluded from the trigger count |
| Player leaves mid-round (delete own `room_players` row) | trigger count drops; possibly all remaining have answered | `on_guess_inserted` only runs on insert, so the round may hang until the deadline; add the same close check to an AFTER DELETE trigger on `room_players`. Their guesses stay in `guesses`; `results` shows them for rounds they played |
| Opponent accepts twice (double tap, two devices) | second `accept_duel` finds status already `live` | raises `duel_not_invited`; client treats as success and loads the row |
| Challenger deletes account while invited | `delete_me` sets status `expired`, `challenger = null` | opponent's screen shows EXPIRED with "player left" |
| Rematch spam | each rematch is an `invite_duel` | counts against the 3/day free quota |
| Duplicate room code | `create_room` checks non-finished rooms; codes recycle once finished | finished rooms keep their code for 30 days but `join_room` rejects them, so a stale link says "room ended" |
| Clock skew on device | local timer wrong by seconds | all deadlines shown as `deadline - (Date.now() + serverOffsetMs)`; server rejects by its clock only |
| Realtime message lost (offline blip) | client misses the UPDATE | on `SUBSCRIBED` after reconnect and on app foreground the row is refetched; the state machine is a pure function of the row + local input, so replay is safe |
| Two rooms, same player | allowed technically | client blocks: "you are already in KTRP"; `join_room` allows it so a stuck client can move on |
| Deadline passes with zero guesses in a room round | `close_round` writes `results[n] = {}` | scoreboard shows all 0, round advances; a room with two consecutive empty rounds is auto-finished by the sweep (abandoned) |

## Push notification payloads

All pushes are sent by the `send-push` Edge Function via
`https://exp.host/--/api/v2/push/send`. `data` is what the app routes on
(see 04, deep link on cold start). Titles/bodies are localised by the
function using the recipient's `profiles.lang`; Latvian shown.

| Event | Trigger | To | title / body (lv) | `data` |
|-------|---------|----|-------------------|--------|
| `duel_invite` | `invite_duel` | opponent | "Mārtiņš izaicina tevi!" / "Uzmini 5 cenas ātrāk un precīzāk. Spēlēsim?" | `{ type:'duel_invite', duelId, fromUserId, fromName, url:'uzminicenu://duel/<id>' }` |
| `duel_accepted` | `accept_duel` | challenger, only if not present on channel (check Presence via `realtime` REST or a `last_seen` on `duels`) | "Anna pieņēma izaicinājumu" / "1. raunds sākas tagad" | `{ type:'duel_accepted', duelId, url }` |
| `duel_declined` | `decline_duel` | challenger | "Anna šobrīd nevar" / "Izaicini kādu citu vai spēlē solo" | `{ type:'duel_declined', duelId }` |
| `duel_async` | sweep at 24 h | challenger | "Anna vēl nav atbildējusi" / "Izspēlē savus 5 raundus tagad, rezultāts atnāks, kad Anna pabeigs" | `{ type:'duel_async', duelId, url }` |
| `duel_your_turn` | sweep every 24 h while async & opponent has not finished | opponent | "Mārtiņš gaida tavu minējumu" / "Duelis beidzas pēc 3 dienām" | `{ type:'duel_invite', duelId, url }` (same route) |
| `duel_finished` | `close_round` final | both, whoever is not on the screen | "Tu uzvarēji! 4 210 : 3 880" or "Anna uzvarēja 3 880 : 4 210" / "Revanšs?" | `{ type:'duel_result', duelId, url }` |
| `duel_expired` | sweep at 7 d | challenger | "Duelis ar Annu beidzās bez atbildes" | `{ type:'duel_expired', duelId }` |
| `room_invite` | host taps "invite friends" in lobby (`invite_to_room(code, friend_ids[])`) | friends | "Mārtiņš atvēra istabu KTRP" / "Pievienojies, spēle sāksies drīz" | `{ type:'room_invite', code, url:'uzminicenu://room/KTRP' }` |
| `friend_request` | insert `friendships` (webhook) | friend | "Anna vēlas būt tavs draugs" | `{ type:'friend_request', fromUserId }` |
| `daily_ready` | `build-daily` at 00:05 Riga, only for users who opted in | opted-in users | "Šodienas 5 cenas gaida" / "Uzmini Cenu #38" | `{ type:'daily', day }` |

Expo message fields used: `to`, `title`, `body`, `data`, `sound: 'default'`
for invites, `sound: null` for results, `badge` untouched, `priority:
'high'` for `duel_invite`/`duel_accepted`, `channelId: 'duels'` (Android
later), `expiration: created_at + 24 h` for invites so a phone that was off
for a day does not buzz about a duel that already went async,
`categoryId: 'duel_invite'` with Accept / Decline action buttons
(`Notifications.setNotificationCategoryAsync`) so the opponent can accept
from the lock screen; the action handler calls `accept_duel` in the
background and the app opens on ROUND(1).

Suppression rule: the function skips a push when the recipient has a
Presence entry on the relevant channel within the last 15 s (the client
also writes `last_seen` on `room_players`; for duels it is in a small
`duel_presence (duel_id, user_id, last_seen)` heartbeat every 20 s while
on the screen). Not perfect, good enough to avoid buzzing someone who is
staring at the reveal.

## Rate limits

Enforced in RPCs via `private.check_rate` (daily windows in
`Europe/Riga`), with premium overrides:

| Action | Free | Premium | Why |
|--------|------|---------|-----|
| `invite_duel` | 3 / day (declined ones count) | 100 / day | monetisation lever (07) + spam control |
| Open duels per pair | 1 | 1 | prevents invite pile-up |
| Open duels total per user | 10 | 30 | |
| `create_room` | 20 / day | 50 / day | cheap, but codes are finite |
| Room size | 10 players (`join_room` check) | 10 | UI (avatars row) and trigger cost |
| Room rounds | 5 or 10 | 5, 10, 15 | |
| `join_room` attempts | 30 / hour | same | brute-forcing 160k codes is pointless but cheap to block |
| Broadcast messages | 10 / s per client (Realtime `eventsPerSecond`) | same | emoji spam |
| `friend_request` | 20 / day | same | |
| `get_rounds` | 60 calls / hour | same | scraping our listings via the API |
| `get_offline_pack` | 3 / hour | 10 / hour | prices ship to the client in this one |
| Anonymous sign-ups | Supabase Auth default (30 / hour per IP) | | |

Realtime connection budget (Supabase Pro: 500 concurrent by default, more
on request): each player in a duel or room holds 1 connection with 1-2
channels. 10k MAU with 10% multiplayer sessions and ~2% concurrency is
~20-50 concurrent connections; comfortably within limits.

## Anti-cheat

- Prices never reach the client before the guess (see 04).
- Round token is single-use and bound to user + context.
- Server rejects guesses submitted after the round's deadline + 3 s grace.
- Opponents' guesses are not in any Realtime row until the round closes
  (`guesses` is not published; `results` is written by `close_round`).
- `time_ms` under 400 ms on a guess within 2% of the price on several
  rounds gets flagged (`suspicious` on `guesses`) for manual review; not
  auto-punished in v1.

## Failure handling

- Reconnect: on app foreground, refetch the duel/room row and resume from
  `current_round`.
- Host leaves a room: oldest remaining player becomes host (trigger).
- Listing vanished from portal mid-game: irrelevant, price and photos are
  snapshotted into the duel/room at creation.

## Test plan

No Mac means no two iOS simulators. Practical setup on Windows: the
physical iPhone (dev client) + an Android emulator (Android Studio, same
Expo dev client built with `eas build --platform android --profile development`)
+ a scripted Node client against local Supabase. Android is not shipping
in v1 but the JS is identical, and it doubles as the Phase 6 smoke test.

### Layer 1: pure logic (jest, no network)

- `score()` table from 02 (0%/5%/10%/25%/50% -> 1000/670/449/135/18).
- Duel and room state machine transitions: every arrow in the diagrams
  above as a `reduce(state, event)` test; property test that any sequence
  of row updates ends in a valid state.
- Countdown derivation from `round_deadline` and `serverOffsetMs`
  (scoreboard vs round phases).

### Layer 2: database (pgTAP via `supabase test db`)

`supabase/tests/*.sql`, run in CI against a fresh `db reset`. Uses
`set local role authenticated; set local request.jwt.claims = '{"sub": "<uuid>"}'`
to impersonate users.

- Token: issue -> verify roundtrip; tampered signature fails; expired
  fails; another user's token fails; second submit -> `already_answered`.
- `invite_duel`: non-friend rejected, self rejected, 4th of the day
  rejected for free, allowed for premium, `context_prices` rows created.
- Duel flow: accept -> live; two guesses -> `results.1`, `current_round=2`;
  5 rounds -> finished; `scores` sums match.
- Late guess: set `round_deadline = now() - 10 s`, submit -> `too_late`.
- Race: run two `submit_guess` in two connections with `pg_sleep` inside a
  patched trigger (test-only) to force overlap; assert exactly one
  `results.1` and `current_round = 2`.
- Room: join 11th player -> `room_full`; join after start -> rejected;
  trigger closes when all *seen* players answered; host handover picks
  oldest `joined_at`.
- Sweep: room with deadline in the past -> `sweep_deadlines()` advances;
  duel invited 8 days ago -> expired.
- RLS: opponent cannot select another pair's duel; member cannot update
  `rooms.status`; client cannot read `context_prices` or `listings`.
- `delete_me()` leaves the other player's duel readable with null
  challenger.

### Layer 3: scripted client (Node + supabase-js, `scripts/mp-sim.ts`)

A CLI bot that signs in as a seed user, subscribes to a channel and plays
by rule (`--strategy exact|random|idle|late|spam`). Uses:

```
npx tsx scripts/mp-sim.ts duel --as user2 --accept --strategy random
npx tsx scripts/mp-sim.ts room --code KTRP --as user3 --strategy idle
npx tsx scripts/mp-sim.ts room --code KTRP --bots 8 --strategy random   # fills a room
```

Scenarios (each asserts the final row state and prints event timing):
1. Duel happy path: phone invites bot, bot accepts in 2 s, plays 5 rounds;
   assert reveal appears on phone < 500 ms after bot's guess.
2. Duel idle opponent: bot accepts then never guesses; assert each round
   closes at 30-33 s via poke, and at <= 43 s with poke disabled (sweep).
3. Duel decline / expire (with `sweep_deadlines()` called manually after
   `update duels set created_at = now() - interval '8 days'`).
4. Async: `created_at - 25 h`, sweep, challenger plays 5, bot accepts and
   plays 5; assert finished + both pushes logged in `push_tickets`.
5. Room with 9 bots + phone: all `random` -> rounds close on last guess;
   one `idle` -> closes on deadline; host (phone) killed mid-round
   (force-quit app) -> handover to bot after 60 s, game finishes.
6. Late joiner: bot `join_room` after start -> `room_already_started`.
7. Reconnect: phone in airplane mode for 20 s during round 2, back online;
   assert screen shows correct state within 2 s of reconnect and no
   duplicate reveal.
8. Spam: bot sends 50 broadcasts/s; assert server drops beyond 10/s and
   the phone UI stays responsive.

### Layer 4: two real devices

iPhone (dev client) + Android emulator, both on local Supabase over LAN:

- Invite from iPhone, accept from push on Android (push works on emulator
  with Google Play image; on iOS only on the physical device).
- Cold-start deep link: kill the app on iPhone, send invite, tap push,
  assert it lands on INVITED, not home.
- Universal link `uzminicenu.lv/r/KTRP` opened from Notes on iPhone opens
  the room (needs the AASA file deployed to the preview domain).
- Background the iPhone for 2 rounds, foreground, assert resume at the
  correct round with correct scores.
- Airplane mode on Android during reveal; reconnect; assert no stuck
  spinner.
- Time it: from bot guess commit to iPhone reveal render, 20 samples,
  p95 < 300 ms on Wi-Fi (Realtime EU region from Riga is ~40 ms RTT).

### Exit criteria for Phase 3 (duel) and Phase 6 (rooms)

- All pgTAP tests green in CI.
- Sim scenarios 1-4 (duel) / 5-8 (room) pass 10 runs in a row without a
  stuck state.
- Two-device checklist done on a preview build, recorded as a screen video
  for the App Store review notes.
