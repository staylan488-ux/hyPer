import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          split_day_id?: string | null
          date: string
          notes?: string | null
          completed?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          split_day_id?: string | null
          date?: string
          notes?: string | null
          completed?: boolean
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
    }
  }
}
