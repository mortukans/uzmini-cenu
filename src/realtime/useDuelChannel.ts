/**
 * useDuelChannel — one private Realtime channel `duel:{id}` (docs/06).
 * - postgres_changes UPDATE on duels (filter id=eq.) → onRow(row)
 * - broadcast event 'peer' → onPeer ({guessed|emoji|typing})
 * - refetch the row on SUBSCRIBED (covers missed events) and on app foreground
 * - heartbeat: `duel_presence` upsert every 20 s (best effort; table may not exist yet → ignored)
 * Depends on: src/api/supabase, src/api/rpc.getDuel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { getDuel } from '../api/rpc';
import type { Duel } from '../api/types';

export type DuelPeerEvent =
  | { type: 'guessed'; round: number; userId: string }
  | { type: 'emoji'; emoji: string; userId: string }
  | { type: 'typing'; userId: string };

export type Connection = 'connecting' | 'live' | 'reconnecting';

/** Omit that distributes over a union (plain Omit collapses discriminated unions). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type DuelPeerMessage = DistributiveOmit<DuelPeerEvent, 'userId'>;

interface Options {
  duelId: string;
  myId: string;
  enabled?: boolean;
  onRow: (row: Duel) => void;
  onPeer?: (e: DuelPeerEvent) => void;
  onError?: (e: unknown) => void;
}

export function useDuelChannel({ duelId, myId, enabled = true, onRow, onPeer, onError }: Options) {
  const [connection, setConnection] = useState<Connection>('connecting');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRowRef = useRef(onRow);
  const onPeerRef = useRef(onPeer);
  const onErrorRef = useRef(onError);
  onRowRef.current = onRow;
  onPeerRef.current = onPeer;
  onErrorRef.current = onError;

  const refetch = useCallback(async () => {
    try {
      onRowRef.current(await getDuel(duelId));
    } catch (e) {
      onErrorRef.current?.(e);
    }
  }, [duelId]);

  useEffect(() => {
    if (!enabled || !duelId) return;
    const channel = supabase.channel(`duel:${duelId}`, { config: { private: true, broadcast: { self: false } } });
    channelRef.current = channel;

    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'duels', filter: `id=eq.${duelId}` }, (payload) => {
        onRowRef.current(payload.new as Duel);
      })
      .on('broadcast', { event: 'peer' }, ({ payload }) => onPeerRef.current?.(payload as DuelPeerEvent))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          void refetch();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('reconnecting');
        }
      });

    // Foreground → refetch (Realtime may have dropped while backgrounded).
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refetch();
    });

    // Heartbeat for push suppression (docs/06). Silently ignored if the table is absent.
    const beat = () =>
      supabase
        .from('duel_presence')
        .upsert({ duel_id: duelId, user_id: myId, last_seen: new Date().toISOString() })
        .then(() => undefined, () => undefined);
    void beat();
    const hb = setInterval(beat, 20_000);

    return () => {
      clearInterval(hb);
      appSub.remove();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [duelId, myId, enabled, refetch]);

  const send = useCallback(
    (msg: DuelPeerMessage) =>
      channelRef.current?.send({ type: 'broadcast', event: 'peer', payload: { ...msg, userId: myId } }),
    [myId],
  );

  return { connection, refetch, send };
}
