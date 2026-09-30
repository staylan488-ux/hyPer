import { normalizeSetRange } from '@/lib/setRangeNotes';

// Commit maths for the typed set/rep cells in the program builder and
// editor. Drafts are the raw input strings; an empty or unparsable field
// falls back to the current value.

export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (value === '' || Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export interface SetRangeDraft {
  minSets: string;
  targetSets: string;
  maxSets: string;
}

export interface SetRangeValues {
  target_sets_min: number;
  target_sets: number;
  target_sets_max: number;
}

export function resolveSetRangeDraft(draft: SetRangeDraft, current: SetRangeValues): SetRangeValues {
  const normalized = normalizeSetRange(
    clampInt(draft.minSets, 1, 10, current.target_sets_min),
    clampInt(draft.targetSets, 1, 10, current.target_sets),
    clampInt(draft.maxSets, 1, 10, current.target_sets_max),
  );
  return {
    target_sets_min: normalized.minSets,
    target_sets: normalized.targetSets,
    target_sets_max: normalized.maxSets,
  };
}

export function resolveRepDraft(value: string, fallback: number): number {
  return clampInt(value, 1, 100, fallback);
}
