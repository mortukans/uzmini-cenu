/** Profile / settings (docs/11 §2.17). */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { deleteMe, setUsername as saveUsernameRpc, updateProfile, RpcError } from '../../src/api/rpc';
import type { Lang } from '../../src/api/types';
import { isAutoUsername, useAuth } from '../../src/auth/store';
import { env, isConfigured } from '../../src/env';
import { clearAll, getDailyStreak, getHintTokens, getPrefs, getStreakBests, setOnboarded, setPrefs, type StreakBests } from '../../src/game/storage';
import { SUPPORTED, currentLang, setLang } from '../../src/i18n';
import { analyticsReset, screenView, track } from '../../src/analytics';
import { haptic, setHapticsEnabled } from '../../src/ui/haptics';
import { Button, Screen } from '../../src/ui/components';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const TAKEDOWN_EMAIL = `takedown@${env.UNIVERSAL_LINK_HOST}`;
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { profile, hasUsername, refreshProfile, signOut } = useAuth();
  const [lang, setLangState] = useState<Lang>(currentLang());
  const [haptics, setHaptics] = useState(true);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [editing, setEditing] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bests, setBests] = useState<StreakBests>({});
  const [dailyStreak, setDailyStreak] = useState(0);
  const [tokens, setTokens] = useState(0);

  useEffect(() => { setUsername(hasUsername ? profile?.username ?? '' : ''); }, [profile?.username, hasUsername]);

  useFocusEffect(useCallback(() => {
    screenView('profile');
    track('profile_view');
    void getPrefs().then((p) => { setHaptics(p.haptics); setHapticsEnabled(p.haptics); });
    void getStreakBests().then(setBests);
    void getDailyStreak().then((s) => setDailyStreak(s?.days ?? 0));
    void getHintTokens().then(setTokens);
  }, []));

  const changeLang = async (l: Lang) => {
    void haptic.step();
    setLangState(l);
    await setLang(l);
    await setPrefs({ lang: l });
    track('setting_changed', { key: 'lang', value: l });
    if (isConfigured) { try { await updateProfile({ lang: l }); } catch { /* offline */ } }
  };

  const toggleHaptics = async (v: boolean) => {
    setHaptics(v); setHapticsEnabled(v);
    await setPrefs({ haptics: v });
    track('setting_changed', { key: 'haptics', value: v });
  };

  const saveUsername = async () => {
    const name = username.trim().toLowerCase();
    if (!USERNAME_RE.test(name) || isAutoUsername(name)) { setNameError(t('profile.username_invalid')); return; }
    setSaving(true); setNameError(null);
    try {
      await saveUsernameRpc(name);
      await refreshProfile();
      track('username_changed');
      setEditing(false);
    } catch (e) {
      const code = e instanceof RpcError ? e.code : '';
      setNameError(code === 'username_taken' ? t('profile.username_taken') : code === 'username_invalid' ? t('profile.username_invalid') : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const replayOnboarding = async () => { await setOnboarded(false); router.replace('/onboarding'); };

  const deleteAccount = () => {
    track('account_delete_start');
    Alert.alert(t('profile.delete_title'), t('profile.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.delete_confirm'), style: 'destructive',
        onPress: () => Alert.alert(t('profile.delete_title2'), t('profile.delete_body2'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('profile.delete_confirm2'), style: 'destructive',
            onPress: async () => {
              try { if (isConfigured) await deleteMe(); } catch { /* proceed with local wipe */ }
              await clearAll();
              analyticsReset();
              track('account_deleted');
              await signOut();
              router.replace('/onboarding');
            },
          },
        ]),
      },
    ]);
  };

  const Row = ({ label, value, onPress, danger }: { label: string; value?: string; onPress?: () => void; danger?: boolean }) => (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row} accessibilityRole={onPress ? 'button' : 'text'}>
      <Text style={[styles.rowLabel, danger && { color: colors.red }]}>{label}</Text>
      {value != null && <Text style={styles.rowValue}>{value}</Text>}
      {onPress && value == null && <Text style={styles.chev}>›</Text>}
    </Pressable>
  );

  return (
    <Screen scroll>
      <Text style={styles.title}>{t('tabs.profile')}</Text>

      {/* Identity */}
      <View style={styles.card}>
        {!hasUsername ? (
          <>
            <Text style={styles.body}>{t('profile.no_username_card')}</Text>
            <Button title={t('auth.pick_username')} onPress={() => router.push('/sign-in')} style={{ marginTop: spacing.md }} />
          </>
        ) : editing ? (
          <>
            <TextInput
              value={username}
              onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s+/g, ''))}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={16}
              placeholder={t('profile.username')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              accessibilityLabel={t('profile.username')}
            />
            {nameError && <Text style={styles.error}>{nameError}</Text>}
            <View style={styles.inline}>
              <Button title={t('common.cancel')} variant="ghost" small onPress={() => { setEditing(false); setUsername(profile?.username ?? ''); }} />
              <Button title={t('common.save')} small loading={saving} onPress={() => { void saveUsername(); }} />
            </View>
          </>
        ) : (
          <Pressable onPress={() => setEditing(true)} style={styles.identity} accessibilityRole="button">
            <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.username}>{profile?.username ?? t('profile.username')}</Text>
              <Text style={styles.muted}>{t('profile.edit_username')}</Text>
            </View>
          </Pressable>
        )}
      </View>

      {/* Stats */}
      <Text style={styles.section}>{t('profile.stats')}</Text>
      <View style={styles.card}>
        <Row label={t('profile.daily_streak')} value={String(dailyStreak)} />
        <Row label={t('profile.hint_tokens')} value={String(tokens)} />
        {(['flats', 'houses', 'cars', 'random', 'all'] as const).map((c) => (
          <Row key={c} label={t('profile.best_streak_in', { category: t(`category.${c}`) })} value={String(bests[c] ?? 0)} />
        ))}
      </View>

      {/* Settings */}
      <Text style={styles.section}>{t('profile.settings')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.language')}</Text>
          <View style={styles.langs}>
            {SUPPORTED.map((l) => (
              <Pressable key={l} onPress={() => { void changeLang(l); }} style={[styles.lang, lang === l && styles.langOn]} accessibilityRole="button" accessibilityState={{ selected: lang === l }}>
                <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.haptics')}</Text>
          <Switch value={haptics} onValueChange={(v) => { void toggleHaptics(v); }} trackColor={{ true: colors.accent, false: colors.border }} />
        </View>
        <Row label={t('profile.replay_onboarding')} onPress={() => { void replayOnboarding(); }} />
      </View>

      {/* Legal */}
      <Text style={styles.section}>{t('profile.legal')}</Text>
      <View style={styles.card}>
        <Row label={t('profile.privacy')} onPress={() => { void Linking.openURL(`https://${env.UNIVERSAL_LINK_HOST}/privacy`); }} />
        <Row label={t('profile.terms')} onPress={() => { void Linking.openURL(`https://${env.UNIVERSAL_LINK_HOST}/terms`); }} />
        <Row label={t('profile.takedown')} onPress={() => { void Linking.openURL(`mailto:${TAKEDOWN_EMAIL}`); }} />
        <Row label={t('profile.delete_account')} onPress={deleteAccount} danger />
      </View>

      <Text style={styles.version}>v{Constants.expoConfig?.version ?? 'dev'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...type.h1, color: colors.text, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.md, overflow: 'hidden', padding: spacing.xs },
  body: { ...type.body, color: colors.text, padding: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.h2, color: colors.text },
  username: { ...type.h3, color: colors.text },
  muted: { ...type.small, color: colors.textMuted },
  input: { ...type.body, color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, margin: spacing.sm },
  error: { ...type.small, color: colors.red, paddingHorizontal: spacing.md },
  inline: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, padding: spacing.sm },
  section: { ...type.small, color: colors.textMuted, marginTop: spacing.xl, textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48 },
  rowLabel: { ...type.body, color: colors.text, flex: 1 },
  rowValue: { ...type.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  chev: { ...type.h3, color: colors.textMuted },
  langs: { flexDirection: 'row', gap: 6 },
  lang: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  langOn: { backgroundColor: colors.accent },
  langText: { ...type.small, color: colors.text, fontWeight: '600' },
  langTextOn: { color: colors.accentText },
  version: { ...type.small, color: colors.border, textAlign: 'center', marginTop: spacing.xl },
});
