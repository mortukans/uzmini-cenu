/** Daily info sheet: how the score works, rules (docs/11 §2.7 "Kā skaita punktus?"). */
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Screen } from '../../src/ui/components';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const TABLE: Array<[string, number]> = [['0', 1000], ['5', 670], ['10', 449], ['15', 301], ['25', 135], ['50', 18], ['100', 0]];

export default function DailyInfo() {
  const { t } = useTranslation();
  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <Text style={styles.title}>{t('daily.how_scored')}</Text>
      <Text style={styles.body}>{t('daily.info_body')}</Text>
      <View style={styles.table}>
        {TABLE.map(([err, pts]) => (
          <View key={err} style={styles.row}>
            <Text style={styles.cell}>{t('daily.info_err', { pct: err })}</Text>
            <Text style={[styles.cell, styles.pts]}>{t('reveal.points', { n: pts })}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.body}>{t('daily.info_grid')}</Text>
      <Text style={styles.body}>{t('daily.info_reset')}</Text>
      <Button title={t('common.close')} variant="secondary" onPress={() => router.back()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...type.h1, color: colors.text, marginTop: spacing.lg },
  body: { ...type.body, color: colors.textMuted, marginTop: spacing.md, lineHeight: 22 },
  table: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.lg, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: 6 },
  cell: { ...type.body, color: colors.text, fontVariant: ['tabular-nums'] },
  pts: { color: colors.accent, fontWeight: '600' },
});
