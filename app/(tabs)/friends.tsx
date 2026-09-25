/**
 * Friends tab: search, requests, friends with "Challenge", open duels, rooms entry.
 * Players without a chosen username see a "pick a username" card (useRequireSignIn).
 * Depends on: src/api/rpc (listFriends, searchProfiles, requestFriend, acceptFriend,
 * removeFriend, inviteDuel, listDuels, createRoom, joinRoom), src/auth, react-query, i18n social.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import {
  acceptFriend, createRoom, inviteDuel, joinRoom, listDuels, listFriends, removeFriend, requestFriend, RpcError, searchProfiles,
} from '../../src/api/rpc';
import type { Duel, DuelStatus } from '../../src/api/types';
import { useRequireSignIn } from '../../src/auth/apple';
import { useAuth } from '../../src/auth/store';
import { go } from '../../src/notifications/linking';
import { opponentOf, duelOutcome } from '../../src/realtime/duelState';
import { PlayerRow } from '../../src/ui/components/PlayerRow';
import { StatusChip, type ChipTone } from '../../src/ui/components/StatusChip';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const duelTone: Record<DuelStatus, ChipTone> = { invited: 'yellow', live: 'green', finished: 'neutral', expired: 'neutral', declined: 'red' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.small, { color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: spacing.md }]}>{title}</Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.xs }}>{children}</View>
    </View>
  );
}

function Button({ label, onPress, tone = 'accent', small }: { label: string; onPress: () => void; tone?: 'accent' | 'ghost' | 'danger'; small?: boolean }) {
  const bg = tone === 'accent' ? colors.accent : tone === 'danger' ? 'rgba(240,96,96,0.15)' : colors.surfaceAlt;
  const fg = tone === 'accent' ? colors.accentText : tone === 'danger' ? colors.red : colors.text;
  return (
    <Pressable onPress={onPress} style={{ backgroundColor: bg, paddingHorizontal: small ? spacing.md : spacing.lg, paddingVertical: small ? 6 : spacing.md, borderRadius: radius.pill }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 16 }}>{label}</Text>
    </Pressable>
  );
}

export default function FriendsScreen() {
  const { t } = useTranslation('social');
  const { hasUsername, ready, session, profile } = useAuth();
  const me = session?.user.id ?? '';
  const requireSignIn = useRequireSignIn();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const signedIn = ready && hasUsername;
  const friendsQ = useQuery({ queryKey: ['friends'], queryFn: listFriends, enabled: signedIn });
  const duelsQ = useQuery({ queryKey: ['duels'], queryFn: listDuels, enabled: signedIn, refetchInterval: 30_000 });
  const searchQ = useQuery({
    queryKey: ['profileSearch', query],
    queryFn: () => searchProfiles(query.trim()),
    enabled: signedIn && query.trim().length >= 2,
  });

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['friends'] }); void qc.invalidateQueries({ queryKey: ['duels'] }); };
  const showErr = (e: unknown) => {
    const code = e instanceof RpcError ? e.code : 'unknown';
    Alert.alert(t('error'), t(`err.${code}`, { defaultValue: t('err.unknown') }));
  };
  const act = useMutation({
    mutationFn: async ({ fn, id }: { fn: (id: string) => Promise<unknown>; id: string }) => { setBusy(id); await fn(id); },
    onSettled: () => { setBusy(null); invalidate(); },
    onError: showErr,
  });

  const friends = friendsQ.data ?? [];
  const accepted = friends.filter((f) => f.status === 'accepted');
  const incoming = friends.filter((f) => f.status === 'pending_in');
  const outgoing = friends.filter((f) => f.status === 'pending_out');
  const knownIds = useMemo(() => new Set(friends.map((f) => f.user_id).concat(me)), [friends, me]);
  const openDuels = (duelsQ.data ?? []).filter((d) => d.status === 'invited' || d.status === 'live');
  const pastDuels = (duelsQ.data ?? []).filter((d) => d.status !== 'invited' && d.status !== 'live').slice(0, 20);
  const nameOf = (id: string) => friends.find((f) => f.user_id === id)?.username ?? t('duel.someone');

  const challenge = async (friendId: string) => {
    setBusy(friendId);
    try {
      const { duel_id } = await inviteDuel(friendId, 'all');
      invalidate();
      go(`/duel/${duel_id}`);
    } catch (e) {
      const code = e instanceof RpcError ? e.code : '';
      if (code === 'rate_limited') Alert.alert(t('duel.limitTitle'), t('duel.limitBody'), [{ text: t('ok') }]);
      else if (code === 'username_required') void requireSignIn();
      else showErr(e);
    } finally { setBusy(null); }
  };

  const onCreateRoom = async () => {
    if (!(await requireSignIn())) return;
    setBusy('room');
    try {
      const { code } = await createRoom('all', 5);
      go(`/room/${code}`);
    } catch (e) { showErr(e); } finally { setBusy(null); }
  };
  const onJoinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    if (!(await requireSignIn())) return;
    setBusy('join');
    try {
      await joinRoom(code);
      setJoinCode('');
      go(`/room/${code}`);
    } catch (e) { showErr(e); } finally { setBusy(null); }
  };

  const duelRow = (d: Duel) => {
    const opp = opponentOf(d, me);
    const mine = d.scores?.[me] ?? 0;
    const theirs = d.scores?.[opp] ?? 0;
    const finished = d.status === 'finished';
    const outcome = duelOutcome(d, me);
    return (
      <PlayerRow
        key={d.id}
        username={nameOf(opp)}
        subtitle={finished ? `${t(`duel.outcome.${outcome}`)} · ${mine} : ${theirs}` : formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
        onPress={() => go(`/duel/${d.id}`)}
        right={<StatusChip label={t(`duel.status.${d.status}`)} tone={duelTone[d.status]} />}
      />
    );
  };

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!signedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center', gap: spacing.lg }}>
        <Text style={[type.h1, { color: colors.text }]}>{t('friends.title')}</Text>
        <Text style={[type.body, { color: colors.textMuted }]}>{t('friends.noUsernameBody')}</Text>
        <Button label={t('signIn.cta')} onPress={() => void requireSignIn()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xxl + spacing.lg, gap: spacing.xl }}
      refreshControl={<RefreshControl tintColor={colors.accent} refreshing={friendsQ.isRefetching} onRefresh={invalidate} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[type.h1, { color: colors.text }]}>{t('friends.title')}</Text>

      {/* rooms */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Pressable onPress={onCreateRoom} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: 2 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{busy === 'room' ? '…' : t('room.create')}</Text>
          <Text style={[type.small, { color: colors.textMuted }]}>{t('room.createHint')}</Text>
        </Pressable>
        <View style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs }}>
          <TextInput
            value={joinCode} onChangeText={(v) => setJoinCode(v.toUpperCase())} maxLength={4} autoCapitalize="characters" autoCorrect={false}
            placeholder={t('room.codePlaceholder')} placeholderTextColor={colors.textMuted} onSubmitEditing={onJoinRoom}
            style={{ color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: 4, padding: 0 }}
          />
          <Pressable onPress={onJoinRoom} disabled={joinCode.length < 4}>
            <Text style={[type.small, { color: joinCode.length >= 4 ? colors.accent : colors.textMuted, fontWeight: '600' }]}>{busy === 'join' ? '…' : t('room.join')}</Text>
          </Pressable>
        </View>
      </View>

      {/* search */}
      <View style={{ gap: spacing.sm }}>
        <TextInput
          value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}
          placeholder={t('friends.searchPlaceholder')} placeholderTextColor={colors.textMuted}
          style={{ backgroundColor: colors.surface, color: colors.text, borderRadius: radius.md, padding: spacing.md, fontSize: 16 }}
        />
        {profile?.username ? <Text style={[type.small, { color: colors.textMuted, paddingHorizontal: spacing.xs }]}>{t('friends.yourName', { name: profile.username })}</Text> : null}
        {query.trim().length >= 2 && (
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.xs }}>
            {searchQ.isLoading ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.md }} /> : null}
            {(searchQ.data ?? []).filter((p) => !knownIds.has(p.id) && p.username).map((p) => (
              <PlayerRow key={p.id} username={p.username} avatar={p.avatar}
                right={<Button small label={busy === p.id ? '…' : t('friends.add')} onPress={() => act.mutate({ fn: requestFriend, id: p.id })} />} />
            ))}
            {searchQ.isSuccess && !searchQ.data.filter((p) => !knownIds.has(p.id)).length ? (
              <Text style={{ color: colors.textMuted, padding: spacing.md }}>{t('friends.noResults')}</Text>
            ) : null}
          </View>
        )}
      </View>

      {incoming.length > 0 && (
        <Section title={t('friends.incoming')}>
          {incoming.map((f) => (
            <PlayerRow key={f.user_id} username={f.username} avatar={f.avatar}
              right={<View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Button small label={t('friends.accept')} onPress={() => act.mutate({ fn: acceptFriend, id: f.user_id })} />
                <Button small tone="ghost" label={t('friends.decline')} onPress={() => act.mutate({ fn: removeFriend, id: f.user_id })} />
              </View>} />
          ))}
        </Section>
      )}

      {openDuels.length > 0 && <Section title={t('duel.open')}>{openDuels.map(duelRow)}</Section>}

      <Section title={t('friends.list', { n: accepted.length })}>
        {friendsQ.isLoading ? <ActivityIndicator color={colors.accent} style={{ padding: spacing.md }} /> : null}
        {accepted.map((f) => (
          <PlayerRow key={f.user_id} username={f.username} avatar={f.avatar}
            onLongPress={() => Alert.alert(f.username, undefined, [
              { text: t('friends.remove'), style: 'destructive', onPress: () => act.mutate({ fn: removeFriend, id: f.user_id }) },
              { text: t('cancel'), style: 'cancel' },
            ])}
            right={<Button small label={busy === f.user_id ? '…' : t('duel.challenge')} onPress={() => void challenge(f.user_id)} />} />
        ))}
        {friendsQ.isSuccess && accepted.length === 0 ? (
          <Text style={{ color: colors.textMuted, padding: spacing.md }}>{t('friends.empty')}</Text>
        ) : null}
      </Section>

      {outgoing.length > 0 && (
        <Section title={t('friends.outgoing')}>
          {outgoing.map((f) => (
            <PlayerRow key={f.user_id} username={f.username} avatar={f.avatar}
              right={<Button small tone="ghost" label={t('friends.cancelRequest')} onPress={() => act.mutate({ fn: removeFriend, id: f.user_id })} />} />
          ))}
        </Section>
      )}

      {pastDuels.length > 0 && <Section title={t('duel.history')}>{pastDuels.map(duelRow)}</Section>}
    </ScrollView>
  );
}
