// DEV-ONLY store seeder. Populates the Zustand stores with sample data and
// preserves illustrative volume totals while real program/workout actions use
// the in-memory client for fetch, edit, start and resume flows. Imports
// the stores (so it must NOT be imported by lib/supabase.ts — no cycle).
import { isPreviewActive } from './flag';
import { getPreviewUser } from './mockSupabase';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { getYouPreviewState } from './youFixtures';
import { applyTodayScenario, readTodayScenario } from './todayScenarios';
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
    user: getPreviewUser(),
    profile: { id: PREVIEW_USER_ID, display_name: 'Sam Rivera', created_at: new Date(0).toISOString() } as never,
    initialized: true,
  });

  const noop = async () => {};
  const todayScenario = readTodayScenario();
  const today = todayScenario ? applyTodayScenario(todayScenario) : null;

  useAppStore.setState({
    activeSplit: today?.noActiveSplit ? null : previewSplit,
    splits: today?.noActiveSplit ? [{ ...previewSplit, is_active: false }] : [previewSplit],
    currentWorkout: today?.dropCurrentWorkout ? null : previewCurrentWorkout,
    workoutMode: today?.workoutMode ?? 'split',
    currentWorkoutDayPlan: null,
    flexTemplates: [],
    macroTarget: getYouPreviewState() === 'empty' ? null : previewMacroTarget,
    volumeLandmarks: previewLandmarks,
    weeklyVolume: previewWeeklyVolume,
    // Keep illustrative volume totals. Nutrition, workout and program reads
    // use the real store actions so saved edits survive route remounts.
    fetchVolumeLandmarks: noop,
    calculateWeeklyVolume: noop,

  });
}
