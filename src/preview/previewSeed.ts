// DEV-ONLY store seeder. Populates the Zustand stores with sample data and
// preserves illustrative volume totals while real program/workout actions use
// the in-memory client for fetch, edit, start and resume flows. Imports
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
} from './previewData';

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
    // Keep the illustrative nutrition/volume totals. Workout and program reads
    // use the real store actions against the relational in-memory client.
    fetchMacroTarget: noop,
    fetchVolumeLandmarks: noop,
    calculateWeeklyVolume: noop,

  });
}
