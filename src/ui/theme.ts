/** Shared design tokens. Dark, warm, one accent. */
export const colors = {
  bg: '#0F1115',
  surface: '#181B22',
  surfaceAlt: '#20242D',
  border: '#2A2F3A',
  text: '#F4F5F7',
  textMuted: '#9AA1AE',
  accent: '#F5B840', // warm gold, "price tag"
  accentText: '#1A1400',
  green: '#3DD68C',
  yellow: '#F5C543',
  red: '#F06060',
  blue: '#5AA9FF',
  overlay: 'rgba(0,0,0,0.55)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const type = {
  display: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1 },
  h1: { fontSize: 28, fontWeight: '700' as const },
  h2: { fontSize: 22, fontWeight: '700' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  mono: { fontSize: 36, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as const },
} as const;

export const gridColor = (cell: string) => (cell === '🟩' ? colors.green : cell === '🟨' ? colors.yellow : colors.red);
