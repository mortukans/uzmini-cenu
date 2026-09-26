/**
 * The round screen must never render a bare header (build 24: blank body after
 * a stale-token round). playViewFor() is the single switch the screen renders
 * from, so we check it is total over phase × round × outcome.
 */
import { describe, expect, it } from 'vitest';
import type { Round } from '../api/types';
import { initialState, type Outcome, type Phase } from './machine';
import { errorKeyFor, playViewFor } from './view';

const PHASES: Phase[] = ['LOADING', 'STAGED', 'GUESSING', 'SUBMITTING', 'WAITING_OTHERS', 'REVEALING', 'REVEALED', 'SUMMARY', 'ERROR'];
const round: Round = { id: 1, category: 'flats', region: 'riga', location: null, attributes: {}, title_hint: null, photo_urls: [], source: 'ss.com', source_url: 'https://ss.com/x', token: 't' };
const outcome: Outcome = { round, roundNo: 1, guess: 1, price: 1, score: 1000, rawScore: 1000, err: 0, cell: '🟩', hints: [], timeMs: 0, sourceUrl: '' };

describe('playViewFor', () => {
  it('returns a visible view for every phase, with or without a round / outcome', () => {
    for (const phase of PHASES) {
      for (const rounds of [[], [round]]) {
        for (const lastOutcome of [null, outcome]) {
          const v = playViewFor({ phase, rounds, lastOutcome });
          expect(['skeleton', 'error', 'play', 'waiting', 'reveal', 'summary']).toContain(v);
        }
      }
    }
  });

  it('ERROR always shows the error view (message + retry + close), regardless of rounds', () => {
    expect(playViewFor({ phase: 'ERROR', rounds: [], lastOutcome: null })).toBe('error');
    expect(playViewFor({ phase: 'ERROR', rounds: [round], lastOutcome: outcome })).toBe('error');
  });

  it('a reveal phase without an outcome is surfaced as a recoverable error, not a blank body', () => {
    expect(playViewFor({ phase: 'REVEALING', rounds: [round], lastOutcome: null })).toBe('error');
    expect(playViewFor({ phase: 'REVEALED', rounds: [round], lastOutcome: null })).toBe('error');
    expect(playViewFor({ phase: 'REVEALED', rounds: [round], lastOutcome: outcome })).toBe('reveal');
  });

  it('play phases without a round fall back to the skeleton (pool still loading)', () => {
    expect(playViewFor({ phase: 'GUESSING', rounds: [], lastOutcome: null })).toBe('skeleton');
    expect(playViewFor({ phase: 'GUESSING', rounds: [round], lastOutcome: null })).toBe('play');
    expect(playViewFor({ phase: 'WAITING_OTHERS', rounds: [round], lastOutcome: null })).toBe('waiting');
  });

  it('errorKeyFor picks a message for every error code', () => {
    const e = (error: string, prevPhase: Phase | null = 'LOADING') => errorKeyFor({ ...initialState, phase: 'ERROR', prevPhase, error });
    expect(e('empty_pool')).toBe('round.empty_pool');
    expect(e('network')).toBe('common.offline');
    expect(e('timeout')).toBe('common.offline');
    expect(e('rate_limited')).toBe('common.error');
    expect(e('network', 'GUESSING')).toBe('common.offline');
    expect(e('bad_token', 'GUESSING')).toBe('round.submit_failed');
    expect(errorKeyFor({ ...initialState, phase: 'REVEALED' })).toBe('common.error');
  });
});
