import { trialFoodTotals, type TrialFoodItem } from '@/lib/foodTrial';

export function isValidTrialReview(items: TrialFoodItem[], editingEntry = false): boolean {
  return items.length > 0 && (!editingEntry || items.length === 1) && items.every((item) =>
    item.name.trim() && item.unit.trim()
    && Number.isFinite(item.quantity) && item.quantity > 0
    && Number.isFinite(item.basisQuantity) && item.basisQuantity > 0
    && [item.calories, item.protein, item.carbs, item.fat].every((value) => Number.isFinite(value) && value >= 0)
    && Object.values(trialFoodTotals(item)).every(Number.isFinite));
}

export function buildClarifiedMealHint(hint: string, question: string, answer: string): string {
  const combined = [hint.trim(), question.trim() ? `Question: ${question.trim()}` : '', answer.trim() ? `Answer: ${answer.trim()}` : 'Photo selection updated for clarification.'].filter(Boolean).join('\n');
  if (combined.length > 1500) throw new Error('This description is too long. Choose Change meal to shorten it before adding the missing detail.');
  return combined;
}
