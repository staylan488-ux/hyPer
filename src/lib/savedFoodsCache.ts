import { useAuthStore } from '@/stores/authStore';
import type { Food } from '@/types';

// The last saved-food list the food logger fetched, kept outside the component
// so a remount (tab re-entry, each meal-builder ingredient) can show it at once
// while the usual refetch runs behind it. It is only a first paint: the logger
// always refetches, because Settings, the meal builder and imports change saved
// foods without telling it. Keyed by user so one account never sees another's.
let cache: { userId: string; foods: Food[] } | null = null;

export function readSavedFoodsCache(userId: string | null | undefined): Food[] | null {
  if (!cache) return null;
  if (!userId || cache.userId !== userId) {
    cache = null;
    return null;
  }
  return cache.foods;
}

export function writeSavedFoodsCache(userId: string, foods: Food[]) {
  cache = { userId, foods };
}

export function clearSavedFoodsCache() {
  cache = null;
}

// drop the list on sign-out or an account switch, not just on the next read
useAuthStore.subscribe((state) => {
  if (cache && state.user?.id !== cache.userId) cache = null;
});
