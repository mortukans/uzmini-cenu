/**
 * Hints (docs/02-game-design.md §5). Available in free play and streak only.
 * Penalties multiply the round score; grid colour is derived from error so it
 * is never affected.
 */
import type { Category, Mode } from '../api/types';

export type HintType = 'title' | 'bracket' | 'photo';

export const HINT_PENALTY: Record<HintType, number> = {
  title: 0.85,
  bracket: 0.7,
  photo: 0.9,
};

export const MAX_HINT_TOKENS = 3;
export const HINT_TOKEN_EVERY_HITS = 5;
export const MAX_REWARDED_HINTS_PER_DAY = 5;

/** Photos shown before the "extra photo" hint is used. */
export const PHOTOS_BEFORE_HINT = 3;

export const hintsAllowed = (mode: Mode) => mode === 'solo' || mode === 'streak';

export function penaltyMultiplier(hints: readonly HintType[]): number {
  return hints.reduce((acc, h) => acc * HINT_PENALTY[h], 1);
}

export function applyHintPenalty(score: number, hints: readonly HintType[]): number {
  return Math.round(score * penaltyMultiplier(hints));
}

/** Fixed bracket ladders, so a bucket cannot be inverted to the exact price. */
const PROPERTY_LADDER = [10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000];
const CAR_LADDER = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000];
const RANDOM_LADDER = [0, 10, 25, 50, 100, 250, 500, 1_000];

export function ladderFor(category: Category): number[] {
  if (category === 'cars') return CAR_LADDER;
  if (category === 'random') return RANDOM_LADDER;
  return PROPERTY_LADDER;
}

export interface Bracket { low: number; high: number | null }

/** The ladder bucket containing `price`. `high === null` means open-ended. */
export function bracketFor(category: Category, price: number): Bracket {
  const ladder = ladderFor(category);
  if (price < ladder[0]) return { low: 0, high: ladder[0] };
  for (let i = 0; i < ladder.length - 1; i++) {
    if (price >= ladder[i] && price < ladder[i + 1]) return { low: ladder[i], high: ladder[i + 1] };
  }
  return { low: ladder[ladder.length - 1], high: null };
}

/** Which hints can still be taken for a round. */
export function availableHints(opts: {
  mode: Mode;
  used: readonly HintType[];
  hasTitle: boolean;
  photoCount: number;
  bracketSupported: boolean;
}): HintType[] {
  if (!hintsAllowed(opts.mode)) return [];
  const out: HintType[] = [];
  if (opts.hasTitle && !opts.used.includes('title')) out.push('title');
  if (opts.bracketSupported && !opts.used.includes('bracket')) out.push('bracket');
  if (opts.photoCount > PHOTOS_BEFORE_HINT && !opts.used.includes('photo')) out.push('photo');
  return out;
}
