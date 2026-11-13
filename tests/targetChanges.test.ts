import { describe, expect, it } from 'vitest';

import {
  burnProgressLine,
  describeTargetChange,
  normalizeTargetChange,
  shownTargetChange,
  targetForWeekBefore,
  type MacroTargetChange,
} from '@/lib/targetChanges';

// Monday 16 Nov 2026, local time.
const MONDAY = new Date(2026, 10, 16, 9, 0);

function change(overrides: Partial<MacroTargetChange> = {}): MacroTargetChange {
  return {
    id: 'change-1',
    user_id: 'user-1',
    changed_at: new Date(2026, 10, 16, 7, 0).toISOString(),
    old_calories: 2800,
    old_protein: 160,
    old_carbs: 350,
    old_fat: 80,
    new_calories: 2900,
    new_protein: 160,
    new_carbs: 375,
    new_fat: 80,
    expenditure_kcal: 2650,
    expenditure_confidence: 'measured',
    old_expenditure_kcal: 2550,
    // 0.2 lb and 0.5 lb a week.
    kg_per_week: 0.0907,
    goal_kg_per_week: 0.2268,
    mean_intake_kcal: 2700,
    logged_days: 18,
    weigh_in_days: 16,
    undone_at: null,
    ...overrides,
  };
}

const target = (values: { calories: number; protein: number; carbs: number; fat: number }, source: 'adaptive' | 'manual' | 'calculated' = 'adaptive') => ({ ...values, source });
const NEW = { calories: 2900, protein: 160, carbs: 375, fat: 80 };
const OLD = { calories: 2800, protein: 160, carbs: 350, fat: 80 };

describe('describeTargetChange', () => {
  const words = (overrides: Partial<MacroTargetChange>, unit: 'lb' | 'kg' = 'lb') =>
    describeTargetChange({ change: change(overrides), undone: false }, unit);

  it('says the move, and the weight behind it, in pounds', () => {
    expect(words({})).toEqual({
      title: 'Target up 100 kcal',
      line: 'Your three-week weight trend is up 0.2 lb a week and the goal is 0.5.',
    });
  });

  it('uses the person’s unit', () => {
    expect(words({}, 'kg').line).toBe('Your three-week weight trend is up 0.1 kg a week and the goal is 0.2.');
  });

  it('says a lower target plainly, when the weight ran ahead of the goal', () => {
    expect(words({ new_calories: 2700, new_carbs: 325, kg_per_week: 0.363 })).toEqual({
      title: 'Target down 100 kcal',
      line: 'Your three-week weight trend is up 0.8 lb a week and the goal is 0.5.',
    });
  });

  it('names the goal’s direction when the weight went the other way', () => {
    expect(words({ kg_per_week: -0.0907 }).line).toBe(
      'Your three-week weight trend is down 0.2 lb a week and the goal is to gain 0.5.',
    );
    expect(words({ new_calories: 2700, kg_per_week: 0.0907, goal_kg_per_week: -0.2268 }).line).toBe(
      'Your three-week weight trend is up 0.2 lb a week and the goal is to lose 0.5.',
    );
  });

  it('says when the weight held steady, and a maintenance goal', () => {
    expect(words({ kg_per_week: 0.01 }).line).toBe(
      'Your three-week weight trend is flat and the goal is to gain 0.5 lb a week.',
    );
    expect(words({ goal_kg_per_week: 0, kg_per_week: -0.0907 }).line).toBe(
      'Your three-week weight trend is down 0.2 lb a week and the goal is to hold steady.',
    );
  });

  it('never tells a weight story that contradicts the move', () => {
    // Gained more than a hold-steady goal, yet raised: the burn moved it.
    const raisedAhead = words({ kg_per_week: 0.0907, goal_kg_per_week: 0, expenditure_kcal: 2650, old_expenditure_kcal: 2550 });
    expect(raisedAhead).toEqual({ title: 'Target up 100 kcal', line: 'Your daily burn now reads 2,650 kcal, up from 2,550.' });
    // Right on the goal's pace: the weight alone doesn't explain it either.
    expect(words({ kg_per_week: 0.22, expenditure_kcal: 2650, old_expenditure_kcal: 2550 }).line).toBe(
      'Your daily burn now reads 2,650 kcal, up from 2,550.',
    );
    // Lowered while behind a gain goal: the burn fell.
    expect(words({ new_calories: 2700, kg_per_week: 0, expenditure_kcal: 2500, old_expenditure_kcal: 2600 }).line).toBe(
      'Your daily burn now reads 2,500 kcal, down from 2,600.',
    );
  });

  it('falls back to the burn when the weight change is unknown', () => {
    expect(words({ kg_per_week: null, old_expenditure_kcal: null }).line).toBe('Your daily burn now reads about 2,650 kcal.');
    expect(words({ kg_per_week: null, old_expenditure_kcal: 2550 }).line).toBe('Your daily burn now reads 2,650 kcal, up from 2,550.');
  });

  it('never names a burn that moved the other way', () => {
    expect(words({ kg_per_week: 0.3, expenditure_kcal: 2500, old_expenditure_kcal: 2550 }).line).toBe(
      'Recalculated from your latest weight and food logs.',
    );
  });

  it('says when only the macros changed', () => {
    expect(words({ new_calories: 2800, new_protein: 165, new_carbs: 345, old_expenditure_kcal: 2650 })).toEqual({
      title: 'Macros adjusted',
      line: 'Recalculated from your latest weight and food logs.',
    });
  });

  it('says the previous target is back after Undo', () => {
    expect(describeTargetChange({ change: change({ undone_at: MONDAY.toISOString() }), undone: true }, 'lb')).toEqual({
      title: 'Change undone',
      line: 'Your previous target stays until next Monday’s update.',
    });
  });

  it('never uses warning words for a raise', () => {
    const { title, line } = words({ new_calories: 3400 });
    expect(`${title} ${line}`).not.toMatch(/over (target|limit)|too (much|high)|warning|careful|exceed/i);
  });
});

describe('shownTargetChange', () => {
  it('shows a change from this week that is still in force', () => {
    expect(shownTargetChange(change(), target(NEW), MONDAY)).toEqual({ change: change(), undone: false });
  });

  it('hides a change from before this week’s Monday', () => {
    const sunday = change({ changed_at: new Date(2026, 10, 15, 23, 0).toISOString() });
    expect(shownTargetChange(sunday, target(NEW), MONDAY)).toBeNull();
    // Shown through Sunday of its own week.
    expect(shownTargetChange(change(), target(NEW), new Date(2026, 10, 22, 22, 0))).not.toBeNull();
  });

  it('hides it once the target was typed by hand, is not adaptive, or moved on', () => {
    expect(shownTargetChange(change(), target(NEW, 'manual'), MONDAY)).toBeNull();
    expect(shownTargetChange(change(), target(NEW, 'calculated'), MONDAY)).toBeNull();
    expect(shownTargetChange(change(), { ...NEW, source: undefined }, MONDAY)).toBeNull();
    expect(shownTargetChange(change(), target({ ...NEW, calories: 3000 }), MONDAY)).toBeNull();
  });

  it('shows an undone change while its old target is in force', () => {
    const undone = change({ undone_at: MONDAY.toISOString() });
    expect(shownTargetChange(undone, target(OLD), MONDAY)).toEqual({ change: undone, undone: true });
    expect(shownTargetChange(undone, target(NEW), MONDAY)).toBeNull();
  });

  it('shows nothing without a change or a target', () => {
    expect(shownTargetChange(null, target(NEW), MONDAY)).toBeNull();
    expect(shownTargetChange(change(), null, MONDAY)).toBeNull();
  });
});

describe('targetForWeekBefore', () => {
  it('grades last week against the target a change this week replaced', () => {
    expect(targetForWeekBefore(change(), target(NEW), MONDAY)).toEqual(OLD);
    expect(targetForWeekBefore(change({ undone_at: MONDAY.toISOString() }), target(OLD), MONDAY)).toEqual(OLD);
  });

  it('uses the current target when nothing changed this week', () => {
    const lastWeek = change({ changed_at: new Date(2026, 10, 10, 7, 0).toISOString() });
    expect(targetForWeekBefore(lastWeek, target(NEW), MONDAY)).toEqual(target(NEW));
    expect(targetForWeekBefore(null, target(NEW), MONDAY)).toEqual(target(NEW));
    expect(targetForWeekBefore(null, null, MONDAY)).toBeNull();
  });
});

describe('normalizeTargetChange', () => {
  it('reads numeric columns that arrive as strings', () => {
    const row = normalizeTargetChange({ ...change(), kg_per_week: '0.091', goal_kg_per_week: '0.227', new_calories: '2900' });
    expect(row.kg_per_week).toBe(0.091);
    expect(row.new_calories).toBe(2900);
  });
});

describe('burnProgressLine', () => {
  it('says what is still needed, in one sentence', () => {
    expect(burnProgressLine({ loggedDays: 9, weighInDays: 6 })).toBe(
      'Log food on 5 more days and weigh in 4 more times, and your burn shows here.',
    );
  });

  it('leaves out a gate already met', () => {
    expect(burnProgressLine({ loggedDays: 5, weighInDays: 10 })).toBe('Log food on 9 more days and your burn shows here.');
    expect(burnProgressLine({ loggedDays: 17, weighInDays: 9 })).toBe('Weigh in 1 more time and your burn shows here.');
    expect(burnProgressLine({ loggedDays: 13, weighInDays: 12 })).toBe('Log food on 1 more day and your burn shows here.');
  });

  it('says nothing once both are met', () => {
    expect(burnProgressLine({ loggedDays: 14, weighInDays: 10 })).toBeNull();
  });
});
