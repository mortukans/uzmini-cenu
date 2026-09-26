/**
 * Onboarding flow rules (src/game/onboarding.ts):
 *  - `onboarded` is persisted BEFORE the practice session starts (killing the
 *    app mid-practice must not restart onboarding)
 *  - practice always uses the bundled local set, scored locally
 *  - a restored account with a username skips practice (store flag consumed)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const storage = vi.hoisted(() => ({ setOnboarded: vi.fn(async () => { calls.push('setOnboarded'); }) }));
const session = vi.hoisted(() => ({ sessionActions: { startSession: vi.fn(async () => { calls.push('startSession'); }) } }));
const auth = vi.hoisted(() => {
  const state = { justRestored: false, hasUsername: false, clearJustRestored: vi.fn(() => { state.justRestored = false; }) };
  return { useAuth: { getState: () => state }, state };
});

vi.mock('./storage', () => storage);
vi.mock('./session', () => session);
vi.mock('../auth/store', () => ({ useAuth: auth.useAuth }));
vi.mock('../analytics', () => ({ track: vi.fn() }));

import { ONBOARDING_SET } from './onboardingSet';
import { PRACTICE_ROUNDS, markOnboarded, nextAfterLink, startPracticeSession } from './onboarding';

beforeEach(() => { calls.length = 0; storage.setOnboarded.mockClear(); session.sessionActions.startSession.mockClear(); auth.state.justRestored = false; });

describe('startPracticeSession', () => {
  it('persists onboarded first, then starts the bundled, locally scored set', async () => {
    await startPracticeSession();
    expect(calls).toEqual(['setOnboarded', 'startSession']);
    expect(storage.setOnboarded).toHaveBeenCalledWith(true);
    expect(session.sessionActions.startSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'solo', sessionId: 'onboarding', localScoring: true, rounds: ONBOARDING_SET, totalRounds: PRACTICE_ROUNDS,
    }));
    expect(PRACTICE_ROUNDS).toBe(3);
  });

  it('markOnboarded alone (skip / straight home) persists the flag', async () => {
    await markOnboarded();
    expect(storage.setOnboarded).toHaveBeenCalledWith(true);
  });
});

describe('nextAfterLink', () => {
  it('restored account with a username → home; the flag is consumed', () => {
    auth.state.justRestored = true;
    expect(nextAfterLink('restored')).toBe('home');
    expect(auth.state.clearJustRestored).toHaveBeenCalled();
    expect(auth.state.justRestored).toBe(false);
    expect(nextAfterLink('restored')).toBe('practice'); // flag already consumed
  });

  it('linked / unchanged / restored-without-username → practice', () => {
    expect(nextAfterLink('linked')).toBe('practice');
    expect(nextAfterLink('unchanged')).toBe('practice');
    auth.state.justRestored = false;
    expect(nextAfterLink('restored')).toBe('practice');
  });
});
