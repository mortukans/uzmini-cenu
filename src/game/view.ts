/**
 * Which block the round screen (app/play/[sessionId]) shows for a session
 * state. Pure and exhaustive on purpose: every phase maps to *something*
 * visible, so the screen can never be a bare header (TestFlight build 24:
 * a stale-token round left the body empty with no way out).
 */
import type { SessionState } from './machine';

export type PlayView = 'skeleton' | 'error' | 'play' | 'waiting' | 'reveal' | 'summary';

export function playViewFor(s: Pick<SessionState, 'phase' | 'rounds' | 'lastOutcome'>): PlayView {
  switch (s.phase) {
    case 'ERROR': return 'error';
    case 'SUMMARY': return 'summary';
    case 'LOADING': return 'skeleton';
    case 'STAGED':
    case 'GUESSING':
    case 'SUBMITTING':
      return s.rounds[0] ? 'play' : 'skeleton';
    case 'WAITING_OTHERS':
      return s.rounds[0] ? 'waiting' : 'skeleton';
    case 'REVEALING':
    case 'REVEALED':
      // A reveal without an outcome is an inconsistent state: recoverable error, never a blank body.
      return s.rounds[0] && s.lastOutcome ? 'reveal' : 'error';
    default:
      return 'error';
  }
}

/** i18n key for the ERROR view (common/round namespaces). */
export function errorKeyFor(s: Pick<SessionState, 'phase' | 'prevPhase' | 'error'>): string {
  if (s.phase !== 'ERROR') return 'common.error';
  if (s.error === 'empty_pool') return 'round.empty_pool';
  if (s.error === 'network' || s.error === 'timeout') return 'common.offline';
  return s.prevPhase === 'GUESSING' ? 'round.submit_failed' : 'common.error';
}
