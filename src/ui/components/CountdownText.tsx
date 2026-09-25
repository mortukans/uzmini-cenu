import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatCountdown, secondsUntilRigaMidnight } from '../../game/time';
import { colors, type } from '../theme';

interface Props {
  /** Server-provided seconds until next daily; corrects device clock drift. */
  serverSecondsUntilNext?: number | null;
  /** Renders the countdown inside a template; `{time}` is replaced. */
  template?: string;
  style?: StyleProp<TextStyle>;
  onZero?: () => void;
}

/** hh:mm:ss until 00:00 Europe/Riga, ticking every second. */
export function CountdownText({ serverSecondsUntilNext, template, style, onZero }: Props) {
  const [offset] = useState(() => (serverSecondsUntilNext != null ? serverSecondsUntilNext - secondsUntilRigaMidnight() : 0));
  const [secs, setSecs] = useState(() => secondsUntilRigaMidnight() + offset);

  useEffect(() => {
    const id = setInterval(() => {
      const s = secondsUntilRigaMidnight() + offset;
      setSecs(s);
      if (s <= 1) onZero?.();
    }, 1000);
    return () => clearInterval(id);
  }, [offset, onZero]);

  const time = formatCountdown(secs);
  return (
    <Text style={[{ color: colors.textMuted, ...type.small, fontVariant: ['tabular-nums'] }, style]}>
      {template ? template.replace('{time}', time) : time}
    </Text>
  );
}
