import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type Round } from '../api/types';
import {
  encodeSessionId, initialState, isLastRound, parseSessionId, reduce, totalScore, type SessionConfig, type SessionState,
} from './machine';

const round = (id: number): Round => ({
  id, category: 'flats', region: 'riga', location: 'Purvciems', attributes: { m2: 65, rooms: 3 },
  title_hint: 'Trīs istabu dzīvoklis', photo_urls: ['https://i.ss.com/a.800.jpg', 'https://i.ss.com/b.800.jpg'],
  source: 'ss.com', source_url: 'https://ss.com/x', token: `tok-${id}`,
});

const solo: SessionConfig = {
  sessionId: 'solo:flats:riga', mode: 'solo', category: 'flats', region: 'riga', filters: DEFAULT_FILTERS, totalRounds: 2,
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

  describe('dry pool mid-session (filtered / sorted solo & streak)', () => {
    it('solo: an empty refill after at least one outcome ends on SUMMARY instead of ERROR', () => {
      let s = reduce(initialState, { type: 'START', config: { ...solo, totalRounds: 10 }, rounds: [round(1)] });
      s = playRound(s, 72000, 78500, 516);
      s = reduce(s, { type: 'NEXT' });
      expect(s.phase).toBe('LOADING'); // queue exhausted → the store refills
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [] });
      expect(s.phase).toBe('SUMMARY');
      expect(s.error).toBeNull();
      expect(s.outcomes).toHaveLength(1);
      expect(totalScore(s)).toBe(516);
    });

    it('a refill that only re-serves already-seen ids counts as dry too', () => {
      let s = reduce(initialState, { type: 'START', config: { ...solo, totalRounds: 10 }, rounds: [round(1)] });
      s = playRound(s, 72000, 78500, 516);
      s = reduce(s, { type: 'NEXT' });
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [round(1)] });
      expect(s.phase).toBe('SUMMARY');
    });

    it('streak: ends on SUMMARY as well, keeping the streak count', () => {
      let s = reduce(initialState, { type: 'START', config: { ...solo, mode: 'streak', totalRounds: null }, rounds: [round(1)] });
      s = playRound(s, 95000, 100000, 700);
      s = reduce(s, { type: 'NEXT' });
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [] });
      expect(s.phase).toBe('SUMMARY');
      expect(s.streak).toBe(1);
    });

    it('with nothing played yet an empty pool is still ERROR empty_pool (first load, also after a watchdog timeout)', () => {
      let s = reduce(initialState, { type: 'START', config: solo });
      expect(reduce(s, { type: 'ROUNDS_LOADED', rounds: [] }).error).toBe('empty_pool');
      s = reduce(s, { type: 'LOAD_FAILED', error: 'timeout' });
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [] });
      expect(s.phase).toBe('ERROR');
      expect(s.error).toBe('empty_pool');
    });

    it('daily/duel/room never end themselves on an empty injectRounds', () => {
      const duel: SessionConfig = { ...solo, mode: 'duel', totalRounds: 5, waitForOthers: true, allowSkip: false, allowHints: false };
      let s = reduce(initialState, { type: 'START', config: duel, rounds: [round(1)] });
      s = reduce(s, { type: 'PHOTO_READY' });
      s = reduce(s, { type: 'SUBMIT', guess: 1000, timeMs: 1 });
      s = reduce(s, { type: 'EXTERNAL_REVEAL', price: 1000, score: 1000 });
      s = reduce(s, { type: 'REVEAL_DONE' });
      s = reduce(s, { type: 'NEXT' });
      expect(s.phase).toBe('LOADING');
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: [] });
      expect(s.phase).toBe('ERROR');
      expect(s.error).toBe('empty_pool');
    });
  });

  describe('re-issued tokens (auth user changed / bad_token)', () => {
    const fresh = [round(11), round(12), round(13)];

    it('ROUNDS_REPLACED while GUESSING swaps the round on screen for a fresh one and keeps the score', () => {
      let s = reduce(initialState, { type: 'START', config: { ...solo, totalRounds: 5 }, rounds: [round(1), round(2), round(3)] });
      s = playRound(s, 72000, 78500, 516);
      s = reduce(s, { type: 'NEXT' });
      s = reduce(s, { type: 'PHOTO_READY' });
      expect(s.rounds[0].id).toBe(2);
      s = reduce(s, { type: 'ROUNDS_REPLACED', rounds: fresh });
      expect(s.phase).toBe('STAGED');
      expect(s.rounds.map((r) => r.id)).toEqual([11, 12, 13]);
      expect(s.roundNo).toBe(2);
      expect(totalScore(s)).toBe(516);
      expect(s.outcomes).toHaveLength(1);
    });

    it('ROUNDS_REPLACED while REVEALED keeps the revealed round, replaces the rest, NEXT stages a fresh one', () => {
      let s = reduce(initialState, { type: 'START', config: { ...solo, totalRounds: 5 }, rounds: [round(1), round(2), round(3)] });
      s = playRound(s, 72000, 78500, 516);
      expect(s.phase).toBe('REVEALED');
      s = reduce(s, { type: 'ROUNDS_REPLACED', rounds: [round(1), ...fresh] }); // server may re-serve #1: filtered
      expect(s.phase).toBe('REVEALED');
      expect(s.rounds.map((r) => r.id)).toEqual([1, 11, 12, 13]);
      s = reduce(s, { type: 'NEXT' });
      expect(s.phase).toBe('STAGED');
      expect(s.rounds[0].id).toBe(11);
      expect(s.roundNo).toBe(2);
    });

    it('ROUNDS_REPLACED while SUBMITTING keeps the pending round at index 0', () => {
      let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1), round(2)] });
      s = reduce(s, { type: 'PHOTO_READY' });
      s = reduce(s, { type: 'SUBMIT', guess: 50000, timeMs: 0 });
      s = reduce(s, { type: 'ROUNDS_REPLACED', rounds: fresh });
      expect(s.phase).toBe('SUBMITTING');
      expect(s.pendingGuess).toBe(50000);
      expect(s.rounds.map((r) => r.id)).toEqual([1, 11, 12, 13]);
    });

    it('ROUNDS_REPLACED recovers LOADING and ERROR(load) states; is a no-op in SUMMARY', () => {
      let s = reduce(initialState, { type: 'START', config: solo });
      s = reduce(s, { type: 'LOAD_FAILED', error: 'timeout' });
      expect(s.phase).toBe('ERROR');
      s = reduce(s, { type: 'ROUNDS_REPLACED', rounds: fresh });
      expect(s.phase).toBe('STAGED');
      expect(s.error).toBeNull();
      expect(reduce(reduce(initialState, { type: 'START', config: solo }), { type: 'ROUNDS_REPLACED', rounds: [] }).phase).toBe('ERROR');
      const done = reduce(s, { type: 'END' });
      expect(reduce(done, { type: 'ROUNDS_REPLACED', rounds: fresh })).toBe(done);
    });

    it('DISCARD_ROUND drops the current round without scoring or counting a skip', () => {
      let s = reduce(initialState, { type: 'START', config: solo, rounds: [round(1), round(2)] });
      s = reduce(s, { type: 'PHOTO_READY' });
      s = reduce(s, { type: 'SUBMIT', guess: 50000, timeMs: 0 });
      s = reduce(s, { type: 'DISCARD_ROUND' });
      expect(s.phase).toBe('STAGED');
      expect(s.rounds[0].id).toBe(2);
      expect(s.roundNo).toBe(1);
      expect(s.skipsUsed).toBe(0);
      expect(s.outcomes).toHaveLength(0);
      expect(s.pendingGuess).toBeNull();
      s = reduce(s, { type: 'DISCARD_ROUND' });
      expect(s.phase).toBe('LOADING'); // queue exhausted → the store refills
      expect(reduce(s, { type: 'DISCARD_ROUND' })).toBe(s);
    });

    it('a pool arriving after the LOADING watchdog fired still stages the round', () => {
      let s = reduce(initialState, { type: 'START', config: solo });
      s = reduce(s, { type: 'LOAD_FAILED', error: 'timeout' });
      s = reduce(s, { type: 'ROUNDS_LOADED', rounds: fresh });
      expect(s.phase).toBe('STAGED');
      expect(s.prevPhase).toBeNull();
    });
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
  const none = DEFAULT_FILTERS;
  const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

  it('round-trips solo/streak/daily and passes through duel/room ids (legacy 3-segment ids)', () => {
    expect(encodeSessionId('solo', 'flats', 'riga')).toBe('solo:flats:riga');
    expect(encodeSessionId('streak', 'all')).toBe('streak:all');
    expect(encodeSessionId('daily')).toBe('daily');
    expect(parseSessionId('solo:flats:riga')).toEqual({ mode: 'solo', category: 'flats', region: 'riga', contextId: null, filters: none });
    expect(parseSessionId('streak:all')).toEqual({ mode: 'streak', category: 'all', region: null, contextId: null, filters: none });
    expect(parseSessionId('daily').mode).toBe('daily');
    expect(parseSessionId('daily').filters).toEqual(none);
    expect(parseSessionId('duel:abc-123')).toEqual({ mode: 'duel', category: 'all', region: null, contextId: 'abc-123', filters: none });
    expect(parseSessionId('room:KTRP').contextId).toBe('KTRP');
    expect(parseSessionId('onboarding').filters).toEqual(none);
  });

  it('default filters add no 4th segment; explicit DEFAULT_FILTERS is the same as none', () => {
    expect(encodeSessionId('solo', 'flats', 'riga', none)).toBe('solo:flats:riga');
    expect(encodeSessionId('solo', 'flats', 'riga', { period: 'all', sort: 'random', make: null, model: null })).toBe('solo:flats:riga');
    expect(encodeSessionId('daily', 'all', null, { period: '7d', sort: 'newest' })).toBe('daily');
  });

  it('non-default filters travel as a base64url 4th segment and round-trip', () => {
    const f = { period: '7d', sort: 'price_desc', make: 'BMW', model: 'X5' } as const;
    const id = encodeSessionId('solo', 'cars', 'riga', f);
    const [mode, cat, reg, seg, extra] = id.split(':');
    expect([mode, cat, reg]).toEqual(['solo', 'cars', 'riga']);
    expect(seg).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(seg).toBe(b64url(JSON.stringify(f))); // interoperable with the standard alphabet, no padding
    expect(extra).toBeUndefined();
    expect(parseSessionId(id)).toEqual({ mode: 'solo', category: 'cars', region: 'riga', contextId: null, filters: f });
  });

  it('keeps an empty region slot so the filters segment is unambiguous', () => {
    const id = encodeSessionId('streak', 'all', null, { period: 'all', sort: 'newest' });
    expect(id.startsWith('streak:all::')).toBe(true);
    expect(parseSessionId(id)).toEqual({ mode: 'streak', category: 'all', region: null, contextId: null, filters: { period: 'all', sort: 'newest' } });
  });

  it('round-trips makes with spaces, hyphens and non-ASCII', () => {
    for (const make of ['Mercedes-Benz', 'Škoda', 'Land Rover', 'Citroën', 'ВАЗ', 'Alfa Romeo']) {
      const id = encodeSessionId('solo', 'cars', 'latvia', { period: '30d', sort: 'random', make, model: 'Octavia Combi 1.9 TDI' });
      expect(id).not.toMatch(/[^A-Za-z0-9_:-]/); // URL-safe path segment
      const p = parseSessionId(id);
      expect(p.filters.make).toBe(make);
      expect(p.filters.model).toBe('Octavia Combi 1.9 TDI');
      expect(p.filters.period).toBe('30d');
    }
  });

  it('a model without a make, or make/model on a non-cars category, is dropped on parse', () => {
    const noMake = encodeSessionId('solo', 'cars', 'riga', { period: '24h', sort: 'random', model: 'X5' });
    expect(parseSessionId(noMake).filters).toEqual({ period: '24h', sort: 'random' });
    const flats = encodeSessionId('solo', 'flats', 'riga', { period: 'all', sort: 'newest', make: 'BMW' });
    expect(parseSessionId(flats).filters).toEqual({ period: 'all', sort: 'newest' });
  });

  it('garbage or unknown values in the 4th segment fall back to DEFAULT_FILTERS / defaults', () => {
    expect(parseSessionId('solo:cars:riga:%%%not-base64').filters).toEqual(none);
    expect(parseSessionId('solo:cars:riga:' + b64url('[1,2]')).filters).toEqual(none);
    expect(parseSessionId('solo:cars:riga:' + b64url('{"period":"1y","sort":"cheapest","make":"BMW"}')).filters)
      .toEqual({ period: 'all', sort: 'random', make: 'BMW' });
    // legacy ids keep category/region even if a bogus 4th segment is appended
    expect(parseSessionId('solo:cars:riga:zzz')).toMatchObject({ mode: 'solo', category: 'cars', region: 'riga' });
  });
});

describe('maxScore when a filtered pool runs dry', () => {
  it('uses the rounds actually played once the session ended early on SUMMARY', async () => {
    const { initialState, maxScore } = await import('./machine');
    const base = initialState;
    const cfg = { sessionId: 'solo:cars', mode: 'solo', category: 'cars', region: null, filters: { period: 'all', sort: 'random' }, totalRounds: 10, allowSkip: true, allowHints: true } as any;
    const outcome = { roundNo: 1, guess: 1, price: 1, score: 1000, rawScore: 1000, err: 0, cell: '🟩', hints: [], timeMs: 0, sourceUrl: '', round: {} } as any;
    expect(maxScore({ ...base, config: cfg, phase: 'GUESSING', outcomes: [outcome, outcome] })).toBe(10_000);
    expect(maxScore({ ...base, config: cfg, phase: 'SUMMARY', outcomes: [outcome, outcome, outcome] })).toBe(3_000);
    expect(maxScore({ ...base, config: cfg, phase: 'SUMMARY', outcomes: [] })).toBe(10_000);
    expect(maxScore({ ...base, config: { ...cfg, totalRounds: null }, phase: 'SUMMARY', outcomes: [outcome] })).toBeNull();
  });
});
