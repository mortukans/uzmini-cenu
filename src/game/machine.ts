/**
 * Round/session state machine (docs/02-game-design.md §1.1) as a pure reducer.
 * No I/O here: src/game/session.ts wraps it with fetching, prefetch, RPC calls
 * and timers. Every mode (solo, streak, daily, duel, room) drives this reducer.
 */
import type { CategoryFilter, Mode, Region, Round } from '../api/types';
import { gridCell, relativeError, streakSurvives, type GridCell } from './scoring';
import { applyHintPenalty, type HintType } from './hints';

export type Phase =
  | 'LOADING' | 'STAGED' | 'GUESSING' | 'SUBMITTING' | 'WAITING_OTHERS'
  | 'REVEALING' | 'REVEALED' | 'SUMMARY' | 'ERROR';

export const MAX_SUBMIT_RETRIES = 3;
export const MAX_SKIPS = 2;
export const SOLO_ROUNDS = 10;
export const DAILY_ROUNDS = 5;
export const STAGED_TIMEOUT_MS = 2000;
export const REVEAL_ANIM_MS = 1200;

export interface SessionConfig {
  sessionId: string;
  mode: Mode;
  category: CategoryFilter;
  region: Region | null;
  /** Number of scored rounds in the session; null = until the streak breaks. */
  totalRounds: number | null;
  /** Seconds per round (duel/room); undefined = no timer. */
  timerSec?: number;
  /** Duel/room: after our guess is accepted wait for `revealExternal`. */
  waitForOthers?: boolean;
  allowSkip: boolean;
  allowHints: boolean;
  /** Free-form id the social side uses (duel id, room code). */
  contextId?: string;
}

export interface Outcome {
  round: Round;
  roundNo: number;
  guess: number;
  price: number;
  /** Server score after hint penalties (0 when auto-submitted at deadline). */
  score: number;
  rawScore: number;
  err: number;
  cell: GridCell;
  hints: HintType[];
  timeMs: number;
  sourceUrl: string;
  /** Duel/room: other players' guesses for the round. */
  others?: Record<string, { guess: number; score: number }>;
}

export interface SessionState {
  config: SessionConfig | null;
  phase: Phase;
  /** Phase to return to after ERROR → RETRY. */
  prevPhase: Phase | null;
  /** Queue of rounds not yet played (index 0 = current when phase ≥ STAGED). */
  rounds: Round[];
  /** 1-based scored round counter (skips do not advance it). */
  roundNo: number;
  outcomes: Outcome[];
  /** Guess being submitted / awaiting external reveal. */
  pendingGuess: number | null;
  pendingTimeMs: number;
  /** Set on SUBMIT_OK before the reveal animation ends. */
  lastOutcome: Outcome | null;
  hintsUsed: HintType[];
  skipsUsed: number;
  submitRetries: number;
  error: string | null;
  /** Streak mode */
  streak: number;
  streakOver: boolean;
  /** Last N excluded listing ids for get_rounds(exclude) */
  servedIds: number[];
  /** Duel/room deadline as epoch ms. */
  deadlineAt: number | null;
}

export const initialState: SessionState = {
  config: null,
  phase: 'LOADING',
  prevPhase: null,
  rounds: [],
  roundNo: 1,
  outcomes: [],
  pendingGuess: null,
  pendingTimeMs: 0,
  lastOutcome: null,
  hintsUsed: [],
  skipsUsed: 0,
  submitRetries: 0,
  error: null,
  streak: 0,
  streakOver: false,
  servedIds: [],
  deadlineAt: null,
};

export type Action =
  | { type: 'START'; config: SessionConfig; rounds?: Round[]; streak?: number; outcomes?: Outcome[] }
  | { type: 'ROUNDS_LOADED'; rounds: Round[] }
  | { type: 'LOAD_FAILED'; error: string }
  | { type: 'PHOTO_READY' }
  | { type: 'SUBMIT'; guess: number; timeMs: number }
  | { type: 'SUBMIT_OK'; price: number; score: number; sourceUrl?: string; others?: Outcome['others'] }
  | { type: 'SUBMIT_FAILED'; error: string }
  | { type: 'EXTERNAL_REVEAL'; price: number; score?: number; others?: Outcome['others'] }
  | { type: 'REVEAL_DONE' }
  | { type: 'NEXT' }
  | { type: 'SKIP' }
  | { type: 'USE_HINT'; hint: HintType }
  | { type: 'DEADLINE'; timeMs: number }
  | { type: 'SET_DEADLINE'; at: number | null }
  | { type: 'RETRY' }
  | { type: 'END' }
  | { type: 'RESET' };

export const currentRound = (s: SessionState): Round | undefined => s.rounds[0];
export const totalScore = (s: SessionState): number => s.outcomes.reduce((a, o) => a + o.score, 0);
export const maxScore = (s: SessionState): number | null => (s.config?.totalRounds ? s.config.totalRounds * 1000 : null);
export const isLastRound = (s: SessionState): boolean =>
  s.config?.totalRounds != null && s.roundNo >= s.config.totalRounds;

function buildOutcome(s: SessionState, price: number, rawScore: number, sourceUrl?: string, others?: Outcome['others']): Outcome {
  const round = currentRound(s)!;
  const guess = s.pendingGuess ?? 0;
  const err = relativeError(guess, price);
  const scored = guess > 0 ? applyHintPenalty(rawScore, s.hintsUsed) : 0;
  return {
    round, roundNo: s.roundNo, guess, price, score: scored, rawScore, err,
    cell: gridCell(guess, price), hints: s.hintsUsed, timeMs: s.pendingTimeMs,
    sourceUrl: sourceUrl ?? round.source_url, others,
  };
}

function stage(s: SessionState): SessionState {
  if (s.rounds.length === 0) return { ...s, phase: 'LOADING' };
  return { ...s, phase: 'STAGED', hintsUsed: [], pendingGuess: null, pendingTimeMs: 0, submitRetries: 0, error: null };
}

export function reduce(s: SessionState, a: Action): SessionState {
  switch (a.type) {
    case 'RESET':
      return initialState;

    case 'START': {
      const base: SessionState = {
        ...initialState,
        config: a.config,
        streak: a.streak ?? 0,
        outcomes: a.outcomes ?? [],
        roundNo: (a.outcomes?.length ?? 0) + 1,
        rounds: a.rounds ?? [],
        servedIds: a.rounds?.map((r) => r.id) ?? [],
      };
      return a.rounds && a.rounds.length ? stage(base) : base;
    }

    case 'ROUNDS_LOADED': {
      const seen = new Set([...s.servedIds, ...s.rounds.map((r) => r.id)]);
      const fresh = a.rounds.filter((r) => !seen.has(r.id));
      const rounds = [...s.rounds, ...fresh];
      const next = { ...s, rounds, servedIds: [...s.servedIds, ...fresh.map((r) => r.id)].slice(-200), error: null };
      if (s.phase === 'LOADING') {
        if (rounds.length === 0) return { ...next, phase: 'ERROR', prevPhase: 'LOADING', error: 'empty_pool' };
        return stage(next);
      }
      return next;
    }

    case 'LOAD_FAILED':
      return s.phase === 'LOADING' ? { ...s, phase: 'ERROR', prevPhase: 'LOADING', error: a.error } : s;

    case 'PHOTO_READY':
      return s.phase === 'STAGED' ? { ...s, phase: 'GUESSING' } : s;

    case 'SET_DEADLINE':
      return { ...s, deadlineAt: a.at };

    case 'SUBMIT':
      if (s.phase !== 'GUESSING' || a.guess < 1) return s;
      return { ...s, phase: 'SUBMITTING', pendingGuess: a.guess, pendingTimeMs: a.timeMs, error: null };

    case 'DEADLINE': {
      // Timed modes: auto-submit the current value (0 = no guess → scores 0).
      if (s.phase !== 'GUESSING' && s.phase !== 'STAGED') return s;
      return { ...s, phase: 'SUBMITTING', pendingGuess: s.pendingGuess ?? 0, pendingTimeMs: a.timeMs };
    }

    case 'SUBMIT_OK': {
      if (s.phase !== 'SUBMITTING') return s;
      if (s.config?.waitForOthers && a.others == null) {
        return { ...s, phase: 'WAITING_OTHERS', submitRetries: 0 };
      }
      const outcome = buildOutcome(s, a.price, a.score, a.sourceUrl, a.others);
      return { ...s, phase: 'REVEALING', lastOutcome: outcome, submitRetries: 0 };
    }

    case 'SUBMIT_FAILED': {
      if (s.phase !== 'SUBMITTING') return s;
      const retries = s.submitRetries + 1;
      if (retries >= MAX_SUBMIT_RETRIES) {
        return { ...s, phase: 'ERROR', prevPhase: 'GUESSING', submitRetries: retries, error: a.error };
      }
      // Keep the guess; the store retries, we stay in SUBMITTING.
      return { ...s, submitRetries: retries, error: a.error };
    }

    case 'EXTERNAL_REVEAL': {
      if (s.phase !== 'WAITING_OTHERS' && s.phase !== 'SUBMITTING' && s.phase !== 'GUESSING' && s.phase !== 'STAGED') return s;
      const raw = a.score ?? 0;
      const outcome = buildOutcome(s, a.price, raw, undefined, a.others);
      return { ...s, phase: 'REVEALING', lastOutcome: outcome, submitRetries: 0 };
    }

    case 'REVEAL_DONE': {
      if (s.phase !== 'REVEALING' || !s.lastOutcome) return s;
      const o = s.lastOutcome;
      const outcomes = [...s.outcomes, o];
      let streak = s.streak;
      let streakOver = s.streakOver;
      if (s.config?.mode === 'streak') {
        if (streakSurvives(o.guess, o.price)) streak += 1;
        else streakOver = true;
      }
      return { ...s, phase: 'REVEALED', outcomes, streak, streakOver };
    }

    case 'NEXT': {
      if (s.phase !== 'REVEALED') return s;
      const done = s.streakOver || (s.config?.totalRounds != null && s.outcomes.length >= s.config.totalRounds);
      if (done) return { ...s, phase: 'SUMMARY', lastOutcome: null };
      const rest = s.rounds.slice(1);
      return stage({ ...s, rounds: rest, roundNo: s.roundNo + 1, lastOutcome: null, deadlineAt: null });
    }

    case 'SKIP': {
      if (!s.config?.allowSkip || s.skipsUsed >= MAX_SKIPS) return s;
      if (s.phase !== 'GUESSING' && s.phase !== 'STAGED') return s;
      const rest = s.rounds.slice(1);
      return stage({ ...s, rounds: rest, skipsUsed: s.skipsUsed + 1 });
    }

    case 'USE_HINT': {
      if (!s.config?.allowHints || s.phase !== 'GUESSING' || s.hintsUsed.includes(a.hint)) return s;
      return { ...s, hintsUsed: [...s.hintsUsed, a.hint] };
    }

    case 'RETRY': {
      if (s.phase !== 'ERROR') return s;
      const back = s.prevPhase ?? 'LOADING';
      if (back === 'GUESSING' && s.pendingGuess) {
        return { ...s, phase: 'SUBMITTING', prevPhase: null, submitRetries: 0, error: null };
      }
      return { ...s, phase: back, prevPhase: null, submitRetries: 0, error: null };
    }

    case 'END':
      return { ...s, phase: 'SUMMARY', lastOutcome: null };

    default:
      return s;
  }
}

/** Build the sessionId string used by `play/[sessionId]`. */
export function encodeSessionId(mode: Mode, category: CategoryFilter = 'all', region: Region | null = null): string {
  if (mode === 'daily') return 'daily';
  return [mode, category, region ?? ''].filter(Boolean).join(':');
}

export interface ParsedSessionId {
  mode: Mode;
  category: CategoryFilter;
  region: Region | null;
  contextId: string | null;
}

export function parseSessionId(id: string): ParsedSessionId {
  const [head, p1, p2] = id.split(':');
  const categories: CategoryFilter[] = ['flats', 'houses', 'cars', 'random', 'land', 'all'];
  const regions: Region[] = ['riga', 'riga_region', 'latvia'];
  if (head === 'daily') return { mode: 'daily', category: 'all', region: null, contextId: null };
  if (head === 'duel' || head === 'room') return { mode: head, category: 'all', region: null, contextId: p1 ?? null };
  const mode: Mode = head === 'streak' ? 'streak' : 'solo';
  const category = (categories as string[]).includes(p1) ? (p1 as CategoryFilter) : 'all';
  const region = (regions as string[]).includes(p2) ? (p2 as Region) : null;
  return { mode, category, region, contextId: null };
}
