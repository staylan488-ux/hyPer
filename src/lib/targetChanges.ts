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
  /** The burn the old target was built on (learned, or the profile's estimate); null when unknown. */
  old_expenditure_kcal: number | null;
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
    old_expenditure_kcal: maybe(row.old_expenditure_kcal),
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
 * Monday that is still in force (or, once undone, whose old target is). Only
 * an adaptive target qualifies, the kind the loop and Undo write: a target
 * typed by hand (or shown as one), or a newer target from anywhere, hides it.
 */
export function shownTargetChange(
  change: MacroTargetChange | null,
  target: (Macros & Pick<MacroTarget, 'source'>) | null,
  now: Date,
): ShownTargetChange | null {
  if (!change || !target || target.source !== 'adaptive') return null;
  const at = Date.parse(change.changed_at);
  if (!Number.isFinite(at) || at < startOfLocalWeek(now).getTime()) return null;
  if (change.undone_at) return sameMacros(target, oldMacros(change)) ? { change, undone: true } : null;
  return sameMacros(target, newMacros(change)) ? { change, undone: false } : null;
}

/**
 * The target that applied in the week before this one: the figures a change
 * made this week replaced, else the current target.
 */
export function targetForWeekBefore<T extends Macros>(change: MacroTargetChange | null, current: T | null, now: Date): Macros | null {
  if (!change) return current;
  const at = Date.parse(change.changed_at);
  return Number.isFinite(at) && at >= startOfLocalWeek(now).getTime() ? oldMacros(change) : current;
}

const kcal = (value: number) => Math.round(value).toLocaleString('en-US');

/** One decimal in the person's unit; "0.0" for a change too small to show. */
function amount(kilograms: number, unit: WeightUnit): string {
  return Math.abs(kgToUnit(kilograms, unit)).toFixed(1);
}

/** About 0.1 lb a week: closer than this to the goal's pace, the weight alone doesn't explain a change. */
const PACE_GAP_KG = 0.05;

/**
 * The weight story, when it explains the change: eating more because the
 * weight is behind the goal's pace, or less because it is ahead. "Over the
 * last few weeks your weight is up 0.2 lb a week and the goal is 0.5." It is
 * a smoothed trend over the estimate's three or four weeks, and says so,
 * since a single week's change can point the other way.
 */
function weightReason(change: MacroTargetChange, delta: number, unit: WeightUnit): string | null {
  const measured = change.kg_per_week;
  if (measured == null || !Number.isFinite(measured) || delta === 0) return null;
  const goal = Number.isFinite(change.goal_kg_per_week) ? change.goal_kg_per_week ?? 0 : 0;
  const gap = goal - measured;
  if (Math.abs(gap) < PACE_GAP_KG || Math.sign(gap) !== Math.sign(delta)) return null;

  const shown = amount(measured, unit);
  const steady = Number(shown) === 0;
  const goalShown = amount(goal, unit);
  const goalSteady = Number(goalShown) === 0;
  const goalWords = goalSteady
    ? 'the goal is to hold steady'
    : !steady && Math.sign(goal) === Math.sign(measured)
      ? `the goal is ${goalShown}`
      : `the goal is to ${goal > 0 ? 'gain' : 'lose'} ${goalShown}${steady ? ` ${unit} a week` : ''}`;
  const weightWords = steady
    ? 'Over the last few weeks your weight is flat'
    : `Over the last few weeks your weight is ${measured > 0 ? 'up' : 'down'} ${shown} ${unit} a week`;
  return `${weightWords} and ${goalWords}.`;
}

/**
 * Why the target moved. The weight story when it explains the move;
 * otherwise the burn, which is what moved the target: "Your daily burn now
 * reads 2,650 kcal, up from 2,550." A raise is plain news, never a warning.
 */
function changeReason(change: MacroTargetChange, delta: number, unit: WeightUnit): string {
  const byWeight = weightReason(change, delta, unit);
  if (byWeight) return byWeight;
  const burn = Math.round(change.expenditure_kcal);
  const before = change.old_expenditure_kcal == null ? null : Math.round(change.old_expenditure_kcal);
  if (before != null && burn !== before && Math.sign(burn - before) === Math.sign(delta)) {
    return `Your daily burn now reads ${kcal(burn)} kcal, ${burn > before ? 'up' : 'down'} from ${kcal(before)}.`;
  }
  if (before == null && delta !== 0) return `Your daily burn now reads about ${kcal(burn)} kcal.`;
  return 'Recalculated from your latest weight and food logs.';
}

/**
 * The change as one title and one quiet line, beside a screen that already
 * shows the new figure: "Target up 100 kcal", "Over the last few weeks your
 * weight is up 0.2 lb a week and the goal is 0.5." Once undone: "Change undone", "Your
 * previous target stays until next Monday's update."
 */
export function describeTargetChange(shown: ShownTargetChange, unit: WeightUnit): { title: string; line: string } {
  const { change } = shown;
  if (shown.undone) {
    return { title: 'Change undone', line: 'Your previous target stays until next Monday’s update.' };
  }
  const delta = Math.round(change.new_calories - change.old_calories);
  const title = delta > 0
    ? `Target up ${kcal(delta)} kcal`
    : delta < 0
      ? `Target down ${kcal(-delta)} kcal`
      : 'Macros adjusted';
  return { title, line: changeReason(change, delta, unit) };
}

/** How far the burn is from being learned, from the counts the estimate makes. */
export interface BurnProgress {
  loggedDays: number;
  weighInDays: number;
}

const times = (count: number, one: string, many: string) => `${count} more ${count === 1 ? one : many}`;

/**
 * What is still needed before the burn is learned, as one sentence, naming
 * only the gates not yet met: "Log food on 9 more days and weigh in 4 more
 * times, and your burn shows here." Null when both are met.
 */
export function burnProgressLine(progress: BurnProgress): string | null {
  const logs = Math.max(0, MIN_LOGGED_DAYS - progress.loggedDays);
  const weighIns = Math.max(0, MIN_WEIGH_IN_DAYS - progress.weighInDays);
  if (logs > 0 && weighIns > 0) {
    return `Log food on ${times(logs, 'day', 'days')} and weigh in ${times(weighIns, 'time', 'times')}, and your burn shows here.`;
  }
  if (logs > 0) return `Log food on ${times(logs, 'day', 'days')} and your burn shows here.`;
  if (weighIns > 0) return `Weigh in ${times(weighIns, 'time', 'times')} and your burn shows here.`;
  return null;
}
