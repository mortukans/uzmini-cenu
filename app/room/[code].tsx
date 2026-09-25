/**
 * /room/[code] — lobby → live rounds → scoreboard → podium (docs/06 "Room screen").
 * Phase from deriveRoomPhase(row, me, answered, now); row + players via useRoomChannel
 * (postgres_changes + presence + broadcast, heartbeat, refetch on subscribe/foreground).
 * "Play again" creates a NEW room with the same category (no replay_room RPC in the
 * contract) and navigates; other players follow via the podium banner / link.
 * Depends on: src/api/rpc (joinRoom, startRoom, roomTokens, submitGuess, poke, createRoom),
 * src/auth, src/realtime/*, i18n social. Known gap: no clock-skew correction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { createRoom, joinRoom, poke, roomTokens, RpcError, startRoom, submitGuess } from '../../src/api/rpc';
import type { GuessResult, Room, RoomPlayer, RoundToken } from '../../src/api/types';
import { useRequireSignIn } from '../../src/auth/apple';
import { useAuth } from '../../src/auth/store';
import { formatEur } from '../../src/game/format';
import { currentLang } from '../../src/i18n';
import { go, roomLink } from '../../src/notifications/linking';
import { deriveRoomPhase, standings } from '../../src/realtime/roomState';
import { RevealPanel, RoundPanel, type RevealPlayer } from '../../src/realtime/RoundPanel';
import { useRoomChannel } from '../../src/realtime/useRoomChannel';
import { Avatar } from '../../src/ui/components/Avatar';
import { PlayerRow } from '../../src/ui/components/PlayerRow';
import { StatusChip } from '../../src/ui/components/StatusChip';
import { colors, radius, spacing, type } from '../../src/ui/theme';

function Btn({ label, onPress, tone = 'accent', disabled }: { label: string; onPress: () => void; tone?: 'accent' | 'ghost' | 'danger'; disabled?: boolean }) {
  const bg = tone === 'accent' ? colors.accent : tone === 'danger' ? 'rgba(240,96,96,0.15)' : colors.surfaceAlt;
  const fg = tone === 'accent' ? colors.accentText : tone === 'danger' ? colors.red : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1, backgroundColor: bg, paddingVertical: spacing.md, borderRadius: radius.lg, alignItems: 'center' }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export default function RoomScreen() {
  const { t } = useTranslation('social');
  const lang = currentLang();
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = (raw ?? '').toUpperCase();
  const { ready, session, profile } = useAuth();
  const me = session?.user.id ?? '';
  const requireSignIn = useRequireSignIn();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [tokens, setTokens] = useState<RoundToken[]>([]);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  const [guessedNow, setGuessedNow] = useState<Set<string>>(new Set());
  const [myResults, setMyResults] = useState<Record<number, GuessResult>>({});
  const [reactions, setReactions] = useState<Array<{ id: number; emoji: string; user: string }>>([]);
  const [gateDone, setGateDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // re-derive scoreboard/round phase over time
  const roundStart = useRef(Date.now());

  // Username gate, then make sure I am a member (idempotent join; errors surfaced).
  useEffect(() => {
    if (!ready || !code) return;
    let cancelled = false;
    (async () => {
      if (!(await requireSignIn())) { router.replace('/'); return; }
      try { await joinRoom(code); } catch (e) {
        const c = e instanceof RpcError ? e.code : '';
        if (c === 'room_not_found' || c === 'room_full') { if (!cancelled) setLoadError(c); return; }
        // room_already_started: I may already be a member (reconnect) → continue
      }
      if (!cancelled) setGateDone(true);
    })();
    return () => { cancelled = true; };
  }, [ready, code, requireSignIn]);

  const meta = useMemo(() => ({ userId: me, username: profile?.username ?? '', avatar: profile?.avatar ?? null, at: 0 }), [me, profile?.username, profile?.avatar]);
  const { connection, online, refetch, react, announceGuessed } = useRoomChannel({
    code, me: meta, enabled: gateDone && Boolean(me),
    onRoom: (r) => { setRoom(r); setLoadError(null); },
    onPlayers: setPlayers,
    onPeer: (e) => {
      if (e.type === 'guessed') setGuessedNow((s) => new Set(s).add(e.userId));
      if (e.type === 'reaction') {
        const id = Date.now() + Math.random();
        setReactions((r) => [...r.slice(-5), { id, emoji: e.emoji, user: e.userId }]);
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2500);
      }
    },
    onError: (e) => setLoadError(e instanceof RpcError ? e.code : String(e)),
  });

  // Ticker for time-derived phases (scoreboard ↔ round).
  useEffect(() => {
    if (room?.status !== 'live') return;
    const id = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [room?.status]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const phase = useMemo(() => deriveRoomPhase(room, me, answered), [room, me, answered, tick]);
  const isHost = room?.host === me;
  const total = room?.rounds ?? room?.snapshot?.length ?? 5;

  // Tokens when live.
  useEffect(() => {
    if (room?.status !== 'live' || tokens.length || !code) return;
    roomTokens(code).then(setTokens).catch((e) => setLoadError(e instanceof RpcError ? e.code : String(e)));
  }, [room?.status, tokens.length, code]);

  // New game in the same room (status back to lobby) → reset local round state.
  useEffect(() => {
    if (room?.status === 'lobby') { setTokens([]); setAnswered(new Set()); setMyResults({}); }
  }, [room?.status]);

  useEffect(() => {
    if (phase.kind === 'ROUND') { roundStart.current = Date.now(); setGuessedNow(new Set()); }
  }, [phase.kind, phase.kind === 'ROUND' ? phase.round : 0]);

  const onSubmit = async (n: number, guess: number) => {
    const tok = tokens.find((x) => x.round_no === n);
    if (!tok) return;
    setBusy(true);
    try {
      const res = await submitGuess(tok.token, guess, Date.now() - roundStart.current);
      setMyResults((m) => ({ ...m, [n]: res }));
      setAnswered((s) => new Set(s).add(n));
      void announceGuessed(n);
    } catch (e) {
      const c = e instanceof RpcError ? e.code : '';
      if (c === 'already_answered' || c === 'too_late' || c === 'round_closed') {
        setAnswered((s) => new Set(s).add(n));
        if (c !== 'already_answered') Alert.alert(t('duel.tooLate'));
        void refetch();
      } else Alert.alert(t('error'), t(`err.${c}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };

  const onDeadline = useCallback(() => {
    setTimeout(() => { void poke('room', code).catch(() => undefined).then(() => refetch()); }, Math.random() * 500);
    setTimeout(() => void refetch(), 4000);
  }, [code, refetch]);

  const onStart = async () => {
    setBusy(true);
    try { await startRoom(code); } catch (e) {
      Alert.alert(t('error'), t(`err.${e instanceof RpcError ? e.code : 'unknown'}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };
  const onPlayAgain = async () => {
    setBusy(true);
    try {
      const { code: next } = await createRoom(room?.category ?? 'all', (room?.rounds === 10 ? 10 : 5));
      go(`/room/${next}`, true);
    } catch (e) {
      Alert.alert(t('error'), t(`err.${e instanceof RpcError ? e.code : 'unknown'}`, { defaultValue: t('err.unknown') }));
    } finally { setBusy(false); }
  };
  const onShareLink = () => void Share.share({ message: t('room.shareText', { code, url: roomLink(code) }), url: roomLink(code) });
  const onCopy = () => void Share.share({ message: code }); // iOS share sheet includes "Copy"
  const leave = () => Alert.alert(t('room.leaveTitle'), t('room.leaveBody'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('room.leave'), style: 'destructive', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) },
  ]);

  const board = useMemo(() => standings(players, room?.results, phase.kind === 'SCOREBOARD' ? phase.round : undefined), [players, room?.results, phase]);
  const priceOf = (n: number): number | null => {
    const r = room?.results?.[String(n)];
    const p = r ? Object.values(r).find((x) => x?.price != null)?.price : undefined;
    return p ?? myResults[n]?.price_eur ?? null;
  };
  const revealPlayers = (n: number): RevealPlayer[] => {
    const r = room?.results?.[String(n)] ?? {};
    return board.map((s) => ({
      user_id: s.user_id, username: s.username, avatar: s.avatar, isMe: s.user_id === me, total: s.total,
      guess: r[s.user_id]?.guess ?? (s.user_id === me ? myResults[n]?.guess_eur ?? null : null),
      score: r[s.user_id]?.score ?? (s.user_id === me ? myResults[n]?.score ?? null : null),
    }));
  };

  const banner = connection === 'reconnecting' ? (
    <View style={{ backgroundColor: colors.surfaceAlt, padding: spacing.xs, alignItems: 'center' }}>
      <Text style={[type.small, { color: colors.yellow }]}>{t('reconnecting')}</Text>
    </View>
  ) : null;
  const reactionLayer = reactions.length ? (
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 120, right: spacing.lg, gap: 4 }}>
      {reactions.map((r) => <Text key={r.id} style={{ fontSize: 28 }}>{r.emoji}</Text>)}
    </View>
  ) : null;

  if (loadError && !room) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg }}>
        <Text style={[type.h2, { color: colors.text, textAlign: 'center' }]}>{t(`room.err.${loadError}`, { defaultValue: t(`err.${loadError}`, { defaultValue: loadError }) })}</Text>
        <Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} />
      </View>
    );
  }
  if (!gateDone || phase.kind === 'LOADING') {
    return <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
  }

  switch (phase.kind) {
    case 'LOBBY':
      return (
        <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.xxl + spacing.lg, gap: spacing.lg }}>
          {banner}
          <Pressable onPress={leave} hitSlop={12} style={{ alignSelf: 'flex-start' }}><Text style={{ color: colors.textMuted, fontSize: 22 }}>✕</Text></Pressable>
          <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{t('room.codeLabel')}</Text>
          <Pressable onPress={onCopy}><Text style={[type.display, { color: colors.accent, textAlign: 'center', letterSpacing: 8 }]}>{code}</Text></Pressable>
          <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
            <StatusChip label={t(`category.${room!.category}`)} tone="accent" />
            <StatusChip label={t('room.roundsChip', { n: total })} />
            <StatusChip label={t('room.online', { n: online.size, total: players.length })} tone="green" />
          </View>
          <Btn tone="ghost" label={t('room.shareLink')} onPress={onShareLink} />
          {players.length < 2 ? <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('room.inviteHint')}</Text> : null}

          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.xs }}>
            {players.map((p) => (
              <PlayerRow key={p.user_id} username={p.user_id === me ? t('you') : p.username} avatar={p.avatar} online={online.has(p.user_id)} highlight={p.user_id === me}
                right={p.user_id === room!.host ? <StatusChip label={t('room.host')} tone="accent" /> : undefined} />
            ))}
          </View>

          {isHost ? (
            <Btn label={busy ? '…' : t('room.start')} onPress={onStart} disabled={busy || players.length < 2} />
          ) : (
            <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('room.waitingHost')}</Text>
          )}
        </ScrollView>
      );

    case 'ROUND': {
      const listing = room!.snapshot?.[phase.round - 1];
      const tok = tokens.find((x) => x.round_no === phase.round);
      if (!listing || !tok) return <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>;
      const submitted = guessedNow.size + (answered.has(phase.round) ? 1 : 0);
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RoundPanel
            listing={listing} roundNo={phase.round} totalRounds={total} deadline={room!.round_deadline} onDeadline={onDeadline}
            header={<Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{t('room.submitted', { n: Math.min(submitted, players.length), total: players.length })}</Text>}
            submitting={busy} onSubmit={(g) => void onSubmit(phase.round, g)} onClose={leave}
          />
          {reactionLayer}
        </View>
      );
    }

    case 'ROUND_WAITING':
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RevealPanel
            title={t('round.counter', { n: phase.round, total })}
            price={null}
            players={revealPlayers(phase.round).map((p) => ({ ...p, guess: p.isMe ? p.guess : guessedNow.has(p.user_id) ? 0 : null }))}
            waitingLabel={t('room.waitingOthers', { n: guessedNow.size + 1, total: players.length })}
            footer={
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.md }}>
                {['🔥', '😂', '😱', '👏'].map((e) => (
                  <Pressable key={e} onPress={() => void react(e)} style={{ padding: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.pill }}><Text style={{ fontSize: 22 }}>{e}</Text></Pressable>
                ))}
              </View>
            }
          />
          {reactionLayer}
        </View>
      );

    case 'SCOREBOARD':
      return (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {banner}
          <RevealPanel
            title={t('room.scoreboardTitle', { n: phase.round })}
            price={priceOf(phase.round)}
            players={revealPlayers(phase.round)}
            footer={<Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{phase.round >= total ? t('room.finishing') : t('room.nextRoundSoon')}</Text>}
          />
          {reactionLayer}
        </View>
      );

    case 'PODIUM': {
      const top = board.slice(0, 3);
      const myRank = board.find((s) => s.user_id === me)?.rank;
      return (
        <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.xxl + spacing.lg, gap: spacing.lg }}>
          <Text style={[type.h1, { color: colors.text, textAlign: 'center' }]}>{myRank === 1 ? t('room.youWon') : t('room.finishedTitle')}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: spacing.lg }}>
            {[top[1], top[0], top[2]].map((s, i) => s ? (
              <View key={s.user_id} style={{ alignItems: 'center', gap: spacing.xs }}>
                <Avatar avatar={s.avatar} username={s.username} size={i === 1 ? 72 : 56} highlight={s.user_id === me} />
                <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>{s.user_id === me ? t('you') : s.username}</Text>
                <Text style={{ color: colors.accent, fontWeight: '800', fontSize: i === 1 ? 22 : 16 }}>{s.total}</Text>
                <Text style={{ color: colors.textMuted }}>{['🥈', '🥇', '🥉'][i]}</Text>
              </View>
            ) : <View key={i} style={{ width: 56 }} />)}
          </View>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.xs }}>
            {board.map((s) => (
              <PlayerRow key={s.user_id} username={s.user_id === me ? t('you') : s.username} avatar={s.avatar} highlight={s.user_id === me} subtitle={`#${s.rank}`}
                right={<Text style={{ color: colors.text, fontWeight: '700' }}>{s.total}</Text>} />
            ))}
          </View>
          <View style={{ gap: spacing.xs }}>
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
              const p = priceOf(n);
              return <Text key={n} style={[type.small, { color: colors.textMuted }]}>{n}. {room!.snapshot?.[n - 1]?.title_hint ?? room!.snapshot?.[n - 1]?.location ?? ''} — {p != null ? formatEur(p, lang) : '—'}</Text>;
            })}
          </View>
          {isHost ? <Btn label={busy ? '…' : t('room.playAgain')} onPress={onPlayAgain} disabled={busy} /> : <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('room.waitingHostAgain')}</Text>}
          <Btn tone="ghost" label={t('share')} onPress={() => void Share.share({ message: t('room.shareResult', { code, list: board.slice(0, 3).map((s) => `${s.rank}. ${s.user_id === me ? t('you') : s.username} ${s.total}`).join(' · ') }) })} />
          <Btn tone="ghost" label={t('home')} onPress={() => router.replace('/')} />
        </ScrollView>
      );
    }
  }
}
