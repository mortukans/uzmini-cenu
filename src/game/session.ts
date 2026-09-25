/**
 * Session store: wraps the pure reducer in src/game/machine.ts with I/O
 * (get_rounds / get_daily / submit_guess / submit_daily, photo prefetch, timers,
 * local persistence). Used by `play/[sessionId]` for every mode.
 *
 * Social side (duel/room) drives it through `sessionActions`:
 *   sessionActions.startSession({ mode: 'duel', rounds, onGuess, timer: 30, waitForOthers: true, ... })
 *   sessionActions.injectRounds(rounds)             // append later rounds
 *   sessionActions.revealExternal(roundNo, results) // when private.close_round wrote results
 */
import { create } from 'zustand';
import { Image } from 'expo-image';
import type { CategoryFilter, GuessResult, Mode, Region, Round, RoundResults } from '../api/types';
import { getDaily, getRounds, RpcError, submitDaily, submitGuess } from '../api/rpc';
import { useAuth } from '../auth/store';
import { isConfigured } from '../env';
import { score as localScore, gridCell } from './scoring';
import { track } from '../analytics';
import {
  DAILY_ROUNDS, SOLO_ROUNDS, STAGED_TIMEOUT_MS, currentRound, initialState, reduce, totalScore,
  type Action, type Outcome, type Phase, type SessionConfig, type SessionState,
} from './machine';
import { HINT_TOKEN_EVERY_HITS, MAX_HINT_TOKENS, hintsAllowed, type HintType } from './hints';
import {
  bumpDailyStreak, getDailyProgress, getHintTokens, recordStreakBest, setDailyLocalResult, setDailyProgress,
  setHintTokens, setStreakCurrent, type StoredOutcome,
} from './storage';
import { rigaDay } from './time';

const POOL_SIZE = 10;
const PREFETCH_AHEAD = 2;
const REFILL_BELOW = 4;

export interface StartSessionOptions {
  mode: Mode;
  category?: CategoryFilter;
  region?: Region | null;
  sessionId?: string;
  /** Pre-supplied rounds (duel/room snapshot with tokens; onboarding). */
  rounds?: Round[];
  /** Custom submit; return null to wait for `revealExternal`. Defaults to submit_guess. */
  onGuess?: (round: Round, guess: number, timeMs: number) => Promise<GuessResult | null>;
  /** Seconds per round (duel/room). */
  timer?: number;
  waitForOthers?: boolean;
  totalRounds?: number | null;
  contextId?: string;
  /** Onboarding: rounds are served from a bundle, scored locally. */
  localScoring?: boolean;
  /** Resume state (daily). */
  priorOutcomes?: Outcome[];
  streak?: number;
}

export interface DailyMeta { day: string; number: number; alreadyPlayed: boolean; shareText?: string }

interface SessionStore extends SessionState {
  /** Daily set metadata once loaded. */
  daily: DailyMeta | null;
  /** Result of submit_daily (or a local total for anonymous/offline). */
  dailySubmitted: { total: number; grid: string; shareText: string | null; synced: boolean } | null;
  /** Hint tokens held (streak rewards). */
  hintTokens: number;
  /** Local best for the current streak category. */
  streakBest: number;
  offline: boolean;
  dispatch: (a: Action) => void;
}

let opts: StartSessionOptions | null = null;
let stagedTimer: ReturnType<typeof setTimeout> | null = null;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
let guessStartedAt = 0;
let loading = false;
let generation = 0;

export const useSession = create<SessionStore>((set, get) => ({
  ...initialState,
  daily: null,
  dailySubmitted: null,
  hintTokens: 0,
  streakBest: 0,
  offline: false,
  dispatch: (a) => {
    const prev = get();
    const next = reduce(prev, a);
    if (next === prev) return;
    if (__DEV__ && next.phase !== prev.phase) {
      // docs/02 §1.1: every state change logs round_state in dev builds only.
      // eslint-disable-next-line no-console
      console.log('[round_state]', prev.phase, '→', next.phase, 'round', next.roundNo);
    }
    set(next);
    void afterTransition(prev.phase, next);
  },
}));

const dispatch = (a: Action) => useSession.getState().dispatch(a);

// ─── photo helpers ────────────────────────────────────────────────────────────

/** `…/xyz.800.jpg` → `…/xyz.t.jpg` for the thumbnail strip. */
export const thumbUrl = (url: string) => url.replace(/\.800\.jpg$/i, '.t.jpg');

async function prefetchRound(r: Round | undefined): Promise<boolean> {
  if (!r?.photo_urls?.length) return true;
  try { return await Image.prefetch(r.photo_urls[0], 'memory-disk'); } catch { return false; }
}

// ─── transitions with side effects ───────────────────────────────────────────

async function afterTransition(prevPhase: Phase, s: SessionState) {
  const gen = generation;
  const cfg = s.config;
  if (!cfg) return;

  if (s.phase === 'LOADING' && prevPhase !== 'LOADING') {
    void ensurePool();
  }

  if (s.phase === 'STAGED' && prevPhase !== 'STAGED') {
    if (stagedTimer) clearTimeout(stagedTimer);
    const r = currentRound(s);
    track('round_start', { mode: cfg.mode, category: r?.category, listing_id: r?.id, round_no: s.roundNo });
    // 2 s timeout: show a placeholder and continue anyway.
    stagedTimer = setTimeout(() => { if (gen === generation) dispatch({ type: 'PHOTO_READY' }); }, STAGED_TIMEOUT_MS);
    void prefetchRound(r).then(() => { if (gen === generation) dispatch({ type: 'PHOTO_READY' }); });
    // Prefetch n+1, n+2 and refill the pool.
    void Promise.all(s.rounds.slice(1, 1 + PREFETCH_AHEAD).map(prefetchRound));
    void ensurePool();
  }

  if (s.phase === 'GUESSING' && prevPhase !== 'GUESSING') {
    if (stagedTimer) { clearTimeout(stagedTimer); stagedTimer = null; }
    guessStartedAt = Date.now();
    if (cfg.timerSec) {
      const at = s.deadlineAt ?? Date.now() + cfg.timerSec * 1000;
      if (!s.deadlineAt) dispatch({ type: 'SET_DEADLINE', at });
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => {
        if (gen === generation) dispatch({ type: 'DEADLINE', timeMs: Date.now() - guessStartedAt });
      }, Math.max(0, at - Date.now()));
    }
  }

  if (s.phase === 'SUBMITTING' && prevPhase !== 'SUBMITTING') {
    if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    void doSubmit(s, gen);
  }

  if (s.phase === 'REVEALED' && prevPhase === 'REVEALING') {
    const o = s.outcomes[s.outcomes.length - 1];
    if (o) void afterOutcome(cfg, s, o);
  }

  if (s.phase === 'SUMMARY' && prevPhase !== 'SUMMARY') {
    void onSummary(cfg, s);
  }
}

async function ensurePool() {
  const s = useSession.getState();
  const cfg = s.config;
  if (!cfg || loading || opts?.rounds || opts?.localScoring) return;
  if (cfg.mode !== 'solo' && cfg.mode !== 'streak') return;
  if (s.rounds.length >= REFILL_BELOW && s.phase !== 'LOADING') return;
  loading = true;
  const gen = generation;
  try {
    const rounds = isConfigured ? await getRounds(cfg.category, cfg.region, POOL_SIZE) : [];
    if (gen !== generation) return;
    dispatch({ type: 'ROUNDS_LOADED', rounds });
    useSession.setState({ offline: false });
  } catch (e) {
    if (gen !== generation) return;
    useSession.setState({ offline: true });
    dispatch({ type: 'LOAD_FAILED', error: e instanceof RpcError ? e.code : 'network' });
  } finally {
    loading = false;
  }
}

async function doSubmit(s: SessionState, gen: number) {
  const round = currentRound(s);
  const cfg = s.config!;
  if (!round) return;
  const guess = s.pendingGuess ?? 0;
  const timeMs = s.pendingTimeMs;

  // Timed modes: 0 = no guess. Still tell the server when we can (score 0).
  try {
    let result: GuessResult | null;
    if (opts?.localScoring) {
      const price = (round as Round & { price_eur?: number }).price_eur ?? 0;
      result = { price_eur: price, score: localScore(guess, price), guess_eur: guess, source_url: round.source_url };
    } else if (opts?.onGuess) {
      result = await opts.onGuess(round, guess, timeMs);
    } else if (guess < 1) {
      result = null;
    } else {
      result = await submitGuess(round.token, guess, timeMs);
    }
    if (gen !== generation) return;
    if (result) {
      dispatch({ type: 'SUBMIT_OK', price: result.price_eur, score: result.score, sourceUrl: result.source_url });
    } else if (cfg.waitForOthers) {
      // Own guess accepted (or nothing to send); wait for close_round.
      useSession.setState({ phase: 'WAITING_OTHERS' });
    }
  } catch (e) {
    if (gen !== generation) return;
    const code = e instanceof RpcError ? e.code : 'network';
    if (code === 'token_expired' || code === 'bad_token') {
      // Discard the round, load a fresh one (docs/02 §8).
      track('round_token_expired', { listing_id: round.id });
      useSession.setState((st) => reduce({ ...st, phase: 'GUESSING' }, { type: 'SKIP' }));
      useSession.setState((st) => ({ ...st, skipsUsed: Math.max(0, st.skipsUsed - 1), error: 'token_expired' }));
      return;
    }
    if (code === 'already_answered' || code === 'round_closed') {
      if (cfg.waitForOthers) { useSession.setState({ phase: 'WAITING_OTHERS' }); return; }
    }
    dispatch({ type: 'SUBMIT_FAILED', error: code });
    const st = useSession.getState();
    if (st.phase === 'SUBMITTING') {
      // Retry with backoff while still under MAX_SUBMIT_RETRIES.
      setTimeout(() => { if (gen === generation && useSession.getState().phase === 'SUBMITTING') void doSubmit(useSession.getState(), gen); }, 600 * st.submitRetries);
    }
  }
}

async function afterOutcome(cfg: SessionConfig, s: SessionState, o: Outcome) {
  track('round_submit', {
    mode: cfg.mode, guess: o.guess, price: o.price, score: o.score, err_pct: Math.round(o.err * 100),
    seconds_spent: Math.round(o.timeMs / 1000), hints: o.hints, round_no: o.roundNo,
  });
  if (o.err === 0 && o.guess > 0) track('perfect_guess', { listing_id: o.round.id });

  if (cfg.mode === 'streak') {
    const best = await recordStreakBest(cfg.category, s.streak);
    useSession.setState({ streakBest: best });
    if (!s.streakOver) {
      await setStreakCurrent({ category: cfg.category, region: cfg.region, length: s.streak, sessionId: cfg.sessionId });
      if (s.streak > 0 && s.streak % HINT_TOKEN_EVERY_HITS === 0) {
        const tokens = Math.min(MAX_HINT_TOKENS, (await getHintTokens()) + 1);
        await setHintTokens(tokens);
        useSession.setState({ hintTokens: tokens });
      }
    } else {
      await setStreakCurrent(null);
      track('streak_end', { category: cfg.category, length: s.streak, best });
    }
  }

  if (cfg.mode === 'daily') {
    const d = useSession.getState().daily;
    if (d) await setDailyProgress({ day: d.day, number: d.number, outcomes: s.outcomes.map(toStored) });
  }
}

export function toStored(o: Outcome): StoredOutcome {
  return {
    round_no: o.roundNo, listing_id: o.round.id, guess: o.guess, price: o.price, score: o.score, err: o.err,
    cell: o.cell, hints: o.hints, location: o.round.location, title_hint: o.round.title_hint,
    thumb: o.round.photo_urls[0] ? thumbUrl(o.round.photo_urls[0]) : null, source_url: o.sourceUrl,
  };
}

async function onSummary(cfg: SessionConfig, s: SessionState) {
  const total = totalScore(s);
  if (cfg.mode === 'solo' || cfg.mode === 'streak') {
    track('session_complete', { mode: cfg.mode, category: cfg.category, total, rounds: s.outcomes.length, skips: s.skipsUsed, hints: s.outcomes.reduce((a, o) => a + o.hints.length, 0) });
  }
  if (cfg.mode === 'daily') {
    const d = useSession.getState().daily;
    const grid = s.outcomes.map((o) => o.cell).join('');
    const today = d?.day ?? rigaDay();
    const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const streakDays = await bumpDailyStreak(today, yesterday.toISOString().slice(0, 10));
    let submitted = { total, grid, shareText: null as string | null, synced: false };
    try {
      // submit_daily needs a chosen username (the board shows it); otherwise keep the local result
      if (useAuth.getState().hasUsername && isConfigured) {
        const r = await submitDaily();
        submitted = { total: r.total, grid: r.grid, shareText: r.share_text, synced: true };
      }
    } catch { /* keep local result, marked unsynced */ }
    await setDailyLocalResult({ day: today, number: d?.number ?? 0, total: submitted.total, grid: submitted.grid, outcomes: s.outcomes.map(toStored), synced: submitted.synced });
    await setDailyProgress(null);
    useSession.setState({ dailySubmitted: submitted });
    track('daily_complete', { daily_no: d?.number, total: submitted.total, grid: submitted.grid, streak_days: streakDays });
  }
}

// ─── public actions ───────────────────────────────────────────────────────────

function cancelTimers() {
  if (stagedTimer) clearTimeout(stagedTimer);
  if (deadlineTimer) clearTimeout(deadlineTimer);
  stagedTimer = deadlineTimer = null;
}

async function startSession(o: StartSessionOptions) {
  generation += 1;
  cancelTimers();
  loading = false;
  opts = o;
  const category = o.category ?? 'all';
  const region = o.region ?? null;
  const sessionId = o.sessionId ?? (o.mode === 'daily' ? 'daily' : [o.mode, category, region ?? ''].filter(Boolean).join(':'));
  const totalRounds = o.totalRounds !== undefined ? o.totalRounds
    : o.mode === 'streak' ? null
    : o.mode === 'daily' ? DAILY_ROUNDS
    : o.mode === 'solo' ? SOLO_ROUNDS
    : o.rounds?.length ?? 5;
  const config: SessionConfig = {
    sessionId, mode: o.mode, category, region, totalRounds, timerSec: o.timer, waitForOthers: o.waitForOthers,
    allowSkip: o.mode === 'solo' && !o.localScoring, allowHints: hintsAllowed(o.mode) && !o.localScoring, contextId: o.contextId,
  };
  useSession.setState({ ...initialState, daily: null, dailySubmitted: null, offline: false, hintTokens: await getHintTokens(), streakBest: 0 });

  if (o.mode === 'daily') {
    dispatch({ type: 'START', config });
    await loadDaily(generation, config);
    return;
  }
  dispatch({ type: 'START', config, rounds: o.rounds, streak: o.streak, outcomes: o.priorOutcomes });
}

async function loadDaily(gen: number, config: SessionConfig) {
  try {
    const set = await getDaily();
    if (gen !== generation) return;
    const meta: DailyMeta = { day: set.day, number: set.number, alreadyPlayed: set.already_played };
    useSession.setState({ daily: meta });
    if (set.already_played && set.result) {
      useSession.setState({ dailySubmitted: { total: set.result.total, grid: set.result.grid, shareText: null, synced: true } });
      dispatch({ type: 'END' });
      return;
    }
    // Resume: drop rounds already completed today.
    const progress = await getDailyProgress();
    const prior: Outcome[] = progress?.day === set.day
      ? progress.outcomes.map((so) => ({
        roundNo: so.round_no, guess: so.guess, price: so.price, score: so.score, rawScore: so.score, err: so.err,
        cell: so.cell as Outcome['cell'], hints: so.hints, timeMs: 0, sourceUrl: so.source_url,
        round: set.rounds.find((r) => r.id === so.listing_id) ?? { ...set.rounds[0], id: so.listing_id, location: so.location, title_hint: so.title_hint },
      }))
      : [];
    const doneIds = new Set(prior.map((p) => p.round.id));
    const remaining = set.rounds.filter((r) => !doneIds.has(r.id));
    if (remaining.length === 0 && prior.length > 0) {
      dispatch({ type: 'START', config, rounds: [], outcomes: prior });
      dispatch({ type: 'END' });
      return;
    }
    dispatch({ type: 'START', config, rounds: remaining, outcomes: prior });
    track('daily_start', { daily_no: set.number, resume: prior.length > 0 });
  } catch (e) {
    if (gen !== generation) return;
    const code = e instanceof RpcError ? e.code : 'network';
    useSession.setState({ offline: code === 'network' });
    dispatch({ type: 'LOAD_FAILED', error: code });
  }
}

export const sessionActions = {
  startSession,
  /** Called by the round screen when the player taps "Uzmini!". */
  submit(guess: number) {
    dispatch({ type: 'SUBMIT', guess, timeMs: Date.now() - guessStartedAt });
  },
  next() { dispatch({ type: 'NEXT' }); },
  skip() {
    const s = useSession.getState();
    track('round_skip', { listing_id: currentRound(s)?.id });
    dispatch({ type: 'SKIP' });
  },
  revealDone() { dispatch({ type: 'REVEAL_DONE' }); },
  retry() {
    const s = useSession.getState();
    if (s.prevPhase === 'LOADING') { dispatch({ type: 'RETRY' }); if (s.config?.mode === 'daily') void loadDaily(generation, s.config); else void ensurePool(); return; }
    dispatch({ type: 'RETRY' });
  },
  end() { dispatch({ type: 'END' }); },
  reset() { generation += 1; cancelTimers(); opts = null; useSession.setState({ ...initialState, daily: null, dailySubmitted: null }); },
  useHint(hint: HintType) {
    dispatch({ type: 'USE_HINT', hint });
    track('round_hint_use', { type: hint });
  },
  async spendHintToken(): Promise<boolean> {
    const n = await getHintTokens();
    if (n <= 0) return false;
    await setHintTokens(n - 1);
    useSession.setState({ hintTokens: n - 1 });
    return true;
  },

  // ── social integration ────────────────────────────────────────────────────
  /** Append rounds (duel/room snapshots, later batches). */
  injectRounds(rounds: Round[]) { dispatch({ type: 'ROUNDS_LOADED', rounds }); },
  /**
   * Reveal a round with results written by `private.close_round`.
   * `results` is `RoundResults[roundNo]` (user_id → {guess, score, price}) or a
   * flat `{ price, score?, others? }` object.
   */
  revealExternal(roundNo: number, results: RoundResults[string] | { price: number; score?: number; others?: Outcome['others'] }, myUserId?: string) {
    const s = useSession.getState();
    if (s.roundNo !== roundNo) return;
    if ('price' in results && typeof results.price === 'number' && !('guess' in results)) {
      const r = results as { price: number; score?: number; others?: Outcome['others'] };
      dispatch({ type: 'EXTERNAL_REVEAL', price: r.price, score: r.score, others: r.others });
      return;
    }
    const rows = results as RoundResults[string];
    const mine = myUserId ? rows[myUserId] : undefined;
    const price = mine?.price ?? Object.values(rows).find((v) => v.price != null)?.price;
    if (price == null) return;
    const others: Outcome['others'] = {};
    for (const [uid, v] of Object.entries(rows)) if (uid !== myUserId) others[uid] = { guess: v.guess, score: v.score };
    dispatch({ type: 'EXTERNAL_REVEAL', price, score: mine?.score ?? localScore(s.pendingGuess ?? 0, price), others });
  },
  /** Server-side deadline for the current round (duel/room `round_deadline`). */
  setDeadline(iso: string | null) { dispatch({ type: 'SET_DEADLINE', at: iso ? new Date(iso).getTime() : null }); },
  /** Directly set phase (social side may need WAITING_OTHERS → e.g. reconnect). */
  forcePhase(phase: Phase) { useSession.setState({ phase }); },
};

// ─── selectors ────────────────────────────────────────────────────────────────
export const selectCurrentRound = (s: SessionStore) => s.rounds[0];
export const selectTotal = (s: SessionStore) => totalScore(s);
export const selectGrid = (s: SessionStore) => s.outcomes.map((o) => o.cell).join('');
export { gridCell };
