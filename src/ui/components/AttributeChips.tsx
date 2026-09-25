/**
 * Per-category visible attributes (docs/02 §4.1). `reveal` adds the
 * after-reveal fields (building type, colour, inspection…).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Category, ListingAttributes, StrippedListing } from '../../api/types';
import { formatKm } from '../../game/format';
import { colors, radius, spacing, type } from '../theme';

const grouped = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function landLabel(m2: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (m2 >= 10_000) return t('attr.ha', { n: (m2 / 10_000).toFixed(1).replace('.', ',').replace(',0', '') });
  return t('attr.m2', { n: grouped(m2) });
}

export function attributeChips(listing: Pick<StrippedListing, 'category' | 'attributes'>, reveal: boolean, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const a: ListingAttributes = listing.attributes ?? {};
  const out: string[] = [];
  switch (listing.category as Category) {
    case 'flats':
      if (a.rooms) out.push(t('attr.rooms', { n: a.rooms }));
      if (a.m2) out.push(t('attr.m2', { n: grouped(a.m2) }));
      if (a.floor) out.push(a.floors_total ? `${a.floor}/${a.floors_total}` : t('attr.floor', { n: a.floor }));
      if (a.series) out.push(a.series);
      if (reveal && a.house_type) out.push(a.house_type);
      break;
    case 'houses':
      if (a.m2) out.push(t('attr.m2', { n: grouped(a.m2) }));
      if (a.land_m2) out.push(t('attr.land', { v: landLabel(a.land_m2, t) }));
      if (a.floors_total) out.push(t('attr.floors', { n: a.floors_total }));
      if (a.year) out.push(String(a.year));
      if (reveal && a.rooms) out.push(t('attr.rooms', { n: a.rooms }));
      break;
    case 'cars':
      if (a.year) out.push(String(a.year));
      if (a.engine_l || a.fuel) out.push([a.engine_l ? a.engine_l.toFixed(1) : null, a.fuel ? t(`attr.fuel.${a.fuel}`) : null].filter(Boolean).join(' '));
      if (a.gearbox) out.push(t(`attr.gearbox.${a.gearbox}`));
      if (a.km != null) out.push(formatKm(a.km));
      if (reveal && a.color) out.push(a.color);
      if (reveal && a.body) out.push(a.body);
      if (reveal && a.inspection_until) out.push(t('attr.inspection', { until: a.inspection_until }));
      break;
    case 'random':
      if (a.subcategory) out.push(a.subcategory);
      if (a.condition) out.push(a.condition);
      if (a.manufacturer) out.push(a.manufacturer);
      break;
    case 'land':
      if (a.land_m2) out.push(landLabel(a.land_m2, t));
      if (a.subcategory) out.push(a.subcategory);
      break;
  }
  return out.filter((s) => s && s.trim().length > 0);
}

/** Header line: `DZĪVOKLIS · Purvciems` or `Volkswagen Golf` for cars. */
export function headerFor(listing: Pick<StrippedListing, 'category' | 'attributes' | 'location'>, t: (k: string) => string): { title: string; subtitle: string | null } {
  const a = listing.attributes ?? {};
  if (listing.category === 'cars' && (a.make || a.model)) {
    return { title: [a.make, a.model].filter(Boolean).join(' '), subtitle: listing.location };
  }
  return { title: t(`category.${listing.category}`), subtitle: listing.location };
}

interface Props { listing: Pick<StrippedListing, 'category' | 'attributes' | 'location'>; reveal?: boolean; compact?: boolean }

export function AttributeChips({ listing, reveal = false, compact }: Props) {
  const { t } = useTranslation();
  const chips = attributeChips(listing, reveal, t);
  const label = chips.join(', ');
  return (
    <View style={styles.wrap} accessible accessibilityLabel={label}>
      {chips.map((c, i) => (
        <View key={`${c}-${i}`} style={[styles.chip, compact && styles.chipCompact]}>
          <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={1}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  chipCompact: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  text: { ...type.small, color: colors.text, fontSize: 14 },
  textCompact: { fontSize: 12 },
});
