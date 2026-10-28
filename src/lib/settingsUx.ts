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
  if (source === 'manual') return 'Manual';
  if (!enabled) return 'Calculated · automatic updates off';
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
        'Estimated from your profile. Food logs and regular weigh-ins help refine this estimate, often over about three weeks.',
    };
  }
  return {
    kcal: Math.round(learned),
    source,
    explanation:
      confidence === 'measured'
        ? 'Inferred from your food logs and weight trend. Updates weekly when enough data is available.'
        : 'Being learned from your logs and weight trend — it will keep sharpening as more days come in.',
  };
}

/** After "Resume adaptive targets": the source is handed back whatever the recalculation did. */
export function resumeAdaptiveMessage(
  adaptiveEnabled: boolean | undefined,
  refresh: 'updated' | 'unchanged' | 'skipped' | 'failed',
): string {
  if (!adaptiveEnabled) return 'Target source saved. Complete nutrition setup to enable automatic updates.';
  return refresh === 'failed'
    ? 'Automatic target management resumed, but recalculation could not run right now. It will retry automatically.'
    : 'Automatic target management resumed. Recalculation was requested; values may stay the same until enough data is available.';
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
