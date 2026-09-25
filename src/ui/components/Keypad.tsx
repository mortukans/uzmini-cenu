/**
 * Custom numeric keypad (docs/02 §1.2). Never the system keyboard. Renders a
 * value owned by the parent; all logic is in src/game/keypad.ts.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Category, CategoryFilter, ListingAttributes } from '../../api/types';
import { formatEur } from '../../game/format';
import {
  STEP_REPEAT_MS, canSubmit, canTripleZero, derivedValue, keypadReduce, quickStepsFor, stepLabel, type KeypadAction,
} from '../../game/keypad';
import { currentLang } from '../../i18n';
import { haptic } from '../haptics';
import { colors, radius, spacing, type } from '../theme';
import { Button } from './Button';

interface Props {
  value: number;
  onChange: (v: number) => void;
  onSubmit: () => void;
  category: CategoryFilter;
  /** Real category of the listing for derived €/m² (differs from filter 'all'). */
  listingCategory: Category;
  attributes: ListingAttributes;
  disabled?: boolean;
  submitting?: boolean;
  onStats?: (kind: 'digit' | 'step') => void;
}

export function Keypad({ value, onChange, onSubmit, category, listingCategory, attributes, disabled, submitting, onStats }: Props) {
  const { t } = useTranslation();
  const lang = currentLang();
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRepeat = useCallback(() => { if (repeat.current) { clearInterval(repeat.current); repeat.current = null; } }, []);
  useEffect(() => stopRepeat, [stopRepeat]);

  const act = useCallback((a: KeypadAction) => {
    const next = keypadReduce(valueRef.current, a, category);
    if (next !== valueRef.current) { valueRef.current = next; onChange(next); }
    onStats?.(a.type === 'step' ? 'step' : 'digit');
  }, [category, onChange, onStats]);

  const press = (a: KeypadAction) => () => { void (a.type === 'step' ? haptic.step() : haptic.key()); act(a); };

  const startRepeat = (a: KeypadAction) => () => {
    stopRepeat();
    repeat.current = setInterval(() => act(a), STEP_REPEAT_MS);
  };

  const steps = quickStepsFor(category);
  const derived = derivedValue(value, listingCategory, attributes);
  const tripleOk = canTripleZero(value, category);

  const keyStyle = (pressed: boolean, off = false) => [styles.key, pressed && styles.keyPressed, (disabled || off) && styles.keyOff];

  return (
    <View style={styles.root} accessible={false}>
      <View style={styles.display} accessibilityRole="text" accessibilityLabel={value > 0 ? formatEur(value, lang) : t('keypad.empty')}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{formatEur(value > 0 ? value : null, lang)}</Text>
        <Text style={styles.derived}>
          {derived ? (derived.kind === 'per_m2' ? t('keypad.per_m2', { value: formatEur(derived.value, lang) }) : t('keypad.per_ha', { value: formatEur(derived.value, lang) })) : ' '}
        </Text>
      </View>

      <View style={styles.row}>
        {steps.map((d, i) => (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={stepLabel(d)}
            disabled={disabled}
            onPress={press({ type: 'step', delta: d })}
            onLongPress={startRepeat({ type: 'step', delta: d })}
            onPressOut={stopRepeat}
            delayLongPress={300}
            style={({ pressed }) => [...keyStyle(pressed), styles.stepKey, i === 1 && styles.stepGapRight]}
          >
            <Text style={styles.stepLabel}>{stepLabel(d)}</Text>
          </Pressable>
        ))}
      </View>

      {[[1, 2, 3], [4, 5, 6], [7, 8, 9]].map((row) => (
        <View style={styles.row} key={row[0]}>
          {row.map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={String(n)} disabled={disabled}
              onPress={press({ type: 'digit', digit: n })} style={({ pressed }) => keyStyle(pressed)}>
              <Text style={styles.digit}>{n}</Text>
            </Pressable>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('keypad.triple_zero')} disabled={disabled || !tripleOk}
          onPress={press({ type: 'triple_zero' })} style={({ pressed }) => keyStyle(pressed, !tripleOk)}>
          <Text style={styles.digit}>000</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="0" disabled={disabled}
          onPress={press({ type: 'digit', digit: 0 })} style={({ pressed }) => keyStyle(pressed)}>
          <Text style={styles.digit}>0</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('keypad.backspace')} accessibilityHint={t('keypad.backspace_hint')} disabled={disabled}
          onPress={press({ type: 'backspace' })} onLongPress={press({ type: 'clear' })} style={({ pressed }) => keyStyle(pressed)}>
          <Text style={styles.digit}>⌫</Text>
        </Pressable>
      </View>

      <Button
        title={t('round.guess_cta')}
        onPress={() => { void haptic.submit(); onSubmit(); }}
        disabled={disabled || !canSubmit(value)}
        loading={submitting}
        style={styles.submit}
      />
    </View>
  );
}

const KEY_H = 56;

const styles = StyleSheet.create({
  root: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 6 },
  display: { alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingBottom: 2 },
  value: { fontSize: type.mono.fontSize, fontWeight: type.mono.fontWeight, color: colors.text, fontVariant: ['tabular-nums'] },
  derived: { ...type.small, color: colors.textMuted, fontVariant: ['tabular-nums'], minHeight: 16 },
  row: { flexDirection: 'row', gap: 6 },
  key: {
    flex: 1, height: KEY_H, borderRadius: radius.md, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.surfaceAlt },
  keyOff: { opacity: 0.35 },
  stepKey: { height: 44, backgroundColor: colors.surfaceAlt },
  stepGapRight: { marginRight: spacing.md },
  stepLabel: { ...type.body, fontWeight: '600', color: colors.accent, fontVariant: ['tabular-nums'] },
  digit: { fontSize: 24, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  submit: { marginTop: spacing.xs },
});
