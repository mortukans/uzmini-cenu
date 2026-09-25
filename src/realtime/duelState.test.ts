import { describe, expect, it } from 'vitest';
import type { Duel, Room } from '../api/types';
import { deriveDuelState, duelOutcome, emptyLocal, totalFromResults } from './duelState';
import { deriveRoomPhase, standings } from './roomState';

const ME = 'me';
const OPP = 'opp';
const base = (over: Partial<Duel> = {}): Duel => ({
  id: 'd1', challenger: ME, opponent: OPP, listing_ids: [1, 2, 3, 4, 5], snapshot: [],
  status: 'invited', scores: {}, current_round: 0, round_deadline: null, accepted_at: null,
  finished_at: null, async: false, results: {}, created_at: '2026-01-01T00:00:00Z', ...over,
});

describe('deriveDuelState', () => {
  it('loading without a row', () => expect(deriveDuelState(null, ME).kind).toBe('LOADING'));
  it('not participant', () => expect(deriveDuelState(base(), 'x').kind).toBe('NOT_PARTICIPANT'));
  it('challenger waits, opponent sees invite', () => {
    expect(deriveDuelState(base(), ME)).toEqual({ kind: 'WAITING_ACCEPT', async: false });
    expect(deriveDuelState(base(), OPP).kind).toBe('INVITED');
  });
  it('declined / expired / finished', () => {
    expect(deriveDuelState(base({ status: 'declined' }), ME).kind).toBe('DECLINED');
    expect(deriveDuelState(base({ status: 'expired' }), ME).kind).toBe('EXPIRED');
    expect(deriveDuelState(base({ status: 'finished' }), OPP).kind).toBe('RESULT');
  });
  it('live round 1, waiting after my guess, reveal when results land', () => {
    const live = base({ status: 'live', current_round: 1 });
    expect(deriveDuelState(live, ME)).toEqual({ kind: 'ROUND', round: 1, async: false });
    const local = emptyLocal();
    local.answered.add(1);
    expect(deriveDuelState(live, ME, local)).toEqual({ kind: 'ROUND_WAITING', round: 1, async: false });
    const closed = base({
      status: 'live', current_round: 2,
      results: { '1': { me: { guess: 1, score: 500 }, opp: { guess: 2, score: 400 } } },
    });
    expect(deriveDuelState(closed, ME, local)).toEqual({ kind: 'REVEAL', round: 1 });
    local.revealSeen = 1;
    expect(deriveDuelState(closed, ME, local)).toEqual({ kind: 'ROUND', round: 2, async: false });
  });
  it('async: challenger plays own rounds then waits', () => {
    const a = base({ async: true });
    expect(deriveDuelState(a, ME)).toEqual({ kind: 'ROUND', round: 1, async: true });
    const local = emptyLocal();
    [1, 2, 3, 4, 5].forEach((n) => local.answered.add(n));
    expect(deriveDuelState(a, ME, local).kind).toBe('WAITING_OPPONENT_ASYNC');
    expect(deriveDuelState(a, OPP).kind).toBe('INVITED');
  });
  it('outcome + totals', () => {
    expect(duelOutcome(base({ scores: { me: 10, opp: 5 } }), ME)).toBe('win');
    expect(duelOutcome(base({ scores: { me: 5, opp: 5 } }), ME)).toBe('draw');
    expect(totalFromResults({ '1': { me: { guess: 1, score: 300 } }, '2': { me: { guess: 1, score: 200 } } }, ME)).toBe(500);
  });
});

describe('deriveRoomPhase', () => {
  const room = (over: Partial<Room> = {}): Room => ({
    code: 'KTRP', host: ME, category: 'all', rounds: 5, listing_ids: [], snapshot: [], status: 'lobby',
    current_round: 0, round_deadline: null, results: {}, started_at: null, finished_at: null, created_at: '', ...over,
  });
  it('lobby / podium', () => {
    expect(deriveRoomPhase(room(), ME, new Set()).kind).toBe('LOBBY');
    expect(deriveRoomPhase(room({ status: 'finished' }), ME, new Set()).kind).toBe('PODIUM');
  });
  it('scoreboard while deadline - now > 30 s, then round', () => {
    const now = 1_000_000;
    const r = room({ status: 'live', current_round: 2, results: { '1': {} }, round_deadline: new Date(now + 34_000).toISOString() });
    expect(deriveRoomPhase(r, ME, new Set(), now)).toEqual({ kind: 'SCOREBOARD', round: 1 });
    expect(deriveRoomPhase(r, ME, new Set(), now + 5000)).toEqual({ kind: 'ROUND', round: 2 });
    expect(deriveRoomPhase(r, ME, new Set([2]), now + 5000)).toEqual({ kind: 'ROUND_WAITING', round: 2 });
  });
  it('standings rank by total', () => {
    const s = standings(
      [
        { room_code: 'K', user_id: 'a', total: 100, joined_at: '', last_seen: '', username: 'A' },
        { room_code: 'K', user_id: 'b', total: 300, joined_at: '', last_seen: '', username: 'B' },
      ],
      { '1': { a: { guess: 1, score: 100 }, b: { guess: 1, score: 300 } } },
      1,
    );
    expect(s[0]).toMatchObject({ user_id: 'b', rank: 1, lastRound: 300 });
  });
});
