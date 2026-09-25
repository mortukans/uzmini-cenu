/**
 * Hand-written Database type for supabase-js generics, mirroring
 * supabase/migrations. Regenerate with
 *   supabase gen types typescript --local > src/api/database.types.ts
 * once Docker is available; until then keep this in sync by hand.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type ListingStatus = 'active' | 'expired' | 'rejected';
type DuelStatusDb = 'invited' | 'live' | 'finished' | 'expired' | 'declined';
type RoomStatusDb = 'lobby' | 'live' | 'finished';

export interface Database {
  public: {
    Tables: {
      listings: {
        Row: {
          id: number;
          source: string;
          source_url: string;
          category: string;
          price_eur: number;
          region: string | null;
          location: string | null;
          attributes: Json;
          title_hint: string | null;
          photo_urls: string[];
          photo_hash: string | null;
          status: ListingStatus;
          quality: number;
          first_seen_at: string;
          checked_at: string;
        };
        Insert: {
          id?: number;
          source: string;
          source_url: string;
          category: string;
          price_eur: number;
          region?: string | null;
          location?: string | null;
          attributes?: Json;
          title_hint?: string | null;
          photo_urls: string[];
          photo_hash?: string | null;
          status?: ListingStatus;
          quality?: number;
          first_seen_at?: string;
          checked_at?: string;
        };
        Update: Partial<Database['public']['Tables']['listings']['Insert']>;
        Relationships: [];
      };
      categories: {
        Row: {
          key: string;
          labels: Json;
          min_eur: number | null;
          max_eur: number | null;
          steps: number[];
        };
        Insert: {
          key: string;
          labels: Json;
          min_eur?: number | null;
          max_eur?: number | null;
          steps: number[];
        };
        Update: Partial<Database['public']['Tables']['categories']['Insert']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          username: string | null;
          avatar: string | null;
          lang: string;
          is_premium: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          avatar?: string | null;
          lang?: string;
          is_premium?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      friendships: {
        Row: {
          user_id: string;
          friend_id: string;
          status: 'pending' | 'accepted';
          created_at: string;
        };
        Insert: {
          user_id: string;
          friend_id: string;
          status?: 'pending' | 'accepted';
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['friendships']['Insert']>;
        Relationships: [];
      };
      friend_stats: {
        Row: { user_id: string; friend_id: string; wins: number; losses: number; draws: number };
        Insert: { user_id: string; friend_id: string; wins?: number; losses?: number; draws?: number };
        Update: Partial<Database['public']['Tables']['friend_stats']['Insert']>;
        Relationships: [];
      };
      guesses: {
        Row: {
          id: number;
          user_id: string | null;
          listing_id: number;
          mode: 'solo' | 'streak' | 'daily' | 'duel' | 'room';
          context_id: string | null;
          round_no: number | null;
          guess_eur: number;
          score: number;
          token_nonce: string | null;
          time_ms: number | null;
          suspicious: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id?: string | null;
          listing_id: number;
          mode: 'solo' | 'streak' | 'daily' | 'duel' | 'room';
          context_id?: string | null;
          round_no?: number | null;
          guess_eur: number;
          score: number;
          token_nonce?: string | null;
          time_ms?: number | null;
          suspicious?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['guesses']['Insert']>;
        Relationships: [];
      };
      daily_sets: {
        Row: { day: string; listing_ids: number[]; snapshot: Json; created_at: string };
        Insert: { day: string; listing_ids: number[]; snapshot: Json; created_at?: string };
        Update: Partial<Database['public']['Tables']['daily_sets']['Insert']>;
        Relationships: [];
      };
      daily_results: {
        Row: { day: string; user_id: string; total: number; grid: string; submitted_at: string };
        Insert: { day: string; user_id: string; total: number; grid: string; submitted_at?: string };
        Update: Partial<Database['public']['Tables']['daily_results']['Insert']>;
        Relationships: [];
      };
      context_prices: {
        Row: { context_type: 'daily' | 'duel' | 'room'; context_id: string; listing_id: number; price_eur: number };
        Insert: { context_type: 'daily' | 'duel' | 'room'; context_id: string; listing_id: number; price_eur: number };
        Update: Partial<Database['public']['Tables']['context_prices']['Insert']>;
        Relationships: [];
      };
      duels: {
        Row: {
          id: string;
          challenger: string | null;
          opponent: string | null;
          listing_ids: number[];
          snapshot: Json;
          status: DuelStatusDb;
          scores: Json;
          current_round: number;
          round_deadline: string | null;
          accepted_at: string | null;
          finished_at: string | null;
          async: boolean;
          results: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          challenger?: string | null;
          opponent?: string | null;
          listing_ids: number[];
          snapshot: Json;
          status?: DuelStatusDb;
          scores?: Json;
          current_round?: number;
          round_deadline?: string | null;
          accepted_at?: string | null;
          finished_at?: string | null;
          async?: boolean;
          results?: Json;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['duels']['Insert']>;
        Relationships: [];
      };
      rooms: {
        Row: {
          code: string;
          host: string | null;
          category: string;
          rounds: number;
          listing_ids: number[] | null;
          snapshot: Json | null;
          status: RoomStatusDb;
          current_round: number;
          round_deadline: string | null;
          results: Json;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          host?: string | null;
          category?: string;
          rounds?: number;
          listing_ids?: number[] | null;
          snapshot?: Json | null;
          status?: RoomStatusDb;
          current_round?: number;
          round_deadline?: string | null;
          results?: Json;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['rooms']['Insert']>;
        Relationships: [];
      };
      room_players: {
        Row: { room_code: string; user_id: string; total: number; joined_at: string; last_seen: string };
        Insert: { room_code: string; user_id: string; total?: number; joined_at?: string; last_seen?: string };
        Update: Partial<Database['public']['Tables']['room_players']['Insert']>;
        Relationships: [];
      };
      push_tokens: {
        Row: { user_id: string; token: string; platform: 'ios' | 'android'; updated_at: string };
        Insert: { user_id: string; token: string; platform?: 'ios' | 'android'; updated_at?: string };
        Update: Partial<Database['public']['Tables']['push_tokens']['Insert']>;
        Relationships: [];
      };
      push_tickets: {
        Row: { ticket_id: string; token: string; event: string | null; sent_at: string; checked: boolean };
        Insert: { ticket_id: string; token: string; event?: string | null; sent_at?: string; checked?: boolean };
        Update: Partial<Database['public']['Tables']['push_tickets']['Insert']>;
        Relationships: [];
      };
      rate_limits: {
        Row: { user_id: string; action: string; window: string; count: number };
        Insert: { user_id: string; action: string; window?: string; count?: number };
        Update: Partial<Database['public']['Tables']['rate_limits']['Insert']>;
        Relationships: [];
      };
      scrape_runs: {
        Row: {
          id: number;
          source: string;
          started_at: string;
          finished_at: string | null;
          requests: number;
          new_rows: number;
          updated_rows: number;
          expired_rows: number;
          rejected: Json;
          errors: number;
          blocked_until: string | null;
          notes: string | null;
          queue_cursor: Json | null;
        };
        Insert: {
          id?: number;
          source: string;
          started_at?: string;
          finished_at?: string | null;
          requests?: number;
          new_rows?: number;
          updated_rows?: number;
          expired_rows?: number;
          rejected?: Json;
          errors?: number;
          blocked_until?: string | null;
          notes?: string | null;
          queue_cursor?: Json | null;
        };
        Update: Partial<Database['public']['Tables']['scrape_runs']['Insert']>;
        Relationships: [];
      };
      photo_blocklist: {
        Row: { photo_hash: string; note: string | null; added_at: string };
        Insert: { photo_hash: string; note?: string | null; added_at?: string };
        Update: Partial<Database['public']['Tables']['photo_blocklist']['Insert']>;
        Relationships: [];
      };
      listing_hashes: {
        Row: { photo_hash: string; category: string | null; deleted_at: string };
        Insert: { photo_hash: string; category?: string | null; deleted_at?: string };
        Update: Partial<Database['public']['Tables']['listing_hashes']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_rounds: { Args: { p_category?: string; p_region?: string | null; p_n?: number }; Returns: Json };
      submit_guess: { Args: { p_token: string; p_guess: number; p_time_ms?: number | null }; Returns: Json };
      get_offline_pack: { Args: { p_category?: string; p_n?: number }; Returns: Json };
      get_daily: { Args: Record<string, never>; Returns: Json };
      submit_daily: { Args: Record<string, never>; Returns: Json };
      leaderboard: {
        Args: { p_scope?: string; p_period?: string };
        Returns: { rank: number; user_id: string; username: string | null; avatar: string | null; total: number; is_me: boolean }[];
      };
      my_rank: { Args: { p_scope?: string; p_period?: string }; Returns: number | null };
      invite_duel: { Args: { p_opponent: string; p_category?: string }; Returns: Json };
      accept_duel: { Args: { p_duel: string }; Returns: Json };
      decline_duel: { Args: { p_duel: string }; Returns: undefined };
      duel_tokens: { Args: { p_duel: string }; Returns: Json };
      poke: { Args: { p_ctx: string; p_ctx_id: string }; Returns: undefined };
      create_room: { Args: { p_category?: string; p_rounds?: number }; Returns: Json };
      join_room: { Args: { p_code: string }; Returns: Json };
      start_room: { Args: { p_code: string }; Returns: undefined };
      room_tokens: { Args: { p_code: string }; Returns: Json };
      request_friend: { Args: { p_friend: string }; Returns: undefined };
      accept_friend: { Args: { p_friend: string }; Returns: undefined };
      remove_friend: { Args: { p_friend: string }; Returns: undefined };
      list_friends: { Args: Record<string, never>; Returns: Json };
      set_username: { Args: { p_username: string }; Returns: Json };
      register_push_token: { Args: { p_token: string; p_platform?: string }; Returns: undefined };
      delete_me: { Args: Record<string, never>; Returns: undefined };
      run_sweep: { Args: Record<string, never>; Returns: number };
      is_anon: { Args: Record<string, never>; Returns: boolean };
      is_friend: { Args: { other: string }; Returns: boolean };
      in_room: { Args: { p_code: string }; Returns: boolean };
      score: { Args: { guess: number; price: number; k?: number }; Returns: number };
      grid_cell: { Args: { guess: number; price: number }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
