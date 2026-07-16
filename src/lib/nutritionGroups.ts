import type { NutritionGroup } from '@/types';

export type NutritionGroupDestination = Pick<NutritionGroup, 'kind' | 'label'> & {
  ordinal?: number;
};

export function sortNutritionGroups(groups: NutritionGroup[]): NutritionGroup[] {
  return [...groups].sort((a, b) => a.sort_order - b.sort_order || a.created_at?.localeCompare(b.created_at || '') || 0);
}
export function nutritionGroupLabel(group: NutritionGroup, groups: NutritionGroup[]): string {
  if (group.label) return group.label.charAt(0).toUpperCase() + group.label.slice(1);

  const orderedSameKind = sortNutritionGroups(groups).filter((candidate) => (
    candidate.kind === group.kind && candidate.label === null
  ));
  const ordinal = Math.max(1, orderedSameKind.findIndex((candidate) => candidate.id === group.id) + 1);
  return `${group.kind === 'snack' ? 'Snack' : 'Meal'} ${ordinal}`;
}

export function legacyMealTypeForGroup(group: NutritionGroup | null): 'breakfast' | 'lunch' | 'dinner' | 'snack' | null {
  if (!group) return null;
  if (group.label) return group.label;
  return group.kind === 'snack' ? 'snack' : null;
}

export function cronometerGroupDestination(rawGroup: string): NutritionGroupDestination | null {
  const normalized = rawGroup.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) return null;

  if (normalized === 'breakfast') return { kind: 'meal', label: 'breakfast' };
  if (normalized === 'lunch') return { kind: 'meal', label: 'lunch' };
  if (normalized === 'dinner' || normalized === 'supper') return { kind: 'meal', label: 'dinner' };

  const mealMatch = normalized.match(/^meal\s*(\d+)?$/);
  if (mealMatch) return { kind: 'meal', label: null, ordinal: Math.max(1, Number(mealMatch[1]) || 1) };

  const snackMatch = normalized.match(/^snacks?\s*(\d+)?$/);
  if (snackMatch) return { kind: 'snack', label: null, ordinal: Math.max(1, Number(snackMatch[1]) || 1) };

  return null;
}
