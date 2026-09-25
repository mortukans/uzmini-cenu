/**
 * Client-facing contract with the Supabase RPCs (docs/05-data-model.md).
 * Prices NEVER appear on a listing before the guess; they only come back from
 * submit_guess or via round results after a duel/room round closes.
 */

export type Category = 'flats' | 'houses' | 'cars' | 'random' | 'land';
export type CategoryFilter = Category | 'all';
export type Region = 'riga' | 'riga_region' | 'latvia';
export type Mode = 'solo' | 'streak' | 'daily' | 'duel' | 'room';
export type Lang = 'lv' | 'ru' | 'en';

export interface ListingAttributes {
  district?: string;
  town?: string;
  rooms?: number;
  m2?: number;
  land_m2?: number;
  floor?: number;
  floors_total?: number;
  elevator?: boolean;
  series?: string;
  house_type?: string;
  amenities?: string[];
  make?: string;
  model?: string;
  year?: number;
  engine_l?: number;
  fuel?: 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
  gearbox?: 'auto' | 'manual';
  km?: number;
  color?: string;
  body?: string;
  inspection_until?: string;
  subcategory?: string;
  condition?: string;
  manufacturer?: string;
  dealer?: boolean;
  promoted?: boolean;
}

/** `private.strip(listing)` output: a listing without its price. */
export interface StrippedListing {
  id: number;
  category: Category;
  region: Region | null;
  location: string | null;
  attributes: ListingAttributes;
  title_hint: string | null;
  photo_urls: string[];
  source: string;
  source_url: string;
}

/** One playable round: a stripped listing plus its signed single-use token. */
export interface Round extends StrippedListing {
  token: string;
  round_no?: number;
}

/** `submit_guess` result. */
export interface GuessResult {
  price_eur: number;
  score: number;
  guess_eur: number;
  source_url: string;
}

/** `get_daily` result. */
export interface DailySet {
  day: string; // YYYY-MM-DD (Europe/Riga)
  number: number; // "Uzmini Cenu #37"
  rounds: Round[];
  already_played: boolean;
  result: DailyResult | null;
}

export interface DailyResult {
  day: string;
  user_id: string;
  total: number;
  grid: string; // '🟩🟩🟨🟥🟩'
  submitted_at?: string;
}

/** `submit_daily` result. */
export interface DailySubmitResult {
  total: number;
  grid: string;
  share_text: string;
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  username: string;
  avatar: string | null;
  total: number;
  is_me: boolean;
}

export interface Profile {
  id: string;
  username: string | null;
  avatar: string | null;
  lang: Lang;
  is_premium: boolean;
  created_at: string;
}

export type FriendshipStatus = 'pending' | 'accepted';
export interface Friendship {
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
}

export type DuelStatus = 'invited' | 'live' | 'finished' | 'expired' | 'declined';

/** Per-round results as written by `private.close_round`. */
export type RoundResults = Record<string /* round_no */, Record<string /* user_id */, { guess: number; score: number; price?: number }>>;

export interface Duel {
  id: string;
  challenger: string;
  opponent: string;
  listing_ids: number[];
  snapshot: StrippedListing[];
  status: DuelStatus;
  scores: Record<string, number>;
  current_round: number;
  round_deadline: string | null;
  accepted_at: string | null;
  finished_at: string | null;
  async: boolean;
  results: RoundResults;
  created_at: string;
}

export interface RoundToken {
  round_no: number;
  listing_id: number;
  token: string;
}

export type RoomStatus = 'lobby' | 'live' | 'finished';

export interface Room {
  code: string;
  host: string;
  category: CategoryFilter;
  rounds: number;
  listing_ids: number[];
  snapshot: StrippedListing[];
  status: RoomStatus;
  current_round: number;
  round_deadline: string | null;
  results: RoundResults;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface RoomPlayer {
  room_code: string;
  user_id: string;
  total: number;
  joined_at: string;
  last_seen: string;
  // joined client-side
  username?: string;
  avatar?: string | null;
}

export interface CategoryMeta {
  key: Category;
  labels: Record<Lang, string>;
  min_eur: number | null;
  max_eur: number | null;
  steps: number[];
}

/** Push payloads (docs/06-multiplayer.md). `type` drives deep-link routing. */
export type PushData =
  | { type: 'duel_invite'; duelId: string; from: string }
  | { type: 'duel_accepted'; duelId: string }
  | { type: 'duel_finished'; duelId: string }
  | { type: 'daily_ready'; day: string }
  | { type: 'friend_request'; from: string };

/** Error codes raised by RPCs (`raise exception '<code>'`). */
export type RpcErrorCode =
  | 'bad_n' | 'bad_token' | 'token_expired' | 'round_closed' | 'too_late' | 'already_answered'
  | 'daily_not_ready' | 'daily_incomplete' | 'sign_in_required' | 'self_duel' | 'not_friends'
  | 'username_required' | 'username_taken' | 'username_invalid'
  | 'rate_limited' | 'duel_already_open' | 'not_enough_listings' | 'duel_not_invited' | 'not_participant'
  | 'bad_rounds' | 'code_collision' | 'room_not_found' | 'room_already_started' | 'room_full'
  | 'not_host_or_not_lobby';
