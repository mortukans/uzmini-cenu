/** Pure derivation of the room screen phase from a `rooms` row (docs/06). */
import type { Room, RoomPlayer, RoundResults } from '../api/types';

export type RoomPhase =
  | { kind: 'LOADING' }
  | { kind: 'LOBBY' }
  | { kind: 'ROUND'; round: number }
  | { kind: 'ROUND_WAITING'; round: number }
  | { kind: 'SCOREBOARD'; round: number } // results[round] shown while deadline - now > ROUND_SEC
  | { kind: 'PODIUM' };

export const ROUND_SEC = 30;

export function deriveRoomPhase(
  room: Room | null,
  me: string,
  answered: Set<number>,
  now = Date.now(),
  offsetMs = 0,
): RoomPhase {
  if (!room) return { kind: 'LOADING' };
  if (room.status === 'lobby') return { kind: 'LOBBY' };
  if (room.status === 'finished') return { kind: 'PODIUM' };
  const cur = Math.max(1, room.current_round || 1);
  const prev = cur - 1;
  const remaining = room.round_deadline ? new Date(room.round_deadline).getTime() - (now + offsetMs) : 0;
  if (prev >= 1 && room.results?.[String(prev)] && remaining > ROUND_SEC * 1000) return { kind: 'SCOREBOARD', round: prev };
  if (answered.has(cur) || Boolean(room.results?.[String(cur)]?.[me])) return { kind: 'ROUND_WAITING', round: cur };
  return { kind: 'ROUND', round: cur };
}

export interface Standing {
  user_id: string;
  username: string;
  avatar: string | null;
  total: number;
  lastRound: number;
  rank: number;
}

export function standings(players: RoomPlayer[], results: RoundResults | null | undefined, round?: number): Standing[] {
  const rows: Standing[] = players.map((p) => {
    const fromResults = results ? Object.values(results).reduce((s, r) => s + (r?.[p.user_id]?.score ?? 0), 0) : 0;
    return {
      user_id: p.user_id,
      username: p.username ?? '…',
      avatar: p.avatar ?? null,
      total: Math.max(p.total ?? 0, fromResults),
      lastRound: round ? results?.[String(round)]?.[p.user_id]?.score ?? 0 : 0,
      rank: 0,
    };
  });
  rows.sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
