/**
 * /sign-in modal: "choose a username" (route name kept for existing navigation).
 * Live validation → setUsername RPC → resolveSignIn(true) and close.
 * Depends on: src/auth/apple (resolveSignIn), src/auth/store, src/api/rpc.setUsername, i18n social.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { resolveSignIn } from '../src/auth/apple';
import { isAutoUsername, useAuth } from '../src/auth/store';
import { RpcError, setUsername } from '../src/api/rpc';
import { colors, radius, spacing, type } from '../src/ui/theme';

const USERNAME_RE = /^[a-z0-9_]{3,16}$/;

type NameStatus = 'idle' | 'ok' | 'taken' | 'invalid';

export default function ChooseUsernameScreen() {
  const { t } = useTranslation('social');
  const { profile, hasUsername, refreshProfile } = useAuth();
  const [name, setName] = useState(hasUsername ? profile?.username ?? '' : '');
  const [status, setStatus] = useState<NameStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (ok: boolean) => {
    resolveSignIn(ok);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  // Username picked from elsewhere (or already had one when opened) → close.
  useEffect(() => {
    if (hasUsername && !busy) close(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUsername]);

  const onChange = (v: string) => {
    const clean = v.toLowerCase().replace(/\s+/g, '');
    setName(clean);
    setError(null);
    if (!clean) return setStatus('idle');
    setStatus(USERNAME_RE.test(clean) && !isAutoUsername(clean) ? 'ok' : 'invalid');
  };

  const save = async () => {
    if (status !== 'ok' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setUsername(name);
      await refreshProfile();
      setBusy(false);
      close(true);
    } catch (e) {
      setBusy(false);
      const code = e instanceof RpcError ? e.code : 'unknown';
      if (code === 'username_taken') setStatus('taken');
      else if (code === 'username_invalid') setStatus('invalid');
      else setError(t(`err.${code}`, { defaultValue: t('err.unknown') }));
    }
  };

  const bad = status === 'taken' || status === 'invalid';
  const hint = status === 'taken' ? t('signIn.usernameTaken')
    : status === 'invalid' ? t('signIn.usernameInvalid')
    : status === 'ok' ? t('signIn.usernameOk')
    : t('signIn.usernameRules');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, gap: spacing.lg }}>
      <Pressable onPress={() => close(hasUsername)} hitSlop={12} style={{ alignSelf: 'flex-end' }} accessibilityRole="button" accessibilityLabel={t('cancel')}>
        <Text style={{ color: colors.textMuted, fontSize: 22 }}>✕</Text>
      </Pressable>

      <Text style={[type.h1, { color: colors.text }]}>{t('signIn.usernameTitle')}</Text>
      <Text style={[type.body, { color: colors.textMuted }]}>{t('signIn.usernameBody')}</Text>
      <View style={{ gap: spacing.sm }}>
        {[t('signIn.bullet1'), t('signIn.bullet2'), t('signIn.bullet3')].map((b) => (
          <Text key={b} style={{ color: colors.text }}>• {b}</Text>
        ))}
      </View>

      <TextInput
        value={name}
        onChangeText={onChange}
        onSubmitEditing={() => { void save(); }}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={16}
        returnKeyType="done"
        placeholder={t('signIn.usernamePlaceholder')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t('signIn.usernameTitle')}
        style={{
          backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, padding: spacing.md, fontSize: 18,
          borderWidth: 1, borderColor: bad ? colors.red : status === 'ok' ? colors.green : colors.border,
        }}
      />
      <Text style={[type.small, { color: bad ? colors.red : colors.textMuted }]}>{hint}</Text>
      {error ? <Text style={{ color: colors.red }}>{error}</Text> : null}
      <Text style={[type.small, { color: colors.textMuted }]}>{t('signIn.privacy')}</Text>

      <View style={{ flex: 1 }} />
      <Pressable
        disabled={status !== 'ok' || busy}
        onPress={() => { void save(); }}
        accessibilityRole="button"
        style={{ height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: status === 'ok' && !busy ? colors.accent : colors.surfaceAlt }}
      >
        {busy ? <ActivityIndicator color={colors.accentText} /> : (
          <Text style={{ color: status === 'ok' ? colors.accentText : colors.textMuted, fontWeight: '800', fontSize: 17 }}>{t('signIn.usernameSave')}</Text>
        )}
      </Pressable>
    </View>
  );
}
