// Sample account states for the phone UX review. No provider credentials.
import { PREVIEW_USER_ID } from './previewData';

export type YouPreviewState = 'populated' | 'empty';

/** Days before today with a sample weigh-in, newest first. */
const SAMPLE_WEIGH_IN_DAYS = Array.from({ length: 210 }, (_, index) => index).filter(
  (index) => index < 14 || (index % 7 !== 3 && index % 7 !== 5 && (index < 100 || index >= 110)),
);

export function buildYouFixtures(state: YouPreviewState, now = new Date()): Record<string, Record<string, unknown>[]> {
  const stamp = (days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    date.setHours(8, 0, 0, 0);
    return date.toISOString();
  };
  if (state === 'empty') return {
    macro_targets: [], nutrition_profiles: [], body_weight_measurements: [], whoop_connections: [],
  };
  return {
    nutrition_profiles: [{
      user_id: PREVIEW_USER_ID, sex: 'male', birth_year: 1992, height_cm: 178,
      body_fat_pct: null, activity: 'moderately_active', goal: 'maintain', rate_pct_per_week: 0,
      unit_system: 'metric', adaptive_enabled: false, phase_started_on: stamp(30).slice(0, 10),
      expenditure_kcal: 2600, expenditure_confidence: 'learning', expenditure_updated_at: stamp(1),
      created_at: stamp(30), updated_at: stamp(1),
    }],
    // Seven months of a slow gain: every morning for the last two weeks, most
    // mornings before that, and ten days away in the middle.
    body_weight_measurements: SAMPLE_WEIGH_IN_DAYS.map((index) => ({
      id: `you-weight-${index}`, user_id: PREVIEW_USER_ID, source: 'manual',
      external_id: `you-weight-${index}`, measured_at: stamp(index),
      kilograms: Number((78.4 - index * 0.02 + [0, 0.2, -0.1, 0.1, -0.2, 0.3, -0.05][index % 7]).toFixed(1)),
      source_bundle: 'app.hyper', source_name: 'hyPer', created_at: stamp(index),
    })),
    whoop_connections: [{
      user_id: PREVIEW_USER_ID, whoop_user_id: 'preview-whoop', scopes: 'read:workout',
      connected_at: stamp(30), last_synced_at: stamp(0), last_sync_status: 'success', updated_at: stamp(0),
    }],
  };
}

export const youSavedMeals = [
  { id: 'you-meal-bowl', name: 'Chicken & rice bowl', calories: 560, protein: 48, carbs: 62, fat: 13 },
  { id: 'you-meal-oats', name: 'Overnight oats with berries', calories: 420, protein: 27, carbs: 56, fat: 10 },
].map((meal) => ({ ...meal, source: 'saved_meal', user_id: PREVIEW_USER_ID, serving_size: 1, serving_unit: 'meal', fdc_id: null }));
