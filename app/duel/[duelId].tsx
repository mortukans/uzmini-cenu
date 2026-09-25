/**
 * /duel/[duelId] — one route, state-driven (docs/06 "Duel screen").
 * States come from deriveDuelState(row, me, local); the row arrives via
 * useDuelChannel (postgres_changes + refetch on subscribe/foreground).
 * Rounds render with RoundPanel (self-contained); reveal with RevealPanel.
 * Depends on: src/api/rpc (getDuel via channel, acceptDuel, declineDuel, duelTokens,
 * submitGuess, poke, inviteDuel, listFriends), src/auth, src/realtime/*, i18n social.
 * Known gap: no server clock-skew correction (offsetMs = 0).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { acceptDuel, declineDuel, duelTokens, inviteDuel, listFriends, poke, RpcError, submitGuess } from '../../src/api/rpc';
import type { Duel, GuessResult, RoundToken } from '../../src/api/types';
import { useRequireSignIn } from '../../src/auth/apple';
import { useAuth } from '../../src/auth/store';
import { formatEur } from '../../src/game/format';
import { currentLang } from '../../src/i18n';
import { go, WEB_BASE } from '../../src/notifications/linking';
import { deriveDuelState, duelOutcome, emptyLocal, opponentOf, roleOf, roundsOf, totalFromResults, type DuelLocal } from '../../src/realtime/duelState';
import { RevealPanel, RoundPanel, type RevealPlayer } from '../../src/realtime/RoundPanel';
import { useDuelChannel } from '../../src/realtime/useDuelChannel';
import { Avatar } from '../../src/ui/components/Avatar';
import { StatusChip } from '../../src/ui/components/StatusChip';
import { Timer } from '../../src/ui/components/Timer';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const REVEAL_MS = 5000;

function Btn({ label, onPress, tone = 'accent', disabled }: { label: string; onPress: () => void; tone?: 'accent' | 'ghost' | 'danger'; disabled?: boolean }) {
  const bg = tone === 'accent' ? colors.accent : tone === 'danger' ? 'rgba(240,96,96,0.15)' : colors.surfaceAlt;
  const fg = tone === 'accent' ? colors.accentText : tone === 'danger' ? colors.red : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1, backgroundColor: bg, paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center' }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' }}>{children}</View>;
}

export default function DuelScreen() {
  const { t } = useTranslation('social');
  const lang = currentLang();
  const { duelId } = useLocalSearchParams<{ duelId: string }>();
  const { ready, session, profile } = useAuth();
  const me = session?.user.id ?? '';
  const requireSignIn = useRequireSignIn();

  const [duel, setDuel] = useState<Duel | null>(null);
  const [tokens, setTokens] = useState<RoundToken[]>([]);
  const [local, setLocal] = useState<DuelLocal>(emptyLocal);
  const [myResults, setMyResults] = useState<Record<number, GuessResult>>({});
  const [oppGuessed, setOppGuessed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [gateDone, setGateDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const roundStart = useRef<number>(Date.now());

  // Username gate (a push deep link may land here before a username was chosen).
  useEffect(() => {
    if (!ready) return;
    void requireSignIn().then((ok) => (ok ? setGateDone(true) : router.replace('/')));
  }, [ready, requireSignIn]);

  const onRow = useCallback((row: Duel) => {
    setDuel(row);
    setLoadError(null);
  }, []);
  const { connection, refetch, send } = useDuelChannel({
    duelId: duelId ?? '',
    myId: me,
    enabled: gateDone && Boolean(duelId) && Boolean(me),
    onRow,
    onPeer: (e) => { if (e.type === 'guessed' && e.userId !== me) setOppGuessed(e.round); },
    onError: (e) => setLoadError(e instanceof RpcError ? e.code : String(e)),
  });

  const state = useMemo(() => deriveDuelState(duel, me, local), [duel, me, local]);
  const opp = duel ? opponentOf(duel, me) : '';
  const total = duel ? roundsOf(duel) : 5;

  // Opponent display name from friends list (no profile-by-id RPC in the contract).
  const friendsQ = useQuery({ queryKey: ['friends'], queryFn: listFriends, enabled: gateDone, staleTime: 5 * 60_000 });
  const oppProfile = friendsQ.data?.find((f) => f.user_id === opp);
  const oppName = oppProfile?.username ?? t('duel.opponent');

  // Tokens once the duel is playable for me.
  const needTokens = duel && tokens.length === 0 && (duel.status === 'live' || (duel.status === 'invited' && duel.async && roleOf(duel, me) === 'challenger'));
  useEffect(() => {
    if (!needTokens || !duelId) return;
    duelTokens(duelId).then(setTokens).catch((e) => setLoadError(e instanceof RpcError ? e.code : String(e)));
  }, [needTokens, duelId]);

  // Reveal auto-advance.
  useEffect(() => {
    if (state.kind !== 'REVEAL') return;
    const n = state.round;
    const id = setTimeout(() => setLocal((l) => ({ ...l, revealSeen: Math.max(l.revealSeen, n) })), REVEAL_MS);
    return () => clearTimeout(id);
  }, [state]);

  // Reset per-round timer + opp pill when the round changes.
  useEffect(() => {
    if (state.kind === 'ROUND') { roundStart.current = Date.now(); setOppGuessed(null); }
  }, [state.kind, state.kind === 'ROUND' ? state.round : 0]);

  const markAnswered = (n: number) => setLocal((l) => { const s = new Set(l.answered); s.add(n); return { ...l, answered: s }; });

  const onAccept = async () => {
    if (!duelId) return;
    setBusy(true);
    try {
      setTokens(await acceptDuel(duelId));
      await refetch();
    } catch (e) {
      const code = e instanceof RpcError ? e.code : '';
      if (code === 'duel_not_invited') await refetch(); // already live: treat as success
      else Alert.alert(t('error'), t(`err.${code}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };
  const onDecline = async () => {
    if (!duelId) return;
    setBusy(true);
    try { await declineDuel(duelId); } catch { /* ignore */ }
    setBusy(false);
    router.back();
  };

  const onSubmit = async (n: number, guess: number) => {
    const tok = tokens.find((x) => x.round_no === n);
    if (!tok || !duelId) return;
    setBusy(true);
    try {
      const res = await submitGuess(tok.token, guess, Date.now() - roundStart.current);
      setMyResults((m) => ({ ...m, [n]: res }));
      markAnswered(n);
      void send({ type: 'guessed', round: n });
    } catch (e) {
      const code = e instanceof RpcError ? e.code : '';
      if (code === 'already_answered' || code === 'too_late' || code === 'round_closed') {
        markAnswered(n);
        if (code !== 'already_answered') Alert.alert(t('duel.tooLate'));
        void refetch();
      } else Alert.alert(t('error'), t(`err.${code}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };

  const onDeadline = useCallback(() => {
    if (!duelId) return;
    setTimeout(() => { void poke('duel', duelId).catch(() => undefined).then(() => refetch()); }, Math.random() * 500);
    setTimeout(() => void refetch(), 4000);
  }, [duelId, refetch]);

  const onRematch = async () => {
    if (!duel) return;
    setBusy(true);
    try {
      const { duel_id } = await inviteDuel(opp, 'all');
      go(`/duel/${duel_id}`, true);
    } catch (e) {
      const code = e instanceof RpcError ? e.code : '';
      Alert.alert(t('error'), code === 'rate_limited' ? t('duel.limitBody') : t(`err.${code}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };

  const onShare = () => {
    if (!duel) return;
    const mine = duel.scores?.[me] ?? totalFromResults(duel.results, me);
    const theirs = duel.scores?.[opp] ?? totalFromResults(duel.results, opp);
    void Share.share({ message: t('duel.shareText', { me: profile?.username ?? t('you'), mine, opp: oppName, theirs, url: WEB_BASE }) });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const confirmClose = () => Alert.alert(t('duel.leaveTitle'), t('duel.leaveBody'), [{ text: t('cancel'), style: 'cancel' }, { text: t('duel.leave'), onPress: close }]);

  const revealPlayers = (n: number): RevealPlayer[] => {
    const r = duel?.results?.[String(n)] ?? {};
    const mk = (id: string, name: string, isMe: boolean): RevealPlayer => ({
      user_id: id, username: name, avatar: isMe ? profile?.avatar ?? null : oppProfile?.avatar ?? null, isMe,
      guess: r[id]?.guess ?? (isMe ? myResults[n]?.guess_eur ?? null : null),
      score: r[id]?.score ?? (isMe ? myResults[n]?.score ?? null : null),
      total: duel?.scores?.[id] ?? totalFromResults(duel?.results, id),
    });
    return [mk(me, profile?.username ?? t('you'), true), mk(opp, oppName, false)];
  };
  const priceOf = (n: number): number | null => {
    const r = duel?.results?.[String(n)];
    const p = r ? Object.values(r).find((x) => x?.price != null)?.price : undefined;
    return p ?? myResults[n]?.price_eur ?? null;
  };
  const scoreStrip = (
    <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
      {t('you')} {duel?.scores?.[me] ?? totalFromResults(duel?.results, me)} · {oppName} {duel?.scores?.[opp] ?? totalFromResults(duel?.results, opp)}
    </Text>
  );

  // ── render ──────────────────────────────────────────────────────────────────

  const banner = connection === 'reconnecting' ? (
    <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.xs, alignItems: 'center' }}>
      <Text style={[type.small, { color: colors.yellow }]}>{t('reconnecting')}</Text>
    </View>
  ) : null;

  if (!gateDone || state.kind === 'LOADING') {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
        {loadError ? <Text style={{ color: colors.red, textAlign: 'center' }}>{t(`err.${loadError}`, { defaultValue: loadError })}</Text> : null}
        <Btn tone="ghost" label={t('back')} onPress={close} />
      </Centered>
    );
  }

  switch (state.kind) {
    case 'NOT_PARTICIPANT':
      return <Centered><Text style={[type.h2, { color: colors.text }]}>{t('duel.notYours')}</Text><Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} /></Centered>;
    case 'DECLINED':
      return <Centered><Text style={[type.h2, { color: colors.text }]}>{t('duel.declinedTitle', { name: oppName })}</Text><Text style={{ color: colors.textMuted }}>{t('duel.declinedBody')}</Text><Btn label={t('duel.rematch')} onPress={onRematch} disabled={busy} /><Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} /></Centered>;
    case 'EXPIRED':
      return <Centered><Text style={[type.h2, { color: colors.text }]}>{t('duel.expiredTitle')}</Text><Text style={{ color: colors.textMuted }}>{t('duel.expiredBody', { name: oppName })}</Text><Btn label={t('duel.rematch')} onPress={onRematch} disabled={busy} /><Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} /></Centered>;

    case 'INVITED':
      return (
        <Centered>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
            <Avatar avatar={oppProfile?.avatar} username={oppName} size={72} />
            <Text style={[type.h2, { color: colors.textMuted }]}>vs</Text>
            <Avatar avatar={profile?.avatar} username={profile?.username} size={72} highlight />
          </View>
          <Text style={[type.h1, { color: colors.text, textAlign: 'center' }]}>{t('duel.inviteTitle', { name: oppName })}</Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('duel.inviteBody', { n: total })}</Text>
          <Btn label={busy ? '…' : t('duel.play')} onPress={onAccept} disabled={busy} />
          <Btn tone="ghost" label={t('duel.later')} onPress={close} />
          <Btn tone="danger" label={t('duel.decline')} onPress={onDecline} disabled={busy} />
        </Centered>
      );

    case 'WAITING_ACCEPT':
      return (
        <Centered>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.lg }}>
            <Avatar avatar={profile?.avatar} username={profile?.username} size={72} highlight />
            <Text style={[type.h2, { color: colors.textMuted }]}>vs</Text>
            <Avatar avatar={oppProfile?.avatar} username={oppName} size={72} />
          </View>
          <Text style={[type.h1, { color: colors.text, textAlign: 'center' }]}>{t('duel.waitingTitle', { name: oppName })}</Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('duel.waitingBody')}</Text>
          <ActivityIndicator color={colors.accent} />
          <Btn tone="ghost" label={t('duel.leaveKeep')} onPress={close} />
        </Centered>
      );

    case 'ROUND': {
      const listing = duel!.snapshot?.[state.round - 1];
      const tok = tokens.find((x) => x.round_no === state.round);
      if (!listing || !tok) {
        return <Centered><ActivityIndicator color={colors.accent} />{loadError ? <Text style={{ color: colors.red }}>{loadError}</Text> : null}</Centered>;
      }
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RoundPanel
            listing={listing} roundNo={state.round} totalRounds={total}
            deadline={state.async ? null : duel!.round_deadline} onDeadline={onDeadline}
            header={<View style={{ alignItems: 'center', gap: 2 }}>{scoreStrip}{oppGuessed === state.round ? <StatusChip label={t('duel.oppGuessed', { name: oppName })} tone="green" /> : null}</View>}
            submitting={busy} onSubmit={(g) => void onSubmit(state.round, g)} onClose={confirmClose}
          />
        </View>
      );
    }

    case 'ROUND_WAITING':
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RevealPanel
            title={t('round.counter', { n: state.round, total })}
            price={null}
            players={revealPlayers(state.round)}
            waitingLabel={t('duel.waitingOpp', { name: oppName })}
            footer={<View style={{ alignItems: 'center', gap: spacing.md }}><Timer deadline={duel!.round_deadline} onZero={onDeadline} /><Text style={[type.small, { color: colors.textMuted }]}>{t('duel.revealHint')}</Text></View>}
          />
        </View>
      );

    case 'REVEAL':
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RevealPanel
            title={t('round.counter', { n: state.round, total })}
            price={priceOf(state.round)}
            players={revealPlayers(state.round)}
            footer={<Btn tone="ghost" label={state.round >= total ? t('duel.toResult') : t('next')} onPress={() => setLocal((l) => ({ ...l, revealSeen: Math.max(l.revealSeen, state.round) }))} />}
          />
        </View>
      );

    case 'WAITING_OPPONENT_ASYNC':
      return (
        <Centered>
          <Text style={[type.h1, { color: colors.text, textAlign: 'center' }]}>{t('duel.asyncLockedTitle', { pts: totalFromResults(duel!.results, me) || Object.values(myResults).reduce((s, r) => s + r.score, 0) })}</Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('duel.asyncLockedBody', { name: oppName })}</Text>
          <Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} />
        </Centered>
      );

    case 'RESULT': {
      const d = duel!;
      const outcome = duelOutcome(d, me);
      const mine = d.scores?.[me] ?? totalFromResults(d.results, me);
      const theirs = d.scores?.[opp] ?? totalFromResults(d.results, opp);
      return (
        <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.xxl + spacing.lg, gap: spacing.lg }}>
          <Text style={[type.display, { color: outcome === 'win' ? colors.green : outcome === 'lose' ? colors.red : colors.text, textAlign: 'center' }]}>{t(`duel.outcome.${outcome}`)}</Text>
          <Text style={[type.h2, { color: colors.text, textAlign: 'center' }]}>{mine} : {theirs}</Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('you')} · {oppName}</Text>
          <View style={{ gap: spacing.sm }}>
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
              const r = d.results?.[String(n)] ?? {};
              const price = priceOf(n);
              return (
                <View key={n} style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Text style={{ color: colors.textMuted, width: 20 }}>{n}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>{price != null ? formatEur(price, lang) : '—'}</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>{d.snapshot?.[n - 1]?.title_hint ?? d.snapshot?.[n - 1]?.location ?? ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colors.text }}>{r[me]?.guess != null ? formatEur(r[me].guess, lang) : '—'} <Text style={{ color: colors.green }}>+{r[me]?.score ?? 0}</Text></Text>
                    <Text style={{ color: colors.textMuted }}>{r[opp]?.guess != null ? formatEur(r[opp].guess, lang) : '—'} <Text style={{ color: colors.blue }}>+{r[opp]?.score ?? 0}</Text></Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Btn label={busy ? '…' : t('duel.rematch')} onPress={onRematch} disabled={busy} />
          <Btn tone="ghost" label={t('share')} onPress={onShare} />
          <Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} />
        </ScrollView>
      );
    }
  }
}
