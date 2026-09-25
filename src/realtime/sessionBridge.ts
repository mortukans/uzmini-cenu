/**
 * sessionBridge — the ONLY place the social screens touch the core game's
 * session store (src/game/session.ts, owned by the core agent).
 *
 * The duel/room screens are self-contained (RoundPanel.tsx) and work without
 * this bridge. When the integrator wants the shared play/[sessionId] screen to
 * host duel/room rounds instead, they call `registerSession(sessionActions)`
 * once at startup; the screens then use `bridge()` to inject rounds and to
 * reveal external results. Expected shape of src/game/session.ts:
 *
 *   startSession(opts: { mode: Mode; rounds: Round[]; timer?: number; waitForOthers?: boolean }): string // sessionId
 *   sessionActions.injectRounds(sessionId: string, rounds: Round[]): void
 *   sessionActions.revealExternal(roundNo: number, results: RoundResults[string], price?: number): void
 *   submit(sessionId: string, guessEur: number): Promise<GuessResult>
 *   next(sessionId: string): void
 */
import type { Mode, Round, RoundResults, GuessResult } from '../api/types';

export interface SessionBridge {
  startSession(opts: { mode: Mode; rounds: Round[]; timer?: number; waitForOthers?: boolean }): string;
  injectRounds(sessionId: string, rounds: Round[]): void;
  revealExternal(roundNo: number, results: RoundResults[string], price?: number): void;
  submit(sessionId: string, guessEur: number): Promise<GuessResult>;
  next(sessionId: string): void;
}

let impl: SessionBridge | null = null;

/** Integrator: call once (e.g. in app/_layout.tsx) with an adapter over src/game/session.ts. */
export function registerSession(bridge: SessionBridge) {
  impl = bridge;
}

/** null when the core store is not wired → screens fall back to RoundPanel. */
export const bridge = (): SessionBridge | null => impl;

/** Build `Round[]` for the core store from a duel/room snapshot + tokens. */
export function roundsFromSnapshot(
  snapshot: Array<Omit<Round, 'token' | 'round_no'>>,
  tokens: Array<{ round_no: number; listing_id: number; token: string }>,
): Round[] {
  return snapshot.map((s, i) => {
    const t = tokens.find((x) => x.listing_id === s.id) ?? tokens[i];
    return { ...s, token: t?.token ?? '', round_no: t?.round_no ?? i + 1 };
  });
}
