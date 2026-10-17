/**
 * Bottom-sheet picker (same shell as the hint sheet in app/play/[sessionId]):
 * a search box and a list of options with counts, "Any …" first. Used by the
 * home screen for the car make / model filters.
 */
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { colors, radius, spacing, type } from '../theme';

export interface SheetOption { key: string; label: string; n?: number }

interface Props {
  visible: boolean;
  title: string;
  options: SheetOption[];
  /** Label of the first row that clears the selection. */
  anyLabel: string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onClose: () => void;
  searchPlaceholder: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  retryLabel: string;
  errorLabel: string;
  cancelLabel: string;
}

export function OptionSheet({
  visible, title, options, anyLabel, selected, onSelect, onClose, searchPlaceholder,
  loading, error, onRetry, retryLabel, errorLabel, cancelLabel,
}: Props) {
  const [q, setQ] = useState('');
  useEffect(() => { if (!visible) setQ(''); }, [visible]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
    return [{ key: '', label: anyLabel } as SheetOption, ...list];
  }, [options, q, anyLabel]);

  const pick = (key: string) => { onSelect(key || null); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop tap closes; the sheet is a sibling, not a child, of the tappable area (no nested buttons). */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={cancelLabel} />
        {/* Stop taps inside the sheet from closing it. */}
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel={searchPlaceholder}
          />
          {loading ? (
            <View style={styles.list}>
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={44} round={radius.md} style={{ marginTop: spacing.sm }} />)}
            </View>
          ) : error ? (
            <View style={[styles.list, styles.center]}>
              <Text style={styles.errorText}>{errorLabel}</Text>
              {onRetry && <Button title={retryLabel} variant="secondary" small onPress={onRetry} style={{ marginTop: spacing.md }} />}
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(o) => o.key || '__any__'}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const on = (item.key || null) === selected;
                return (
                  <Pressable onPress={() => pick(item.key)} style={[styles.row, on && styles.rowOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text style={[styles.rowLabel, on && styles.rowLabelOn]} numberOfLines={1}>{item.label}</Text>
                    {item.n != null && <Text style={styles.rowCount}>{item.n}</Text>}
                  </Pressable>
                );
              }}
            />
          )}
          <Button title={cancelLabel} variant="ghost" onPress={onClose} style={{ marginTop: spacing.sm }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: spacing.xxl, maxHeight: '80%' },
  title: { ...type.h2, color: colors.text },
  search: { ...type.body, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md, minHeight: 44 },
  list: { marginTop: spacing.sm, flexGrow: 0 },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  errorText: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: 44 },
  rowOn: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md },
  rowLabel: { ...type.body, color: colors.text, flexShrink: 1 },
  rowLabelOn: { color: colors.accent, fontWeight: '600' },
  rowCount: { ...type.small, color: colors.textMuted, marginLeft: spacing.md, fontVariant: ['tabular-nums'] },
});
