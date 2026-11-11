import { describe, expect, it } from 'vitest';

import {
  burnProgressLine,
  describeTargetChange,
  normalizeTargetChange,
  shownTargetChange,
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
  it('says the new target, the move and why, in pounds', () => {
    expect(describeTargetChange({ change: change(), undone: false }, 'lb')).toEqual({
      title: 'Target now 2,900 kcal',
      line: 'Up 100. You gained 0.2 lb a week and the goal is 0.5.',
    });
  });

  it('uses the person’s unit', () => {
    expect(describeTargetChange({ change: change(), undone: false }, 'kg').line).toBe(
      'Up 100. You gained 0.1 kg a week and the goal is 0.2.',
    );
  });

  it('says a lower target plainly', () => {
    const lower = change({ new_calories: 2700, new_carbs: 325, kg_per_week: 0.363 });
    expect(describeTargetChange({ change: lower, undone: false }, 'lb')).toEqual({
      title: 'Target now 2,700 kcal',
      line: 'Down 100. You gained 0.8 lb a week and the goal is 0.5.',
    });
  });

  it('names the goal’s direction when the weight went the other way', () => {
    const lost = change({ kg_per_week: -0.0907 });
    expect(describeTargetChange({ change: lost, undone: false }, 'lb').line).toBe(
      'Up 100. You lost 0.2 lb a week and the goal is to gain 0.5.',
    );
    const cutting = change({ new_calories: 2700, kg_per_week: 0.0907, goal_kg_per_week: -0.2268 });
    expect(describeTargetChange({ change: cutting, undone: false }, 'lb').line).toBe(
      'Down 100. You gained 0.2 lb a week and the goal is to lose 0.5.',
    );
  });

  it('says when the weight held steady, and a maintenance goal', () => {
    const steady = change({ kg_per_week: 0.01 });
    expect(describeTargetChange({ change: steady, undone: false }, 'lb').line).toBe(
      'Up 100. Your weight held steady and the goal is to gain 0.5 lb a week.',
    );
    const maintain = change({ goal_kg_per_week: 0 });
    expect(describeTargetChange({ change: maintain, undone: false }, 'lb').line).toBe(
      'Up 100. You gained 0.2 lb a week and the goal is to hold steady.',
    );
  });

  it('falls back to the burn when the weight change is unknown', () => {
    expect(describeTargetChange({ change: change({ kg_per_week: null }), undone: false }, 'lb').line).toBe(
      'Up 100. Your daily burn is now about 2,650 kcal.',
    );
  });

  it('leaves out the move when only the macros changed', () => {
    const macrosOnly = change({ new_calories: 2800, new_protein: 165, new_carbs: 345 });
    expect(describeTargetChange({ change: macrosOnly, undone: false }, 'lb')).toEqual({
      title: 'Target now 2,800 kcal',
      line: 'You gained 0.2 lb a week and the goal is 0.5.',
    });
  });

  it('says the old target is back after Undo', () => {
    expect(describeTargetChange({ change: change({ undone_at: MONDAY.toISOString() }), undone: true }, 'lb')).toEqual({
      title: 'Target back to 2,800 kcal',
      line: 'Until next Monday’s update.',
    });
  });

  it('never uses warning words for a raise', () => {
    const { title, line } = describeTargetChange({ change: change({ new_calories: 3400 }), undone: false }, 'lb');
    expect(`${title} ${line}`).not.toMatch(/over|too|warning|careful|exceed/i);
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

  it('hides it once the target was typed by hand or moved on', () => {
    expect(shownTargetChange(change(), target(NEW, 'manual'), MONDAY)).toBeNull();
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

describe('normalizeTargetChange', () => {
  it('reads numeric columns that arrive as strings', () => {
    const row = normalizeTargetChange({ ...change(), kg_per_week: '0.091', goal_kg_per_week: '0.227', new_calories: '2900' });
    expect(row.kg_per_week).toBe(0.091);
    expect(row.new_calories).toBe(2900);
  });
});

describe('burnProgressLine', () => {
  it('counts toward the gates the estimate uses', () => {
    expect(burnProgressLine({ loggedDays: 9, weighInDays: 6 })).toBe(
      'Learning your burn: 9 of 14 logged days, 6 of 10 weigh-ins.',
    );
  });

  it('never counts past a gate', () => {
    expect(burnProgressLine({ loggedDays: 17, weighInDays: 4 })).toBe(
      'Learning your burn: 14 of 14 logged days, 4 of 10 weigh-ins.',
    );
  });
});
