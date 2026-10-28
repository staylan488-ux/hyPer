/**
 * How Program describes programs and quick starts, shared by the web Program
 * page and the native app.
 */
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import type { FlexDayTemplate, FlexiblePlanItem, Split, SplitExercise } from '@/types';

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function exerciseTotal(split: Pick<Split, 'days'>): number {
  return split.days.reduce((sum, day) => sum + (day.exercises?.length || 0), 0);
}

/** The program Program shows as active: none in flexible mode, which leaves `is_active` as it is. */
export function shownActiveProgram<T extends Pick<Split, 'is_active'>>(splits: readonly T[], mode: 'split' | 'flexible'): T | null {
  if (mode === 'flexible') return null;
  return splits.find((split) => split.is_active) ?? null;
}

/** "3×8–12", or "2–4×8–12" when the program keeps a set range. */
export function setRepLabel(exercise: Pick<SplitExercise, 'notes' | 'target_sets' | 'target_reps_min' | 'target_reps_max'>): string {
  const range = parseSetRangeNotes(exercise.notes, exercise.target_sets);
  const sets = range.minSets === range.maxSets ? `${range.targetSets}` : `${range.minSets}–${range.maxSets}`;
  return `${sets}×${exercise.target_reps_min}–${exercise.target_reps_max}`;
}

/** A quick start's movements, without the ones a session hid. */
export function visibleTemplateItems(template: Pick<FlexDayTemplate, 'items'>): FlexiblePlanItem[] {
  return template.items.filter((item) => !item.hidden);
}

/** "3×8–12" for a quick-start movement, with "—" for a missing number. */
export function templateItemLabel(item: Pick<FlexiblePlanItem, 'target_sets' | 'target_reps_min' | 'target_reps_max'>): string {
  const reps = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
    ? `${item.target_reps_min}–${item.target_reps_max}`
    : '—';
  const sets = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';
  return `${sets}×${reps}`;
}

export type RenameTemplateResult = { ok: boolean; conflictLabel?: string; reason?: string };

/**
 * Renames a quick start. A name that clashes with another one (ignoring case)
 * asks before overwriting it. Resolves to an error message to show, or null
 * when renamed or when the person kept the other quick start.
 */
export async function renameTemplateWithConfirm({
  rename,
  confirmOverwrite,
  templateId,
  label,
}: {
  rename: (templateId: string, label: string, allowOverwrite?: boolean) => Promise<RenameTemplateResult>;
  confirmOverwrite: (conflictLabel: string) => Promise<boolean> | boolean;
  templateId: string;
  label: string;
}): Promise<string | null> {
  const trimmed = label.trim();
  if (!trimmed) return 'Template label is required.';
  const result = await rename(templateId, trimmed, false);
  if (!result.ok && result.conflictLabel) {
    if (!(await confirmOverwrite(result.conflictLabel))) return null;
    const overwrite = await rename(templateId, trimmed, true);
    return overwrite.ok ? null : overwrite.reason ?? 'Could not rename template.';
  }
  return result.ok ? null : result.reason ?? 'Could not rename template.';
}
