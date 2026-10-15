// DEV-ONLY: Today hero scenarios for the preview (/preview?today=planned …).
// Each one reshapes the in-memory tables before the stores are seeded, so the
// real Dashboard reads, schedule rules and capsule run unchanged.
import { format, subDays } from 'date-fns';
import { PREVIEW_USER_ID, previewTables } from './previewData';

export const TODAY_SCENARIOS = ['live', 'planned', 'rest', 'done', 'flexible', 'no-schedule', 'first-run'] as const;
export type TodayScenario = typeof TODAY_SCENARIOS[number];

const STORAGE_KEY = 'hyper-preview-today';

export function readTodayScenario(): TodayScenario | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const isScenario = (value: string | null): value is TodayScenario => TODAY_SCENARIOS.includes(value as TodayScenario);
  const requested = new URLSearchParams(window.location.search).get('today');
  try {
    if (isScenario(requested)) window.sessionStorage.setItem(STORAGE_KEY, requested);
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    return isScenario(saved) ? saved : null;
  } catch {
    return isScenario(requested) ? requested : null;
  }
}

/** Store fields the seeder should override for this scenario. */
export interface TodayScenarioSeed {
  dropCurrentWorkout: boolean;
  workoutMode?: 'split' | 'flexible';
  noActiveSplit?: boolean;
}

export function applyTodayScenario(scenario: TodayScenario, now = new Date()): TodayScenarioSeed {
  // The schedule comes from the table, never a cache left by an earlier run.
  try { window.localStorage.removeItem(`plan-schedule:${PREVIEW_USER_ID}:split1`); } catch { /* preview only */ }
  if (scenario === 'live') return { dropCurrentWorkout: false };

  previewTables.workouts = previewTables.workouts.filter((row) => row.id !== 'w_current');
  previewTables.sets = previewTables.sets.filter((row) => row.workout_id !== 'w_current');

  const today = now.getDay();
  const ymd = (date: Date) => format(date, 'yyyy-MM-dd');
  // Two weeks in ("week 3"); updated now so older sessions do not re-anchor it.
  const schedule = (weekdays: number[]) => ({
    user_id: PREVIEW_USER_ID,
    split_id: 'split1',
    start_date: ymd(subDays(now, 14)),
    mode: 'fixed',
    weekdays: weekdays.map((day) => day % 7),
    anchor_day: null,
    updated_at: now.toISOString(),
  });

  switch (scenario) {
    case 'planned':
      previewTables.plan_schedules = [schedule([today, today + 2, today + 4, today + 5])];
      return { dropCurrentWorkout: true };
    case 'rest':
      previewTables.plan_schedules = [schedule([today + 1, today + 3, today + 5, today + 6])];
      return { dropCurrentWorkout: true };
    case 'done': {
      previewTables.plan_schedules = [schedule([today, today + 2, today + 4, today + 5])];
      const started = new Date(now.getTime() - 90 * 60_000);
      const finished = new Date(now.getTime() - 30 * 60_000);
      previewTables.workouts.push({
        id: 'w_today_done', user_id: PREVIEW_USER_ID, split_day_id: 'd1', date: ymd(now), notes: null,
        completed: true, completed_at: finished.toISOString(), created_at: started.toISOString(),
      });
      ['ex_bench', 'ex_row'].forEach((exerciseId, index) => {
        for (let set = 1; set <= 3; set += 1) {
          previewTables.sets.push({
            id: `w_today_done_${exerciseId}_${set}`, workout_id: 'w_today_done', exercise_id: exerciseId, set_number: set,
            weight: index === 0 ? 100 : 80, reps: 8, rpe: 8, completed: true,
            completed_at: new Date(started.getTime() + (index * 3 + set) * 6 * 60_000).toISOString(), created_at: started.toISOString(),
          });
        }
      });
      return { dropCurrentWorkout: true };
    }
    case 'flexible':
      previewTables.program_preferences = [{ user_id: PREVIEW_USER_ID, workout_mode: 'flexible' }];
      return { dropCurrentWorkout: true, workoutMode: 'flexible' };
    case 'no-schedule':
      previewTables.plan_schedules = [];
      return { dropCurrentWorkout: true };
    case 'first-run':
      previewTables.splits = previewTables.splits.map((row) => ({ ...row, is_active: false }));
      return { dropCurrentWorkout: true, noActiveSplit: true };
  }
}
