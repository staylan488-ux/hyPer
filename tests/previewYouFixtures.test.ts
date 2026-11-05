import { describe, expect, it } from 'vitest';
import { buildYouFixtures, youSavedMeals } from '@/preview/youFixtures';
import { PREVIEW_USER_ID } from '@/preview/previewData';

describe('You preview account states', () => {
  it('provides months of weight history, calculator inputs and a connected service', () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const tables = buildYouFixtures('populated', now);
    const weighIns = tables.body_weight_measurements;
    // Every day of the last two weeks, and months more for the full history.
    expect(new Set(weighIns.map((row) => row.measured_at)).size).toBe(weighIns.length);
    const times = weighIns.map((row) => Date.parse(String(row.measured_at))).sort((a, b) => b - a);
    const gaps = times.slice(1, 14).map((time, index) => Math.round((times[index] - time) / 86_400_000));
    expect(gaps).toEqual(Array(13).fill(1));
    expect((now.getTime() - times.at(-1)!) / 86_400_000).toBeGreaterThan(180);
    expect(tables.body_weight_measurements.every((row) => row.user_id === PREVIEW_USER_ID && Number(row.kilograms) > 0)).toBe(true);
    expect(tables.nutrition_profiles[0]).toMatchObject({ adaptive_enabled: false, unit_system: 'metric' });
    expect(tables.whoop_connections[0].last_synced_at).toBeTruthy();
    expect(youSavedMeals.every((meal) => meal.source === 'saved_meal' && meal.user_id === PREVIEW_USER_ID)).toBe(true);
  });

  it('leaves onboarding destinations empty and disconnected', () => {
    expect(buildYouFixtures('empty')).toEqual({
      macro_targets: [], nutrition_profiles: [], body_weight_measurements: [], whoop_connections: [],
    });
  });
});
