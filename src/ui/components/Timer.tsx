/**
 * Timer — countdown from a deadline ISO string (server time). Renders a
 * simple text + thin bar (no SVG dependency). Turns orange under 10 s.
 * `offsetMs` corrects device clock skew (server - device).
 * Owned by the social agent.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, radius } from '../theme';

interface Props {
  deadline: string | null | undefined;
  /** Total round length in seconds, for the bar fraction. */
  totalSec?: number;
  offsetMs?: number;
  onZero?: () => void;
  compact?: boolean;
}

export function remainingSec(deadline: string | null | undefined, now = Date.now(), offsetMs = 0): number {
  if (!deadline) return 0;
  const ms = new Date(deadline).getTime() - (now + offsetMs);
  return Math.max(0, Math.ceil(ms / 1000));
}

export function Timer({ deadline, totalSec = 30, offsetMs = 0, onZero, compact }: Props) {
  const [left, setLeft] = useState(() => remainingSec(deadline, Date.now(), offsetMs));

  useEffect(() => {
    setLeft(remainingSec(deadline, Date.now(), offsetMs));
    if (!deadline) return;
    let fired = false;
    const id = setInterval(() => {
      const r = remainingSec(deadline, Date.now(), offsetMs);
      setLeft(r);
      if (r === 0 && !fired) {
        fired = true;
        onZero?.();
      }
    }, 250);
    return () => clearInterval(id);
    // onZero intentionally not a dep: parent passes a stable-enough callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, offsetMs]);

  const shown = Math.min(left, totalSec);
  const frac = totalSec > 0 ? shown / totalSec : 0;
  const color = shown <= 10 ? colors.accent : colors.blue;
  const mm = Math.floor(shown / 60);
  const ss = String(shown % 60).padStart(2, '0');

  return (
    <View style={{ alignItems: 'center', gap: 4, minWidth: compact ? 48 : 64 }}>
      <Text style={{ color, fontSize: compact ? 15 : 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {mm}:{ss}
      </Text>
      <View style={{ width: '100%', height: 3, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(frac * 100)}%`, height: '100%', backgroundColor: color }} />
      </View>
    </View>
  );
}
