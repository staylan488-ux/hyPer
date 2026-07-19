import type { NutritionGroup } from '@/types';

export type NutritionGroupDestination = Pick<NutritionGroup, 'kind' | 'label'> & {
  ordinal?: number;
};

export const DEFAULT_NAMED_MEALS = ['breakfast', 'lunch', 'dinner'] as const;

const NAMED_MEAL_TIME_MINUTES: Record<(typeof DEFAULT_NAMED_MEALS)[number], number> = {
  breakfast: 8 * 60,
  lunch: 12 * 60,
  dinner: 18 * 60,
};

export function sortNutritionGroups(groups: NutritionGroup[]): NutritionGroup[] {
  return [...groups].sort((a, b) => a.sort_order - b.sort_order || a.created_at?.localeCompare(b.created_at || '') || 0);
}

const NAMED_MEAL_ORDER: Record<NonNullable<NutritionGroup['label']>, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
};

export function missingDefaultNamedMeals(groups: NutritionGroup[]): Array<(typeof DEFAULT_NAMED_MEALS)[number]> {
  const existing = new Set(groups.map((group) => group.label).filter(Boolean));
  return DEFAULT_NAMED_MEALS.filter((label) => !existing.has(label));
}

/** Insert a new free-form meal or snack beside the next named meal anchor. */
export function insertNutritionGroupByTime(
  groups: NutritionGroup[],
  newGroup: NutritionGroup,
  at: Date = new Date(),
): NutritionGroup[] {
  const ordered = sortNutritionGroups(groups).filter((group) => group.id !== newGroup.id);
  const minutes = at.getHours() * 60 + at.getMinutes();
  const insertionIndex = ordered.findIndex((group) => (
    group.label !== null && NAMED_MEAL_TIME_MINUTES[group.label] > minutes
  ));
  const target = insertionIndex < 0 ? ordered.length : insertionIndex;

  return [
    ...ordered.slice(0, target),
    newGroup,
    ...ordered.slice(target),
  ].map((group, sortOrder) => ({ ...group, sort_order: sortOrder }));
}

export function hasValidNamedMealOrder(groups: NutritionGroup[]): boolean {
  let lastNamedMealOrder = -1;

  for (const group of sortNutritionGroups(groups)) {
    if (!group.label) continue;
    const nextNamedMealOrder = NAMED_MEAL_ORDER[group.label];
    if (nextNamedMealOrder < lastNamedMealOrder) return false;
    lastNamedMealOrder = nextNamedMealOrder;
  }

  return true;
}

export function normalizeNutritionGroupOrder(groups: NutritionGroup[]): NutritionGroup[] {
  const ordered = sortNutritionGroups(groups);
  const namedMeals = ordered
    .filter((group) => group.label)
    .sort((a, b) => NAMED_MEAL_ORDER[a.label!] - NAMED_MEAL_ORDER[b.label!]);
  let namedIndex = 0;

  return ordered.map((group, sortOrder) => ({
    ...(group.label ? namedMeals[namedIndex++] : group),
    sort_order: sortOrder,
  }));
}

export function moveNutritionGroup(
  groups: NutritionGroup[],
  groupId: string,
  direction: -1 | 1,
): NutritionGroup[] | null {
  const ordered = sortNutritionGroups(groups);
  const currentIndex = ordered.findIndex((group) => group.id === groupId);
  const destinationIndex = currentIndex + direction;
  if (currentIndex < 0 || destinationIndex < 0 || destinationIndex >= ordered.length) return null;

  const moved = [...ordered];
  [moved[currentIndex], moved[destinationIndex]] = [moved[destinationIndex], moved[currentIndex]];
  const normalized = moved.map((group, sortOrder) => ({ ...group, sort_order: sortOrder }));

  return hasValidNamedMealOrder(normalized) ? normalized : null;
}

export function nutritionGroupLabel(group: NutritionGroup, groups: NutritionGroup[]): string {
  if (group.label) return group.label.charAt(0).toUpperCase() + group.label.slice(1);

  const orderedSameKind = sortNutritionGroups(groups).filter((candidate) => candidate.kind === group.kind);
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
