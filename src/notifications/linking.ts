/**
 * Deep-link helpers: `uzminicenu://` scheme and https universal links
 * (`https://uzminicenu.lv/r/CODE`, `/d/NUMBER`). Expo Router maps both to the
 * file routes app/r/[code].tsx and app/d/[number].tsx automatically; this
 * module only builds/parses URLs and maps push payloads to routes.
 */
import * as Linking from 'expo-linking';
import { router, type Href } from 'expo-router';
import { env } from '../env';
import type { PushData } from '../api/types';

export const SCHEME = 'uzminicenu';
export const WEB_BASE = `https://${env.UNIVERSAL_LINK_HOST}`;

export const roomLink = (code: string) => `${WEB_BASE}/r/${code.toUpperCase()}`;
export const dailyLink = (n: number | string) => `${WEB_BASE}/d/${n}`;
export const duelSchemeUrl = (id: string) => `${SCHEME}://duel/${id}`;

/** Superset of PushData: the send-push function also emits duel_result/duel_async/room_invite/daily (docs/06). */
type LoosePush = { type?: PushData['type'] | string; duelId?: string; code?: string; url?: string };

/** Push `data` → in-app route. Accepts the docs/06 aliases too (duel_result, daily, room_invite). */
export function routeForPush(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as LoosePush;
  switch (d.type) {
    case 'duel_invite':
    case 'duel_accepted':
    case 'duel_finished':
    case 'duel_result':
    case 'duel_async':
    case 'duel_declined':
    case 'duel_expired':
      return d.duelId ? `/duel/${d.duelId}` : null;
    case 'room_invite':
      return d.code ? `/room/${d.code}` : null;
    case 'daily_ready':
    case 'daily':
      return '/(tabs)/daily';
    case 'friend_request':
      return '/(tabs)/friends';
    default:
      return d.url ? routeForUrl(d.url) : null;
  }
}

/** `uzminicenu://duel/x`, `https://uzminicenu.lv/r/KTRP` → in-app path or null. */
export function routeForUrl(url: string): string | null {
  try {
    const { path } = Linking.parse(url);
    if (!path) return null;
    const p = '/' + path.replace(/^\/+/, '');
    if (/^\/(duel|room|r|d)\/[^/]+$/.test(p)) return p;
    return null;
  } catch {
    return null;
  }
}

/** Navigate by string path (typed routes are generated at build; keep call sites untyped). */
export const go = (path: string, replace = false) =>
  replace ? router.replace(path as Href) : router.push(path as Href);
