// DEV-ONLY store seeder. Populates the Zustand stores with sample data and
// neutralises the on-mount fetch actions so the seed isn't clobbered. Imports
// the stores (so it must NOT be imported by lib/supabase.ts — no cycle).
import { isPreviewActive } from './flag';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import {
  PREVIEW_USER_ID,
  previewSplit,
  previewCurrentWorkout,
  previewMacroTarget,
  previewLandmarks,
  previewWeeklyVolume,
  previewHistoryWorkouts,
} from './previewData';
import type { Workout } from '@/types';

let seeded = false;

export function maybeSeedPreview(): void {
  if (!isPreviewActive() || seeded) return;
  seeded = true;

  useAuthStore.setState({
    // minimal stand-in for a Supabase User / profile
    user: { id: PREVIEW_USER_ID, email: 'preview@hyper.app' } as never,
    profile: { id: PREVIEW_USER_ID, display_name: 'Sam Rivera', created_at: new Date(0).toISOString() } as never,
    initialized: true,
  });

  const noop = async () => {};
  const allWorkouts = [previewCurrentWorkout, ...previewHistoryWorkouts];

  useAppStore.setState({
    activeSplit: previewSplit,
    splits: [previewSplit],
    currentWorkout: previewCurrentWorkout,
    workoutMode: 'split',
    currentWorkoutDayPlan: null,
    flexTemplates: [],
    macroTarget: previewMacroTarget,
    volumeLandmarks: previewLandmarks,
    weeklyVolume: previewWeeklyVolume,
    loading: false,
    // neutralise reads that run on screen mount so they can't overwrite the seed
    fetchSplits: noop,
    fetchCurrentWorkout: noop,
    fetchWorkoutMode: noop,
    fetchMacroTarget: noop,
    fetchVolumeLandmarks: noop,
    calculateWeeklyVolume: noop,
    fetchFlexTemplates: noop,
    fetchCurrentWorkoutDayPlan: noop,
    fetchWorkoutsByMonth: async () => previewHistoryWorkouts,
    fetchWorkoutById: async (id: string): Promise<Workout | null> => allWorkouts.find((w) => w.id === id) ?? null,
    fetchWorkoutDayPlanByWorkoutId: async () => null,
    ensureWorkoutDayPlan: async () => null,
  });
}
