/** expo-haptics wrappers with a global on/off switch (docs/02 §10). */
import * as Haptics from 'expo-haptics';

let enabled = true;
export const setHapticsEnabled = (v: boolean) => { enabled = v; };
export const hapticsEnabled = () => enabled;

const safe = (p: Promise<void>) => p.catch(() => undefined);

export const haptic = {
  key: () => (enabled ? safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)) : Promise.resolve()),
  step: () => (enabled ? safe(Haptics.selectionAsync()) : Promise.resolve()),
  submit: () => (enabled ? safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)) : Promise.resolve()),
  heavy: () => (enabled ? safe(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)) : Promise.resolve()),
  success: () => (enabled ? safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)) : Promise.resolve()),
  warning: () => (enabled ? safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)) : Promise.resolve()),
  error: () => (enabled ? safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)) : Promise.resolve()),
  /** Score-dependent reveal haptic. */
  reveal: async (score: number) => {
    if (!enabled) return;
    if (score === 1000) { await safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)); await safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)); }
    else if (score >= 800) await safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    else if (score < 100) await safe(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
};
