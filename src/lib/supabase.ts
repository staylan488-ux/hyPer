import { createClient } from '@supabase/supabase-js'
import { isPreviewActive } from '@/preview/flag'
import { createMockClient } from '@/preview/mockSupabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// DEV-ONLY: on /preview, swap in an in-memory mock so the signed-in app is
// browsable without a backend. Production always uses the real client.
const preview = isPreviewActive()

if (!preview && (!supabaseUrl || !supabaseAnonKey)) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = preview
  ? createMockClient()
  : createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })

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
      profiles: {
        Row: {
          id: string
          display_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          created_at?: string
        }
      }
      exercises: {
        Row: {
          id: string
          name: string
          muscle_group: string
          muscle_group_secondary: string | null
          equipment: string | null
          is_compound: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          muscle_group: string
          muscle_group_secondary?: string | null
          equipment?: string | null
          is_compound?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          muscle_group?: string
          muscle_group_secondary?: string | null
          equipment?: string | null
          is_compound?: boolean
          created_at?: string
        }
      }
      splits: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          days_per_week: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          days_per_week: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          days_per_week?: number
          is_active?: boolean
          created_at?: string
        }
      }
      split_days: {
        Row: {
          id: string
          split_id: string
          day_name: string
          day_order: number
          created_at: string
        }
        Insert: {
          id?: string
          split_id: string
          day_name: string
          day_order: number
          created_at?: string
        }
        Update: {
          id?: string
          split_id?: string
          day_name?: string
          day_order?: number
          created_at?: string
        }
      }
      split_exercises: {
        Row: {
          id: string
          split_day_id: string
          exercise_id: string
          target_sets: number
          target_reps_min: number
          target_reps_max: number
          exercise_order: number
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          split_day_id: string
          exercise_id: string
          target_sets: number
          target_reps_min: number
          target_reps_max: number
          exercise_order: number
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          split_day_id?: string
          exercise_id?: string
          target_sets?: number
          target_reps_min?: number
          target_reps_max?: number
          exercise_order?: number
          notes?: string | null
          created_at?: string
        }
      }
      workouts: {
        Row: {
          id: string
          user_id: string
          split_day_id: string | null
          date: string
          notes: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          split_day_id?: string | null
          date: string
          notes?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          split_day_id?: string | null
          date?: string
          notes?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
        }
      }
      sets: {
        Row: {
          id: string
          workout_id: string
          exercise_id: string
          set_number: number
          weight: number | null
          reps: number | null
          rpe: number | null
          completed: boolean
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workout_id: string
          exercise_id: string
          set_number: number
          weight?: number | null
          reps?: number | null
          rpe?: number | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workout_id?: string
          exercise_id?: string
          set_number?: number
          weight?: number | null
          reps?: number | null
          rpe?: number | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
        }
      }
      activity_sessions: {
        Row: {
          id: string
          user_id: string
          activity_type: string
          title: string | null
          date: string
          started_at: string | null
          ended_at: string | null
          duration_seconds: number | null
          source: string
          notes: string | null
          strain: number | null
          avg_hr: number | null
          max_hr: number | null
          energy_kcal: number | null
          distance_m: number | null
          auto_grouped: boolean
          user_edited: boolean
          dismissed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          activity_type: string
          title?: string | null
          date: string
          started_at?: string | null
          ended_at?: string | null
          duration_seconds?: number | null
          source?: string
          notes?: string | null
          strain?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          energy_kcal?: number | null
          distance_m?: number | null
          auto_grouped?: boolean
          user_edited?: boolean
          dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          activity_type?: string
          title?: string | null
          date?: string
          started_at?: string | null
          ended_at?: string | null
          duration_seconds?: number | null
          source?: string
          notes?: string | null
          strain?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          energy_kcal?: number | null
          distance_m?: number | null
          auto_grouped?: boolean
          user_edited?: boolean
          dismissed_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      whoop_connections: {
        Row: {
          user_id: string
          whoop_user_id: string | null
          scopes: string | null
          connected_at: string
          last_synced_at: string | null
          last_sync_status: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          whoop_user_id?: string | null
          scopes?: string | null
          connected_at?: string
          last_synced_at?: string | null
          last_sync_status?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          whoop_user_id?: string | null
          scopes?: string | null
          connected_at?: string
          last_synced_at?: string | null
          last_sync_status?: string | null
          updated_at?: string
        }
      }
      strava_connections: {
        Row: {
          user_id: string
          strava_athlete_id: string | null
          scopes: string | null
          connected_at: string
          last_synced_at: string | null
          last_sync_status: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          strava_athlete_id?: string | null
          scopes?: string | null
          connected_at?: string
          last_synced_at?: string | null
          last_sync_status?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          strava_athlete_id?: string | null
          scopes?: string | null
          connected_at?: string
          last_synced_at?: string | null
          last_sync_status?: string | null
          updated_at?: string
        }
      }
      activity_segments: {
        Row: {
          id: string
          user_id: string
          session_id: string | null
          source: string
          external_id: string
          sport: string | null
          started_at: string
          ended_at: string
          duration_seconds: number | null
          strain: number | null
          avg_hr: number | null
          max_hr: number | null
          energy_kcal: number | null
          distance_m: number | null
          raw: Record<string, unknown> | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          session_id?: string | null
          source: string
          external_id: string
          sport?: string | null
          started_at: string
          ended_at: string
          duration_seconds?: number | null
          strain?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          energy_kcal?: number | null
          distance_m?: number | null
          raw?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          session_id?: string | null
          source?: string
          external_id?: string
          sport?: string | null
          started_at?: string
          ended_at?: string
          duration_seconds?: number | null
          strain?: number | null
          avg_hr?: number | null
          max_hr?: number | null
          energy_kcal?: number | null
          distance_m?: number | null
          raw?: Record<string, unknown> | null
          created_at?: string
          updated_at?: string
        }
      }
      foods: {
        Row: {
          id: string
          user_id: string | null
          name: string
          calories: number
          protein: number
          carbs: number
          fat: number
          serving_size: number
          serving_unit: string
          source: string
          fdc_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          name: string
          calories: number
          protein: number
          carbs: number
          fat: number
          serving_size: number
          serving_unit: string
          source?: string
          fdc_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          name?: string
          calories?: number
          protein?: number
          carbs?: number
          fat?: number
          serving_size?: number
          serving_unit?: string
          source?: string
          fdc_id?: string | null
          created_at?: string
        }
      }
      nutrition_logs: {
        Row: {
          id: string
          user_id: string
          date: string
          food_id: string
          servings: number
          meal_type: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          food_id: string
          servings: number
          meal_type?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          food_id?: string
          servings?: number
          meal_type?: string
          created_at?: string
        }
      }
      macro_targets: {
        Row: {
          id: string
          user_id: string
          calories: number
          protein: number
          carbs: number
          fat: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          calories: number
          protein: number
          carbs: number
          fat: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          calories?: number
          protein?: number
          carbs?: number
          fat?: number
          created_at?: string
        }
      }
      volume_landmarks: {
        Row: {
          id: string
          user_id: string
          muscle_group: string
          mv: number
          mev: number
          mav_low: number
          mav_high: number
          mrv: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          muscle_group: string
          mv?: number
          mev?: number
          mav_low?: number
          mav_high?: number
          mrv?: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          muscle_group?: string
          mv?: number
          mev?: number
          mav_low?: number
          mav_high?: number
          mrv?: number
          created_at?: string
        }
      }
      exercise_rest_preferences: {
        Row: {
          id: string
          user_id: string
          exercise_id: string
          rest_seconds: number
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          exercise_id: string
          rest_seconds: number
          updated_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          exercise_id?: string
          rest_seconds?: number
          updated_at?: string
          created_at?: string
        }
      }
    }
  }
}
