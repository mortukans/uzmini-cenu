/**
 * Custom numeric keypad logic (docs/02-game-design.md §1.2). Pure functions so
 * the reducer is unit-testable; the Keypad component only renders state.
 *
 * The value is an integer in EUR. 0 means "empty" (display shows `— €`).
 */
import type { Category, CategoryFilter, ListingAttributes } from '../api/types';
import { MAX_DIGITS, QUICK_STEPS } from './format';

export type KeypadAction =
  | { type: 'digit'; digit: number }
  | { type: 'triple_zero' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'step'; delta: number };

export const STEP_REPEAT_MS = 120;

export function maxDigitsFor(category: CategoryFilter): number {
  return MAX_DIGITS[category] ?? MAX_DIGITS.all;
}

export function maxValueFor(category: CategoryFilter): number {
  return 10 ** maxDigitsFor(category) - 1;
}

/** Quick steps as displayed left→right: [-big, -small, +small, +big]. */
export function quickStepsFor(category: CategoryFilter): [number, number, number, number] {
  const [small, big] = QUICK_STEPS[category] ?? QUICK_STEPS.all;
  return [-big, -small, small, big];
}

export function digitCount(value: number): number {
  return value <= 0 ? 0 : Math.floor(Math.log10(value)) + 1;
}

export function clampValue(value: number, category: CategoryFilter): number {
  const max = maxValueFor(category);
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Whether the `000` key is enabled for the current value. */
export function canTripleZero(value: number, category: CategoryFilter): boolean {
  return value > 0 && digitCount(value) + 3 <= maxDigitsFor(category);
}

export function canAppendDigit(value: number, category: CategoryFilter): boolean {
  return digitCount(value) < maxDigitsFor(category);
}

export function keypadReduce(value: number, action: KeypadAction, category: CategoryFilter): number {
  switch (action.type) {
    case 'digit': {
      const d = Math.trunc(action.digit);
      if (d < 0 || d > 9) return value;
      if (value === 0 && d === 0) return 0; // leading zeros dropped
      if (!canAppendDigit(value, category)) return value;
      return value * 10 + d;
    }
    case 'triple_zero':
      return canTripleZero(value, category) ? value * 1000 : value;
    case 'backspace':
      return Math.floor(value / 10);
    case 'clear':
      return 0;
    case 'step':
      return clampValue(value + action.delta, category);
    default:
      return value;
  }
}

export const canSubmit = (value: number) => Number.isFinite(value) && value >= 1;

/** `+1k` / `−500` / `+10` labels. */
export function stepLabel(delta: number): string {
  const sign = delta < 0 ? '−' : '+';
  const abs = Math.abs(delta);
  if (abs >= 1000 && abs % 1000 === 0) return `${sign}${abs / 1000}k`;
  return `${sign}${abs}`;
}

export type DerivedValue = { kind: 'per_m2' | 'per_ha'; value: number } | null;

/** Live derived value under the display: €/m² for flats/houses, €/ha for land. */
export function derivedValue(value: number, category: Category, attrs: ListingAttributes): DerivedValue {
  if (value <= 0) return null;
  if ((category === 'flats' || category === 'houses') && attrs.m2 && attrs.m2 > 0) {
    return { kind: 'per_m2', value: Math.round(value / attrs.m2) };
  }
  if (category === 'land' && attrs.land_m2 && attrs.land_m2 > 0) {
    return { kind: 'per_ha', value: Math.round(value / (attrs.land_m2 / 10_000)) };
  }
  return null;
}
