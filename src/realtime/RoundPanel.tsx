/**
 * RoundPanel / RevealPanel — self-contained round UI for duel and room screens.
 *
 * Deliberately independent of the core agent's src/ui/components/{Keypad,
 * PhotoCarousel, AttributeChips, RevealCard}: those may not exist yet. The
 * integrator can replace the inner blocks with the shared components; the
 * props of RoundPanel are the seam (listing, deadline, onSubmit, header).
 *
 * Depends on: expo-image, src/game/format (formatEur, QUICK_STEPS, MAX_DIGITS),
 * src/ui/theme, src/ui/components/{Timer,Avatar,StatusChip}, i18n `social` ns.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Category, ListingAttributes, StrippedListing } from '../api/types';
import { formatEur, MAX_DIGITS, QUICK_STEPS } from '../game/format';
import { currentLang } from '../i18n';
import { colors, radius, spacing, type } from '../ui/theme';
import { Avatar } from '../ui/components/Avatar';
import { StatusChip } from '../ui/components/StatusChip';
import { Timer } from '../ui/components/Timer';

// Local copy of theme.type.mono: the theme's readonly tuple is not assignable to TextStyle.fontVariant.
const mono = { fontSize: 36, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] };

// ─── helpers ─────────────────────────────────────────────────────────────────

export function attributeChips(a: ListingAttributes, category: Category): string[] {
  const out: string[] = [];
  const push = (v: unknown, fmt: (x: never) => string = String) => {
    if (v !== undefined && v !== null && v !== '') out.push(fmt(v as never));
  };
  if (category === 'cars') {
    push(a.make && a.model ? `${a.make} ${a.model}` : a.make ?? a.model);
    push(a.year);
    push(a.engine_l, (x: number) => `${x} L`);
    push(a.fuel);
    push(a.gearbox);
    push(a.km, (x: number) => `${x.toLocaleString('lv-LV')} km`);
    push(a.body);
    push(a.color);
  } else {
    push(a.town ?? a.district);
    push(a.rooms, (x: number) => `${x} ist.`);
    push(a.m2, (x: number) => `${x} m²`);
    push(a.land_m2, (x: number) => `${x} m² zeme`);
    if (a.floor) push(`${a.floor}${a.floors_total ? `/${a.floors_total}` : ''} st.`);
    push(a.series);
    push(a.house_type);
    push(a.subcategory);
    push(a.condition);
    push(a.manufacturer);
  }
  return out.slice(0, 8);
}

// ─── RoundPanel ──────────────────────────────────────────────────────────────

interface RoundPanelProps {
  listing: StrippedListing;
  roundNo: number;
  totalRounds: number;
  /** ISO server deadline; omitted in async duels (no timer). */
  deadline?: string | null;
  offsetMs?: number;
  onDeadline?: () => void;
  /** Header right/center slot: score strip, submitted counter, etc. */
  header?: ReactNode;
  disabled?: boolean;
  submitting?: boolean;
  onSubmit: (guessEur: number) => void;
  onClose?: () => void;
}

export function RoundPanel({
  listing, roundNo, totalRounds, deadline, offsetMs = 0, onDeadline, header, disabled, submitting, onSubmit, onClose,
}: RoundPanelProps) {
  const { t } = useTranslation('social');
  const { width } = useWindowDimensions();
  const [digits, setDigits] = useState('');
  const [photo, setPhoto] = useState(0);
  const cat = listing.category;
  const maxDigits = MAX_DIGITS[cat] ?? 7;
  const [stepSmall, stepBig] = QUICK_STEPS[cat] ?? QUICK_STEPS.all;
  const value = digits ? Number(digits) : 0;
  const chips = useMemo(() => attributeChips(listing.attributes ?? {}, cat), [listing, cat]);
  const photos = listing.photo_urls?.length ? listing.photo_urls : [];
  const lang = currentLang();

  const setValue = (n: number) => setDigits(n <= 0 ? '' : String(Math.min(n, 10 ** maxDigits - 1)));
  const tap = (k: string) => {
    if (disabled) return;
    if (k === '⌫') return setDigits((d) => d.slice(0, -1));
    if (k === '000') return setDigits((d) => (d ? (d + '000').slice(0, maxDigits) : d));
    setDigits((d) => (d + k).replace(/^0+/, '').slice(0, maxDigits));
  };
  const canSubmit = value > 0 && !disabled && !submitting;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md }}>
        <Pressable onPress={onClose} hitSlop={12} disabled={!onClose}>
          <Text style={{ color: colors.textMuted, fontSize: 20 }}>{onClose ? '✕' : ' '}</Text>
        </Pressable>
        <Text style={[type.h3, { color: colors.text }]}>
          {t('round.counter', { n: roundNo, total: totalRounds })}
        </Text>
        <View style={{ flex: 1 }}>{header}</View>
        {deadline ? <Timer deadline={deadline} offsetMs={offsetMs} onZero={onDeadline} compact /> : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }} bounces={false}>
        {/* photo */}
        <View style={{ marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface }}>
          {photos.length ? (
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPhoto(Math.round(e.nativeEvent.contentOffset.x / (width - spacing.lg * 2)))}
            >
              {photos.slice(0, 6).map((u) => (
                <Image
                  key={u} source={{ uri: u }} cachePolicy="disk" recyclingKey={String(listing.id)} contentFit="cover"
                  style={{ width: width - spacing.lg * 2, height: 220 }}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.textMuted }}>{t('round.noPhoto')}</Text>
            </View>
          )}
          {photos.length > 1 && (
            <View style={{ position: 'absolute', right: spacing.sm, bottom: spacing.sm }}>
              <StatusChip label={`${photo + 1}/${Math.min(photos.length, 6)}`} tone="neutral" />
            </View>
          )}
        </View>

        {/* attributes */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <StatusChip label={t(`category.${cat}`)} tone="accent" />
          {listing.location ? <StatusChip label={listing.location} /> : null}
          {chips.map((c, i) => <StatusChip key={i} label={c} />)}
        </View>

        {/* value */}
        <Text style={[mono, { color: value ? colors.text : colors.textMuted, textAlign: "center", marginTop: spacing.lg }]}>
          {value ? formatEur(value, lang) : t('round.placeholder')}
        </Text>

        {/* quick steps */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.lg }}>
          {[-stepBig, -stepSmall, stepSmall, stepBig].map((s) => (
            <Pressable
              key={s} disabled={disabled} onPress={() => setValue(value + s)}
              style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>{s > 0 ? `+${s}` : s}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* keypad */}
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['000', '0', '⌫']].map((row) => (
          <View key={row.join()} style={{ flexDirection: 'row', gap: spacing.sm }}>
            {row.map((k) => (
              <Pressable
                key={k} onPress={() => tap(k)} disabled={disabled}
                style={({ pressed }) => ({
                  flex: 1, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? colors.surfaceAlt : colors.surface,
                })}
              >
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>{k}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <Pressable
          disabled={!canSubmit} onPress={() => onSubmit(value)}
          style={{
            height: 54, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs, marginBottom: spacing.lg,
            backgroundColor: canSubmit ? colors.accent : colors.surfaceAlt,
          }}
        >
          <Text style={{ color: canSubmit ? colors.accentText : colors.textMuted, fontSize: 18, fontWeight: '800' }}>
            {submitting ? t('round.submitting') : t('round.submit')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── RevealPanel ─────────────────────────────────────────────────────────────

export interface RevealPlayer {
  user_id: string;
  username: string;
  avatar: string | null;
  guess: number | null;
  score: number | null;
  total: number;
  isMe: boolean;
}

interface RevealPanelProps {
  title: string;
  price: number | null; // null while waiting for the server
  players: RevealPlayer[];
  waitingLabel?: string;
  footer?: ReactNode;
}

export function RevealPanel({ title, price, players, waitingLabel, footer }: RevealPanelProps) {
  const { t } = useTranslation('social');
  const lang = currentLang();
  const lo = Math.min(...players.map((p) => p.guess ?? Infinity), price ?? Infinity);
  const hi = Math.max(...players.map((p) => p.guess ?? -Infinity), price ?? -Infinity);
  const pos = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 90 + 5 : 50);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.lg }}>
      <Text style={[type.h2, { color: colors.text }]}>{title}</Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.xs }}>
        <Text style={[type.small, { color: colors.textMuted }]}>{t('reveal.asking')}</Text>
        <Text style={[mono, { color: price != null ? colors.accent : colors.textMuted }]}>
          {price != null ? formatEur(price, lang) : '▒▒▒▒▒ €'}
        </Text>
        {price == null && waitingLabel ? <Text style={{ color: colors.textMuted }}>{waitingLabel}</Text> : null}
      </View>

      {price != null && Number.isFinite(lo) && (
        <View style={{ height: 28, justifyContent: 'center' }}>
          <View style={{ height: 3, backgroundColor: colors.border, borderRadius: radius.pill }} />
          <Text style={{ position: 'absolute', left: `${pos(price)}%`, top: 0, color: colors.accent, fontSize: 18, marginLeft: -7 }}>▲</Text>
          {players.map((p) =>
            p.guess != null ? (
              <Text key={p.user_id} style={{ position: 'absolute', left: `${pos(p.guess)}%`, top: 8, color: p.isMe ? colors.green : colors.blue, fontSize: 14, marginLeft: -6 }}>
                {p.isMe ? '●' : '◆'}
              </Text>
            ) : null,
          )}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        {players.map((p) => (
          <View key={p.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: p.isMe ? 'rgba(245,184,64,0.08)' : colors.surface, borderRadius: radius.md, padding: spacing.md }}>
            <Avatar avatar={p.avatar} username={p.username} size={34} highlight={p.isMe} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{p.isMe ? t('you') : p.username}</Text>
              <Text style={[type.small, { color: colors.textMuted }]}>
                {p.guess != null ? formatEur(p.guess, lang) : t('reveal.thinking')}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{p.score != null ? `+${p.score}` : '—'}</Text>
              <Text style={[type.small, { color: colors.textMuted }]}>{p.total}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {footer}
    </View>
  );
}
