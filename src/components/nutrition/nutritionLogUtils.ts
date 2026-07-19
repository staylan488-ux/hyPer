export interface NutritionLogDateLike {
  logged_at: string | null;
  created_at?: string | null;
  date: string;
}

export interface NutritionLogCaloriesLike {
  servings: number;
  food: {
    calories: number;
  } | null;
}

export function getLogTimestamp(log: NutritionLogDateLike): number {
  if (log.logged_at) return new Date(log.logged_at).getTime();
  if (log.created_at) return new Date(log.created_at).getTime();
  return new Date(`${log.date}T12:00:00`).getTime();
}

export function getLogDate(log: NutritionLogDateLike): Date {
  if (log.logged_at) return new Date(log.logged_at);
  if (log.created_at) return new Date(log.created_at);
  return new Date(`${log.date}T12:00:00`);
}

export function sumNutritionLogCalories(logs: NutritionLogCaloriesLike[]): number {
  return logs.reduce((total, log) => {
    const calories = Number(log.food?.calories);
    const servings = Number(log.servings);
    if (!Number.isFinite(calories) || !Number.isFinite(servings)) return total;
    return total + calories * servings;
  }, 0);
}
