// Calorie target changes made by the adaptive loop: the record kept for each
// one (macro_target_changes), and the words the app says about it.
//
// The table is new. Until it exists on a backend, every read and write here
// fails, and the callers treat that as "no change to show": the app behaves
// exactly as it did before the table.

import { supabase } from './supabase';
import { startOfLocalWeek, MIN_LOGGED_DAYS, MIN_WEIGH_IN_DAYS } from './adaptiveExpenditure';
import { kgToUnit, type WeightUnit } from './weightDisplayCore';
import type { MacroTarget } from '@/types';

export type Macros = Pick<MacroTarget, 'calories' | 'protein' | 'carbs' | 'fat'>;

export interface MacroTargetChange {
  id: string;
  user_id: string;
  changed_at: string;
  old_calories: number;
  old_protein: number;
  old_carbs: number;
  old_fat: number;
  new_calories: number;
  new_protein: number;
  new_carbs: number;
  new_fat: number;
  /** The daily burn the new target was built on, and how sure the app is of it. */
  expenditure_kcal: number;
  expenditure_confidence: 'learning' | 'measured';
  /** Measured weight change, signed kg a week; null when there were too few weigh-ins. */
  kg_per_week: number | null;
  /** The goal's pace, signed kg a week; 0 for maintain. */
  goal_kg_per_week: number | null;
  mean_intake_kcal: number | null;
  logged_days: number;
  weigh_in_days: number;
  /** Set by Undo: the old target was put back until the next weekly update. */
  undone_at: string | null;
}

export type NewMacroTargetChange = Omit<MacroTargetChange, 'id' | 'undone_at'>;

const TABLE = 'macro_target_changes';

export function oldMacros(change: MacroTargetChange): Macros {
  return { calories: change.old_calories, protein: change.old_protein, carbs: change.old_carbs, fat: change.old_fat };
}

export function newMacros(change: MacroTargetChange): Macros {
  return { calories: change.new_calories, protein: change.new_protein, carbs: change.new_carbs, fat: change.new_fat };
}

export function sameMacros(a: Macros, b: Macros): boolean {
  return Number(a.calories) === Number(b.calories)
    && Number(a.protein) === Number(b.protein)
    && Number(a.carbs) === Number(b.carbs)
    && Number(a.fat) === Number(b.fat);
}

/** Numeric columns can come back from PostgREST as strings; coerce them once here. */
export function normalizeTargetChange(row: Record<string, unknown>): MacroTargetChange {
  const num = (value: unknown) => Number(value);
  const maybe = (value: unknown) => (value == null ? null : Number(value));
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    changed_at: String(row.changed_at),
    old_calories: num(row.old_calories),
    old_protein: num(row.old_protein),
    old_carbs: num(row.old_carbs),
    old_fat: num(row.old_fat),
    new_calories: num(row.new_calories),
    new_protein: num(row.new_protein),
    new_carbs: num(row.new_carbs),
    new_fat: num(row.new_fat),
    expenditure_kcal: num(row.expenditure_kcal),
    expenditure_confidence: row.expenditure_confidence === 'measured' ? 'measured' : 'learning',
    kg_per_week: maybe(row.kg_per_week),
    goal_kg_per_week: maybe(row.goal_kg_per_week),
    mean_intake_kcal: maybe(row.mean_intake_kcal),
    logged_days: num(row.logged_days),
    weigh_in_days: num(row.weigh_in_days),
    undone_at: (row.undone_at as string | null | undefined) ?? null,
  };
}

// ── Reads and writes ─────────────────────────────────────────────────────

/** The account's latest change, or null. Throws when the read fails (no table yet, offline). */
export async function readLatestTargetChange(userId: string): Promise<MacroTargetChange | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeTargetChange(data) : null;
}

/** Records one change and returns the stored row. Throws when the write fails. */
export async function recordTargetChange(change: NewMacroTargetChange): Promise<MacroTargetChange> {
  const { data, error } = await supabase.from(TABLE).insert(change).select().single();
  if (error) throw error;
  return normalizeTargetChange(data);
}

/** Marks a change undone. Throws when the write fails. */
export async function markTargetChangeUndone(change: MacroTargetChange, at: string): Promise<MacroTargetChange> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ undone_at: at })
    .eq('id', change.id)
    .eq('user_id', change.user_id)
    .select()
    .single();
  if (error) throw error;
  return normalizeTargetChange(data);
}

// ── What the screens show ────────────────────────────────────────────────

export type ShownTargetChange = { change: MacroTargetChange; undone: boolean };

/**
 * The change to show beside the target, if any: one made since this week's
 * Monday that is still in force (or, once undone, whose old target is). A
 * target typed by hand since then, or a newer target from anywhere, hides it.
 */
export function shownTargetChange(
  change: MacroTargetChange | null,
  target: (Macros & Pick<MacroTarget, 'source'>) | null,
  now: Date,
): ShownTargetChange | null {
  if (!change || !target || target.source === 'manual') return null;
  const at = Date.parse(change.changed_at);
  if (!Number.isFinite(at) || at < startOfLocalWeek(now).getTime()) return null;
  if (change.undone_at) return sameMacros(target, oldMacros(change)) ? { change, undone: true } : null;
  return sameMacros(target, newMacros(change)) ? { change, undone: false } : null;
}

const kcal = (value: number) => Math.round(value).toLocaleString('en-US');

/** One decimal in the person's unit; "0.0" for a change too small to show. */
function amount(kilograms: number, unit: WeightUnit): string {
  return Math.abs(kgToUnit(kilograms, unit)).toFixed(1);
}

/**
 * Why the target moved, in the person's unit: "You gained 0.2 lb a week and
 * the goal is 0.5." The goal's direction is named only when it differs from
 * the measured one. A raise is plain news, never a warning.
 */
function changeReason(change: MacroTargetChange, unit: WeightUnit): string {
  const measured = change.kg_per_week;
  if (measured == null || !Number.isFinite(measured)) {
    return `Your daily burn is now about ${kcal(change.expenditure_kcal)} kcal.`;
  }
  const goal = change.goal_kg_per_week ?? 0;
  const shown = amount(measured, unit);
  const steady = Number(shown) === 0;
  const goalShown = amount(goal, unit);
  const goalSteady = !Number.isFinite(goal) || Number(goalShown) === 0;
  const goalWords = goalSteady
    ? 'the goal is to hold steady'
    : !steady && Math.sign(goal) === Math.sign(measured)
      ? `the goal is ${goalShown}`
      : `the goal is to ${goal > 0 ? 'gain' : 'lose'} ${goalShown}${steady ? ` ${unit} a week` : ''}`;
  const weightWords = steady
    ? 'Your weight held steady'
    : `You ${measured > 0 ? 'gained' : 'lost'} ${shown} ${unit} a week`;
  return `${weightWords} and ${goalWords}.`;
}

/**
 * The change as one title and one quiet line: "Target now 2,900 kcal", "Up
 * 100. You gained 0.2 lb a week and the goal is 0.5." Once undone: "Target
 * back to 2,800 kcal", "Until next Monday's update."
 */
export function describeTargetChange(shown: ShownTargetChange, unit: WeightUnit): { title: string; line: string } {
  const { change } = shown;
  if (shown.undone) {
    return { title: `Target back to ${kcal(change.old_calories)} kcal`, line: 'Until next Monday’s update.' };
  }
  const delta = Math.round(change.new_calories - change.old_calories);
  const move = delta > 0 ? `Up ${kcal(delta)}. ` : delta < 0 ? `Down ${kcal(-delta)}. ` : '';
  return { title: `Target now ${kcal(change.new_calories)} kcal`, line: `${move}${changeReason(change, unit)}` };
}

/** How far the burn is from being learned, from the counts the estimate makes. */
export interface BurnProgress {
  loggedDays: number;
  weighInDays: number;
}

/** "Learning your burn: 9 of 14 logged days, 6 of 10 weigh-ins." */
export function burnProgressLine(progress: BurnProgress): string {
  const logged = Math.min(progress.loggedDays, MIN_LOGGED_DAYS);
  const weighIns = Math.min(progress.weighInDays, MIN_WEIGH_IN_DAYS);
  return `Learning your burn: ${logged} of ${MIN_LOGGED_DAYS} logged days, ${weighIns} of ${MIN_WEIGH_IN_DAYS} weigh-ins.`;
}
