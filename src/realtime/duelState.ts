/**
 * Pure derivation of the duel screen state from a `duels` row + my user id +
 * local input (docs/06 "Client state machines"). No React, unit-tested.
 */
import type { Duel, RoundResults } from '../api/types';

export type DuelRole = 'challenger' | 'opponent' | 'none';

export type DuelScreenState =
  | { kind: 'LOADING' }
  | { kind: 'NOT_PARTICIPANT' }
  | { kind: 'INVITED' } // me = opponent, accept / decline
  | { kind: 'WAITING_ACCEPT'; async: boolean } // me = challenger
  | { kind: 'DECLINED' }
  | { kind: 'EXPIRED' }
  | { kind: 'ROUND'; round: number; async: boolean }
  | { kind: 'ROUND_WAITING'; round: number; async: boolean }
  | { kind: 'REVEAL'; round: number }
  | { kind: 'WAITING_OPPONENT_ASYNC' }
  | { kind: 'RESULT' };

export interface DuelLocal {
  /** Rounds I have submitted this session (or learnt from results). */
  answered: Set<number>;
  /** Highest round whose reveal the user has dismissed (tap or 5 s). */
  revealSeen: number;
}

export const emptyLocal = (): DuelLocal => ({ answered: new Set(), revealSeen: 0 });

export function roleOf(duel: Pick<Duel, 'challenger' | 'opponent'>, me: string): DuelRole {
  if (duel.challenger === me) return 'challenger';
  if (duel.opponent === me) return 'opponent';
  return 'none';
}

export function opponentOf(duel: Pick<Duel, 'challenger' | 'opponent'>, me: string): string {
  return duel.challenger === me ? duel.opponent : duel.challenger;
}

export const roundsOf = (duel: Pick<Duel, 'listing_ids' | 'snapshot'>) =>
  duel.listing_ids?.length || duel.snapshot?.length || 5;

/** Did `user` answer round `n` according to server results? */
export const answeredInResults = (results: RoundResults | null | undefined, n: number, user: string) =>
  Boolean(results?.[String(n)]?.[user]);

export function deriveDuelState(duel: Duel | null, me: string, local: DuelLocal = emptyLocal()): DuelScreenState {
  if (!duel) return { kind: 'LOADING' };
  const role = roleOf(duel, me);
  if (role === 'none') return { kind: 'NOT_PARTICIPANT' };

  switch (duel.status) {
    case 'declined':
      return { kind: 'DECLINED' };
    case 'expired':
      return { kind: 'EXPIRED' };
    case 'finished':
      return { kind: 'RESULT' };
    case 'invited': {
      if (role === 'opponent') return { kind: 'INVITED' };
      if (!duel.async) return { kind: 'WAITING_ACCEPT', async: false };
      return asyncPlayState(duel, me, local);
    }
    case 'live':
      return duel.async ? asyncPlayState(duel, me, local) : syncPlayState(duel, me, local);
    default:
      return { kind: 'LOADING' };
  }
}

function asyncPlayState(duel: Duel, me: string, local: DuelLocal): DuelScreenState {
  const total = roundsOf(duel);
  for (let n = 1; n <= total; n++) {
    if (!local.answered.has(n) && !answeredInResults(duel.results, n, me)) return { kind: 'ROUND', round: n, async: true };
  }
  return { kind: 'WAITING_OPPONENT_ASYNC' };
}

function syncPlayState(duel: Duel, me: string, local: DuelLocal): DuelScreenState {
  const total = roundsOf(duel);
  const cur = Math.max(1, duel.current_round || 1);
  const prev = cur - 1;
  if (prev >= 1 && duel.results?.[String(prev)] && local.revealSeen < prev) return { kind: 'REVEAL', round: prev };
  if (cur > total) return { kind: 'RESULT' };
  if (duel.results?.[String(cur)] && local.revealSeen < cur) return { kind: 'REVEAL', round: cur };
  if (local.answered.has(cur) || answeredInResults(duel.results, cur, me)) return { kind: 'ROUND_WAITING', round: cur, async: false };
  return { kind: 'ROUND', round: cur, async: false };
}

export type DuelOutcome = 'win' | 'lose' | 'draw';
export function duelOutcome(duel: Pick<Duel, 'scores' | 'challenger' | 'opponent'>, me: string): DuelOutcome {
  const mine = duel.scores?.[me] ?? 0;
  const theirs = duel.scores?.[opponentOf(duel, me)] ?? 0;
  return mine > theirs ? 'win' : mine < theirs ? 'lose' : 'draw';
}

/** Total from `results` when `scores` is missing (async mid-game). */
export function totalFromResults(results: RoundResults | null | undefined, user: string): number {
  if (!results) return 0;
  return Object.values(results).reduce((s, r) => s + (r?.[user]?.score ?? 0), 0);
}
