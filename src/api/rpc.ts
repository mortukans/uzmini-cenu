/**
 * Typed wrappers around every Supabase RPC. This file IS the contract between
 * the app and supabase/migrations. Keep names and shapes in sync with
 * docs/05-data-model.md.
 */
import { supabase } from './supabase';
import type {
  CategoryFilter, CategoryMeta, DailySet, DailySubmitResult, Duel, GuessResult, LeaderboardRow,
  Profile, Region, Room, RoomPlayer, Round, RoundToken, RpcErrorCode,
} from './types';

export class RpcError extends Error {
  constructor(public code: RpcErrorCode | string, public hint?: string) {
    super(code);
    this.name = 'RpcError';
  }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // Postgres `raise exception 'code' using hint = ...` → message = code
    throw new RpcError(error.message.replace(/^.*?:\s*/, '').trim(), (error as { hint?: string }).hint);
  }
  return data as T;
}

// ─── solo / streak ───────────────────────────────────────────────────────────

export const getRounds = (category: CategoryFilter = 'all', region: Region | null = null, n = 10) =>
  call<Round[]>('get_rounds', { p_category: category, p_region: region, p_n: n });

export const submitGuess = (token: string, guessEur: number, timeMs?: number) =>
  call<GuessResult>('submit_guess', { p_token: token, p_guess: guessEur, p_time_ms: timeMs ?? null });

/** Offline pack: rounds WITH prices, never scored server-side. */
export const getOfflinePack = (category: CategoryFilter = 'all', n = 10) =>
  call<Array<Round & { price_eur: number }>>('get_offline_pack', { p_category: category, p_n: n });

// ─── daily ───────────────────────────────────────────────────────────────────

export const getDaily = () => call<DailySet>('get_daily');
export const submitDaily = () => call<DailySubmitResult>('submit_daily');
export const leaderboard = (scope: 'global' | 'friends' = 'global', period: 'day' | 'week' | 'all' = 'day') =>
  call<LeaderboardRow[]>('leaderboard', { p_scope: scope, p_period: period });
export const myRank = (scope: 'global' | 'friends' = 'global', period: 'day' | 'week' | 'all' = 'day') =>
  call<number | null>('my_rank', { p_scope: scope, p_period: period });

// ─── duels ───────────────────────────────────────────────────────────────────

export const inviteDuel = (opponent: string, category: CategoryFilter = 'all') =>
  call<{ duel_id: string }>('invite_duel', { p_opponent: opponent, p_category: category });
export const acceptDuel = (duelId: string) => call<RoundToken[]>('accept_duel', { p_duel: duelId });
export const declineDuel = (duelId: string) => call<void>('decline_duel', { p_duel: duelId });
export const duelTokens = (duelId: string) => call<RoundToken[]>('duel_tokens', { p_duel: duelId });
/** Ask the server to close an expired round if everyone is waiting (docs/06). */
export const poke = (ctx: 'duel' | 'room', ctxId: string) => call<void>('poke', { p_ctx: ctx, p_ctx_id: ctxId });

export async function getDuel(duelId: string): Promise<Duel> {
  const { data, error } = await supabase.from('duels').select('*').eq('id', duelId).single();
  if (error) throw new RpcError(error.message);
  return data as unknown as Duel;
}
export async function listDuels(): Promise<Duel[]> {
  const { data, error } = await supabase.from('duels').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw new RpcError(error.message);
  return (data ?? []) as unknown as Duel[];
}

// ─── rooms ───────────────────────────────────────────────────────────────────

export const createRoom = (category: CategoryFilter = 'all', rounds: 5 | 10 = 5) =>
  call<{ code: string; link: string }>('create_room', { p_category: category, p_rounds: rounds });
export const joinRoom = (code: string) =>
  call<{ code: string; host: string; rounds: number; category: CategoryFilter }>('join_room', { p_code: code.toUpperCase() });
export const startRoom = (code: string) => call<void>('start_room', { p_code: code });
export const roomTokens = (code: string) => call<RoundToken[]>('room_tokens', { p_code: code });

export async function getRoom(code: string): Promise<Room> {
  const { data, error } = await supabase.from('rooms').select('*').eq('code', code).single();
  if (error) throw new RpcError(error.message);
  return data as unknown as Room;
}
export async function getRoomPlayers(code: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase
    .from('room_players')
    .select('*, profiles:user_id(username, avatar)')
    .eq('room_code', code);
  if (error) throw new RpcError(error.message);
  return (data ?? []).map((r: any) => ({ ...r, username: r.profiles?.username, avatar: r.profiles?.avatar }));
}

// ─── profiles / friends ──────────────────────────────────────────────────────

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw new RpcError(error.message);
  return data as Profile;
}
export async function updateProfile(patch: Partial<Pick<Profile, 'avatar' | 'lang'>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new RpcError('sign_in_required');
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) throw new RpcError(error.message);
}
/** Choose / change the username (^[a-z0-9_]{3,16}$, unique). Throws username_invalid | username_taken. */
export const setUsername = (username: string) =>
  call<{ username: string }>('set_username', { p_username: username.trim().toLowerCase() });
export async function searchProfiles(q: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('id, username, avatar, lang, is_premium, created_at')
    .ilike('username', `%${q}%`).limit(20);
  if (error) throw new RpcError(error.message);
  return (data ?? []) as Profile[];
}
export const requestFriend = (friendId: string) => call<void>('request_friend', { p_friend: friendId });
export const acceptFriend = (friendId: string) => call<void>('accept_friend', { p_friend: friendId });
export const removeFriend = (friendId: string) => call<void>('remove_friend', { p_friend: friendId });
export const listFriends = () =>
  call<Array<{ user_id: string; username: string; avatar: string | null; status: 'pending_in' | 'pending_out' | 'accepted' }>>('list_friends');

export const registerPushToken = (token: string, platform: 'ios' | 'android' = 'ios') =>
  call<void>('register_push_token', { p_token: token, p_platform: platform });
export const deleteMe = () => call<void>('delete_me');

export async function getCategories(): Promise<CategoryMeta[]> {
  const { data, error } = await supabase.from('categories').select('*');
  if (error) throw new RpcError(error.message);
  return (data ?? []) as CategoryMeta[];
}
