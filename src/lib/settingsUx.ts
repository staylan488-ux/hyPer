import { DEFAULT_MACRO_TARGET, type MacroTargetSource } from '@/types';

export interface SettingsDirtyState {
  name: boolean;
  targets: boolean;
  worker: boolean;
  meal: boolean;
  coach: boolean;
  weight: boolean;
}
/** Child setup/help flows retain drafts; abandoning their task asks first. */
export function shouldBlockSettingsExit(
  current: string,
  next: string,
  dirty: SettingsDirtyState,
): boolean {
  if (current === next) return false;
  if (!next.startsWith('/settings')) return Object.values(dirty).some(Boolean);
  if (dirty.name && current === '/settings/account' && next !== current) return true;
  if (dirty.meal && current === '/settings/meals' && next !== current) return true;
  if (dirty.worker && current === '/settings/analysis/worker' && next !== current) return true;
  const targetTask = (path: string) =>
    path.startsWith('/settings/targets') || path === '/settings/analysis/worker';
  if ((dirty.targets || dirty.coach) && targetTask(current) && !targetTask(next)) return true;
  if (dirty.weight) return true;
  return false;
}

export function targetModeLabel(
  source: MacroTargetSource | undefined,
  enabled: boolean | undefined,
): string {
  if (!source) return 'Not set';
  if (source === 'manual') return 'Set by hand';
  if (!enabled) return 'Calculated · not adapting';
  return source === 'adaptive' ? 'Adaptive' : 'Calculated · can adapt';
}

/** Cached targets stay visible while a refresh runs; editing still waits for 'ready'. */
export function targetSummaryLabel(
  loadState: 'loading' | 'ready' | 'error',
  cachedCalories: number | null,
  modeLabel: string,
): string {
  if (loadState === 'error') return 'Could not load targets';
  if (cachedCalories !== null) return `${cachedCalories.toLocaleString()} kcal · ${modeLabel}`;
  return loadState === 'loading' ? 'Loading targets…' : 'Starting defaults · not saved';
}

export type TargetNumbers = { calories: number; protein: number; carbs: number; fat: number };
export type TargetDraft = TargetNumbers & { source: MacroTargetSource };

/** The saved targets, or the starting defaults when none are saved yet. */
export function baseTargets(
  target: (Partial<TargetNumbers> & { source?: MacroTargetSource }) | null | undefined,
): TargetDraft {
  return {
    calories: target?.calories ?? DEFAULT_MACRO_TARGET.calories,
    protein: target?.protein ?? DEFAULT_MACRO_TARGET.protein,
    carbs: target?.carbs ?? DEFAULT_MACRO_TARGET.carbs,
    fat: target?.fat ?? DEFAULT_MACRO_TARGET.fat,
    source: target?.source ?? 'manual',
  };
}

export function targetsChanged(draft: TargetDraft, base: TargetDraft): boolean {
  return (
    draft.calories !== base.calories ||
    draft.protein !== base.protein ||
    draft.carbs !== base.carbs ||
    draft.fat !== base.fat ||
    draft.source !== base.source
  );
}

/** A hand edit makes the target manual, which keeps the adaptive loop off it. */
export function editTargetField(
  draft: TargetDraft,
  field: keyof TargetNumbers,
  raw: string,
): TargetDraft {
  return { ...draft, [field]: parseInt(raw, 10) || 0, source: 'manual' };
}

/** Carbs and fat; protein never moves when the calories do. */
export type FlexMacro = 'carbs' | 'fat';

/**
 * Carbs' share of the calories carbs and fat hold together, the split a
 * calorie change keeps. With neither set, the starting defaults' split.
 */
export function carbShare(target: Pick<TargetNumbers, 'carbs' | 'fat'>): number {
  const carbKcal = Math.max(0, target.carbs) * 4;
  const fatKcal = Math.max(0, target.fat) * 9;
  if (carbKcal + fatKcal > 0) return carbKcal / (carbKcal + fatKcal);
  return (DEFAULT_MACRO_TARGET.carbs * 4) / (DEFAULT_MACRO_TARGET.carbs * 4 + DEFAULT_MACRO_TARGET.fat * 9);
}

/**
 * After the calories change, carbs and fat fill what is left once protein is
 * counted, so the macros add up to the new calories. Protein stays put, and so
 * does a macro typed by hand (`typed`): with one typed the other takes the
 * whole change, with both typed nothing moves. Untyped, the two keep their
 * split (`share`, from `carbShare`), taken once so a calorie field typed digit
 * by digit (2, 28, 280, 2800) ends where 2800 typed at once would.
 */
export function rebalanceMacros(
  draft: TargetDraft,
  share: number,
  typed: Partial<Record<FlexMacro, boolean>>,
): TargetDraft {
  if (typed.carbs && typed.fat) return draft;
  const fixedKcal = draft.protein * 4 + (typed.carbs ? draft.carbs * 4 : 0) + (typed.fat ? draft.fat * 9 : 0);
  const left = Math.max(0, draft.calories - fixedKcal);
  if (typed.carbs) return { ...draft, fat: Math.round(left / 9) };
  if (typed.fat) return { ...draft, carbs: Math.round(left / 4) };
  const carbs = Math.round((left * share) / 4);
  return { ...draft, carbs, fat: Math.max(0, Math.round((left - carbs * 4) / 9)) };
}

/** What follows the calories in the edit sheet, or null when both are typed. */
export function followNote(typed: Partial<Record<FlexMacro, boolean>>): string | null {
  if (typed.carbs && typed.fat) return null;
  if (typed.carbs) return 'Fat follows your calories; protein and carbs stay put.';
  if (typed.fat) return 'Carbs follow your calories; protein and fat stay put.';
  return 'Carbs and fat follow your calories; protein stays put.';
}

/**
 * The calories the macros add up to, and how far the calorie target is from
 * them in percent. Over 5% the editor asks for a second look.
 */
export function targetDrift(draft: TargetNumbers): { kcalFromMacros: number; driftPct: number } {
  const kcalFromMacros = Math.round(draft.protein * 4 + draft.carbs * 4 + draft.fat * 9);
  const driftPct =
    draft.calories > 0 ? Math.round((Math.abs(draft.calories - kcalFromMacros) / draft.calories) * 100) : 0;
  return { kcalFromMacros, driftPct };
}

export const TARGET_DRIFT_WARNING_PCT = 5;

/** What the app believes about the person's daily burn, in plain words. */
export function expenditureSummary(profile: {
  expenditure_kcal: number | null;
  expenditure_confidence: 'predicted' | 'learning' | 'measured' | null;
} | null): { kcal: number | null; source: string; explanation: string } {
  const learned = profile?.expenditure_kcal ?? null;
  const confidence = profile?.expenditure_confidence ?? 'predicted';
  const source =
    confidence === 'measured'
      ? 'Inferred from logs and weight trend'
      : confidence === 'learning'
        ? 'Learning from your logs'
        : 'Estimated from your profile';
  if (learned == null || confidence === 'predicted') {
    return {
      kcal: null,
      source,
      explanation:
        'Not learned yet, so targets use an estimate from your profile. Log food and weigh in for about three weeks and your burn shows here.',
    };
  }
  return {
    kcal: Math.round(learned),
    source,
    explanation:
      confidence === 'measured'
        ? 'Inferred from your food logs and weight trend. Updates once a week.'
        : 'Learning from your logs and weight trend. It sharpens as more days come in.',
  };
}

/** After "Resume adaptive targets": the source is handed back whatever the recalculation did. */
export function resumeAdaptiveMessage(
  adaptiveEnabled: boolean | undefined,
  refresh: 'updated' | 'unchanged' | 'skipped' | 'failed',
): string {
  if (!adaptiveEnabled) return 'Target source saved. Complete nutrition setup to turn on adaptive targets.';
  return refresh === 'failed'
    ? 'Adaptive targets are on. They’ll update once the app can recalculate.'
    : 'Adaptive targets are on. They update as your logs and weigh-ins come in.';
}

/** The sign-out question, which says what an unsaved edit would lose. */
export function signOutQuestion(hasUnsavedEdits: boolean, profileAlreadySaved = false): string {
  if (!hasUnsavedEdits) return 'Sign out?';
  return `Sign out and discard unsaved edits?${profileAlreadySaved ? ' Already saved profile details and weight will be kept.' : ''}`;
}

/**
 * The fields of a target that the macro_targets table stores. A draft can
 * carry more (a coach suggestion's rationale and confidence); sending those
 * made every save of a suggestion fail (the owner hit it on 2026-10-28).
 */
export function macroTargetColumns(target: object): Partial<TargetDraft> {
  const values = target as Record<string, unknown>;
  const columns: Partial<TargetDraft> = {};
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) columns[key] = value;
  }
  const source = values.source;
  if (source === 'manual' || source === 'calculated' || source === 'adaptive') columns.source = source;
  return columns;
}
