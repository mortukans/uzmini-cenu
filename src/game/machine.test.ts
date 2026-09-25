import { describe, expect, it } from 'vitest';
import type { Round } from '../api/types';
import {
  encodeSessionId, initialState, isLastRound, parseSessionId, reduce, totalScore, type SessionConfig, type SessionState,
} from './machine';

const round = (id: number): Round => ({
  id, category: 'flats', region: 'riga', location: 'Purvciems', attributes: { m2: 65, rooms: 3 },
  title_hint: 'Trīs istabu dzīvoklis', photo_urls: ['https://i.ss.com/a.800.jpg', 'https://i.ss.com/b.800.jpg'],
  source: 'ss.com', source_url: 'https://ss.com/x', token: `tok-${id}`,
});

const solo: SessionConfig = {
  sessionId: 'solo:flats:riga', mode: 'solo', category: 'flats', region: 'riga', totalRounds: 2,
  allowSkip: true, allowHints: true,
};

function playRound(s: SessionState, guess: number, price: number, score: number): SessionState {
  s = reduce(s, { type: 'PHOTO_READY' });
  s = reduce(s, { type: 'SUBMIT', guess, timeMs: 1000 });
  s = reduce(s, { type: 'SUBMIT_OK', price, score });
  s = reduce(s, { type: 'REVEAL_DONE' });
  return s;
}

describe('session reducer', () => {
  it('walks LOADING → STAGED → GUESSING → SUBMITTING → REVEALING → REVEALED → LOADING/SUMMARY', () => {
    let s = reduce(initialState, { type: 'START', config: solo });
    expect(s.phase).toBe('LOADING');
    s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [round(1), round(2), round(3)] });
    expect(s.phase).toBe('STAGED');
    s = reduce(s, { type: 'PHOTO_READY' });
    expect(s.phase).toBe('GUESSING');
    s = reduce(s, { type: 'SUBMIT', guess: 72000, timeMs: 5000 });
    expect(s.phase).toBe('SUBMITTING');
    s = reduce(s, { type: 'SUBMIT_OK', price: 78500, score: 516 });
    expect(s.phase).toBe('REVEALING');
    expect(s.lastOutcome?.cell).toBe('🟩');
    s = reduce(s, { type: 'REVEAL_DONE' });
    expect(s.phase).toBe('REVEALED');
    expect(s.outcomes).toHaveLength(1);
    expect(isLastRound(s)).toBe(false);
    s = reduce(s, { type: 'NEXT' });
    expect(s.phase).toBe('STAGED'); // prefetched → instant
    expect(s.roundNo).toBe(2);
    s = playRound(s, 100000, 100000, 1000);
    expect(totalScore(s)).toBe(1516);
    s = reduce(s, { type: 'NEXT' });
    expect(s.phase).toBe('SUMMARY');
  });

  it('ignores submit with guess < 1 and outside GUESSING', () => {
    let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1)] });
    expect(s.phase).toBe('STAGED');
    expect(reduce(s, { type: 'SUBMIT', guess: 500, timeMs: 0 }).phase).toBe('STAGED');
    s = reduce(s, { type: 'PHOTO_READY' });
    expect(reduce(s, { type: 'SUBMIT', guess: 0, timeMs: 0 }).phase).toBe('GUESSING');
  });

  it('goes to ERROR after 3 failed submits and retries with the guess kept', () => {
    let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'SUBMIT', guess: 50000, timeMs: 0 });
    s = reduce(s, { type: 'SUBMIT_FAILED', error: 'network' });
    s = reduce(s, { type: 'SUBMIT_FAILED', error: 'network' });
    expect(s.phase).toBe('SUBMITTING');
    s = reduce(s, { type: 'SUBMIT_FAILED', error: 'network' });
    expect(s.phase).toBe('ERROR');
    expect(s.pendingGuess).toBe(50000);
    s = reduce(s, { type: 'RETRY' });
    expect(s.phase).toBe('SUBMITTING');
    expect(s.submitRetries).toBe(0);
  });

  it('empty pool → ERROR; load failure → ERROR → RETRY back to LOADING', () => {
    let s = reduce(initialState, { type: 'START', config: solo });
    s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [] });
    expect(s.phase).toBe('ERROR');
    expect(s.error).toBe('empty_pool');
    s = reduce(s, { type: 'RETRY' });
    expect(s.phase).toBe('LOADING');
    s = reduce(s, { type: 'LOAD_FAILED', error: 'offline' });
    expect(s.phase).toBe('ERROR');
  });

  it('skips drop the round without scoring, max 2', () => {
    let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1), round(2), round(3), round(4)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'SKIP' });
    expect(s.rounds[0].id).toBe(2);
    expect(s.roundNo).toBe(1);
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'SKIP' });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'SKIP' });
    expect(s.skipsUsed).toBe(2);
    expect(s.rounds[0].id).toBe(3);
  });

  it('applies hint penalties to the score but not to the tile', () => {
    let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'USE_HINT', hint: 'title' });
    s = reduce(s, { type: 'USE_HINT', hint: 'title' }); // idempotent
    expect(s.hintsUsed).toEqual(['title']);
    s = reduce(s, { type: 'SUBMIT', guess: 78500, timeMs: 0 });
    s = reduce(s, { type: 'SUBMIT_OK', price: 78500, score: 1000 });
    expect(s.lastOutcome?.score).toBe(850);
    expect(s.lastOutcome?.rawScore).toBe(1000);
    expect(s.lastOutcome?.cell).toBe('🟩');
    // hints reset for next round
    s = reduce(s, { type: 'REVEAL_DONE' });
    s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [round(2)] });
    s = reduce(s, { type: 'NEXT' });
    expect(s.hintsUsed).toEqual([]);
  });

  it('hints are refused when the config forbids them (daily)', () => {
    const daily: SessionConfig = { ...solo, mode: 'daily', totalRounds: 5, allowSkip: false, allowHints: false };
    let s = reduce(initialState, { type: 'START', config: daily, rounds: [round(1)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    expect(reduce(s, { type: 'USE_HINT', hint: 'title' }).hintsUsed).toEqual([]);
    expect(reduce(s, { type: 'SKIP' }).rounds[0].id).toBe(1);
  });

  it('streak: survives within 15 %, ends on a miss', () => {
    const cfg: SessionConfig = { ...solo, mode: 'streak', totalRounds: null };
    let s = reduce(initialState, { type: 'START', config: cfg, rounds: [round(1), round(2), round(3)] });
    s = playRound(s, 90000, 100000, 449); // 10 % → survives
    expect(s.streak).toBe(1);
    expect(s.streakOver).toBe(false);
    s = reduce(s, { type: 'NEXT' });
    s = playRound(s, 50000, 100000, 18); // 50 % → over
    expect(s.streak).toBe(1);
    expect(s.streakOver).toBe(true);
    s = reduce(s, { type: 'NEXT' });
    expect(s.phase).toBe('SUMMARY');
  });

  it('duel: SUBMIT_OK without others → WAITING_OTHERS, then external reveal', () => {
    const cfg: SessionConfig = { ...solo, mode: 'duel', totalRounds: 5, waitForOthers: true, timerSec: 30, allowSkip: false, allowHints: false };
    let s = reduce(initialState, { type: 'START', config: cfg, rounds: [round(1), round(2)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'SUBMIT', guess: 72000, timeMs: 12000 });
    s = reduce(s, { type: 'SUBMIT_OK', price: 78500, score: 516 });
    expect(s.phase).toBe('WAITING_OTHERS');
    s = reduce(s, { type: 'EXTERNAL_REVEAL', price: 78500, score: 516, others: { anna: { guess: 90000, score: 300 } } });
    expect(s.phase).toBe('REVEALING');
    expect(s.lastOutcome?.others?.anna.guess).toBe(90000);
  });

  it('deadline auto-submits 0 when empty and scores 0', () => {
    const cfg: SessionConfig = { ...solo, mode: 'room', totalRounds: 5, waitForOthers: true, timerSec: 30, allowSkip: false, allowHints: false };
    let s = reduce(initialState, { type: 'START', config: cfg, rounds: [round(1)] });
    s = reduce(s, { type: 'PHOTO_READY' });
    s = reduce(s, { type: 'DEADLINE', timeMs: 30000 });
    expect(s.phase).toBe('SUBMITTING');
    expect(s.pendingGuess).toBe(0);
    s = reduce(s, { type: 'EXTERNAL_REVEAL', price: 78500, score: 0 });
    expect(s.lastOutcome?.score).toBe(0);
    expect(s.lastOutcome?.cell).toBe('🟥');
  });

  it('ROUNDS_LOADED de-duplicates listing ids already served', () => {
    let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1), round(2)] });
    s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [round(2), round(3)] });
    expect(s.rounds.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('START with prior outcomes resumes at the right round number (daily resume)', () => {
    const daily: SessionConfig = { ...solo, mode: 'daily', totalRounds: 5, allowSkip: false, allowHints: false };
    const prior = [{ roundNo: 1, guess: 1, price: 1, score: 1000, rawScore: 1000, err: 0, cell: '🟩' as const, hints: [], timeMs: 0, sourceUrl: '', round: round(9) }];
    const s = reduce(initialState, { type: 'START', config: daily, rounds: [round(2)], outcomes: prior });
    expect(s.roundNo).toBe(2);
    expect(s.phase).toBe('STAGED');
  });
});

describe('sessionId codec', () => {
  it('round-trips solo/streak/daily and passes through duel/room ids', () => {
    expect(encodeSessionId('solo', 'flats', 'riga')).toBe('solo:flats:riga');
    expect(encodeSessionId('streak', 'all')).toBe('streak:all');
    expect(encodeSessionId('daily')).toBe('daily');
    expect(parseSessionId('solo:flats:riga')).toEqual({ mode: 'solo', category: 'flats', region: 'riga', contextId: null });
    expect(parseSessionId('streak:all')).toEqual({ mode: 'streak', category: 'all', region: null, contextId: null });
    expect(parseSessionId('daily').mode).toBe('daily');
    expect(parseSessionId('duel:abc-123')).toEqual({ mode: 'duel', category: 'all', region: null, contextId: 'abc-123' });
    expect(parseSessionId('room:KTRP').contextId).toBe('KTRP');
  });
});
