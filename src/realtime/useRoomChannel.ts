/**
 * useRoomChannel — one private Realtime channel `room:{code}` (docs/06).
 * - postgres_changes UPDATE on rooms (code=eq.) → onRoom(row)
 * - postgres_changes * on room_players (room_code=eq.) → onPlayers(refetched list with usernames)
 * - presence (key = my user id) → online set
 * - broadcast 'reaction' / 'guessed' → onPeer
 * - refetch room + players on SUBSCRIBED and on foreground
 * - last_seen heartbeat every 20 s (what the server trigger trusts)
 * Depends on: src/api/supabase, src/api/rpc.{getRoom,getRoomPlayers}.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { getRoom, getRoomPlayers } from '../api/rpc';
import type { Room, RoomPlayer } from '../api/types';
import type { Connection } from './useDuelChannel';

export type RoomPeerEvent =
  | { type: 'reaction'; emoji: string; userId: string }
  | { type: 'guessed'; round: number; userId: string };

export interface PresenceMeta {
  userId: string;
  username: string;
  avatar: string | null;
  at: number;
}

interface Options {
  code: string;
  me: PresenceMeta;
  enabled?: boolean;
  onRoom: (row: Room) => void;
  onPlayers: (players: RoomPlayer[]) => void;
  onPeer?: (e: RoomPeerEvent) => void;
  onError?: (e: unknown) => void;
}

export function useRoomChannel({ code, me, enabled = true, onRoom, onPlayers, onPeer, onError }: Options) {
  const [connection, setConnection] = useState<Connection>('connecting');
  const [online, setOnline] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const cb = useRef({ onRoom, onPlayers, onPeer, onError });
  cb.current = { onRoom, onPlayers, onPeer, onError };

  const refetch = useCallback(async () => {
    try {
      const [room, players] = await Promise.all([getRoom(code), getRoomPlayers(code)]);
      cb.current.onRoom(room);
      cb.current.onPlayers(players);
    } catch (e) {
      cb.current.onError?.(e);
    }
  }, [code]);

  const refetchPlayers = useCallback(async () => {
    try {
      cb.current.onPlayers(await getRoomPlayers(code));
    } catch (e) {
      cb.current.onError?.(e);
    }
  }, [code]);

  useEffect(() => {
    if (!enabled || !code) return;
    const channel = supabase.channel(`room:${code}`, {
      config: { private: true, presence: { key: me.userId }, broadcast: { self: true, ack: false } },
    });
    channelRef.current = channel;

    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, (p) =>
        cb.current.onRoom(p.new as Room),
      )
      // Player rows lack usernames; refetch the joined list on any change (small table).
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_code=eq.${code}` }, () =>
        void refetchPlayers(),
      )
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .on('broadcast', { event: 'reaction' }, ({ payload }) => cb.current.onPeer?.({ type: 'reaction', ...(payload as { emoji: string; userId: string }) }))
      .on('broadcast', { event: 'guessed' }, ({ payload }) => cb.current.onPeer?.({ type: 'guessed', ...(payload as { round: number; userId: string }) }))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          await channel.track({ ...me, at: Date.now() }).catch(() => undefined);
          void refetch();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('reconnecting');
        }
      });

    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refetch();
    });

    const beat = () =>
      supabase
        .from('room_players')
        .update({ last_seen: new Date().toISOString() })
        .eq('room_code', code)
        .eq('user_id', me.userId)
        .then(() => undefined, () => undefined);
    const hb = setInterval(beat, 20_000);

    return () => {
      clearInterval(hb);
      appSub.remove();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // me.username/avatar changes do not need a resubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, me.userId, enabled, refetch, refetchPlayers]);

  const react = useCallback(
    (emoji: string) => channelRef.current?.send({ type: 'broadcast', event: 'reaction', payload: { userId: me.userId, emoji } }),
    [me.userId],
  );
  const announceGuessed = useCallback(
    (round: number) => channelRef.current?.send({ type: 'broadcast', event: 'guessed', payload: { userId: me.userId, round } }),
    [me.userId],
  );

  return { connection, online, refetch, react, announceGuessed };
}
