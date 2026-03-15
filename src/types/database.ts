export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          username: string
          email: string
          avatar_url: string | null
          total_points: number
          created_at: string
        }
        Insert: {
          id: string
          username: string
          email: string
          avatar_url?: string | null
          total_points?: number
          created_at?: string
        }
        Update: {
          username?: string
          email?: string
          avatar_url?: string | null
          total_points?: number
        }
      }
      tournaments: {
        Row: {
          id: string
          external_id: string
          name: string
          tour: 'ATP' | 'WTA'
          category: 'grand_slam' | 'masters_1000' | '500' | '250'
          surface: 'hard' | 'clay' | 'grass' | null
          draw_close_at: string | null
          starts_at: string | null
          ends_at: string | null
          status: 'upcoming' | 'accepting_predictions' | 'in_progress' | 'completed'
        }
        Insert: {
          id?: string
          external_id: string
          name: string
          tour: 'ATP' | 'WTA'
          category: 'grand_slam' | 'masters_1000' | '500' | '250'
          surface?: 'hard' | 'clay' | 'grass' | null
          draw_close_at?: string | null
          starts_at?: string | null
          ends_at?: string | null
          status?: 'upcoming' | 'accepting_predictions' | 'in_progress' | 'completed'
        }
        Update: {
          name?: string
          surface?: 'hard' | 'clay' | 'grass' | null
          draw_close_at?: string | null
          starts_at?: string | null
          ends_at?: string | null
          status?: 'upcoming' | 'accepting_predictions' | 'in_progress' | 'completed'
        }
      }
      predictions: {
        Row: {
          id: string
          user_id: string
          tournament_id: string
          picks: Json
          is_locked: boolean
          points_earned: number
          submitted_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tournament_id: string
          picks?: Json
          is_locked?: boolean
          points_earned?: number
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          picks?: Json
          is_locked?: boolean
          points_earned?: number
          updated_at?: string
        }
      }
      match_results: {
        Row: {
          id: string
          tournament_id: string
          external_match_id: string
          round: string
          winner_external_id: string
          loser_external_id: string
          score: string | null
          played_at: string | null
        }
        Insert: {
          id?: string
          tournament_id: string
          external_match_id: string
          round: string
          winner_external_id: string
          loser_external_id: string
          score?: string | null
          played_at?: string | null
        }
        Update: {
          score?: string | null
          played_at?: string | null
        }
      }
      point_ledger: {
        Row: {
          id: string
          user_id: string
          tournament_id: string
          match_result_id: string
          round: string
          points: number
          awarded_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tournament_id: string
          match_result_id: string
          round: string
          points: number
          awarded_at?: string
        }
        Update: never
      }
      leagues: {
        Row: {
          id: string
          owner_id: string
          name: string
          description: string | null
          invite_code: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          description?: string | null
          invite_code?: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          is_active?: boolean
        }
      }
      league_members: {
        Row: {
          league_id: string
          user_id: string
          total_points: number
          joined_at: string
        }
        Insert: {
          league_id: string
          user_id: string
          total_points?: number
          joined_at?: string
        }
        Update: {
          total_points?: number
        }
      }
      challenges: {
        Row: {
          id: string
          league_id: string | null
          challenger_id: string
          opponent_id: string
          tournament_id: string | null
          status: 'pending' | 'accepted' | 'declined' | 'completed'
          created_at: string
        }
        Insert: {
          id?: string
          league_id?: string | null
          challenger_id: string
          opponent_id: string
          tournament_id?: string | null
          status?: 'pending' | 'accepted' | 'declined' | 'completed'
          created_at?: string
        }
        Update: {
          status?: 'pending' | 'accepted' | 'declined' | 'completed'
        }
      }
    }
  }
}
