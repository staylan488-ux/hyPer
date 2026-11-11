import type { SpendBudget } from '../../supabase/functions/analyze-food-trial/gateway';

/**
 * In-memory stand-in for the daily AI budget (public.claim_ai_spend and
 * settle_ai_spend), in millionths of a dollar like the database: a claim
 * reserves its amount only while the day's committed total stays within the
 * budget, and settling replaces a reservation with the real cost, once.
 */
export function memoryBudget(budgetUsd = 5) {
  const micros = (usd: number) => Math.ceil(usd * 1_000_000);
  let budget = micros(budgetUsd);
  let enabled = true;
  const days = new Map<string, number>();
  const claims = new Map<string, { date: string; reserved: number; cost: number | null }>();
  const committedUsd = (date: string) => (days.get(date) ?? 0) / 1_000_000;
  const store: SpendBudget & {
    claims: typeof claims;
    committedUsd: typeof committedUsd;
    setEnabled(value: boolean): void;
    setBudget(usd: number): void;
  } = {
    claims,
    committedUsd,
    setEnabled(value) { enabled = value; },
    setBudget(usd) { budget = micros(usd); },
    async status(date) {
      return { enabled, budgetUsd: budget / 1_000_000, committedUsd: committedUsd(date) };
    },
    async claim({ key, date, reserveUsd }) {
      if (!enabled) return 'disabled';
      if (claims.has(key)) return 'duplicate';
      const reserved = micros(reserveUsd);
      const committed = days.get(date) ?? 0;
      if (committed + reserved > budget) return 'exhausted';
      claims.set(key, { date, reserved, cost: null });
      days.set(date, committed + reserved);
      return 'claimed';
    },
    async settle(key, costUsd) {
      const claim = claims.get(key);
      if (!claim || claim.cost !== null) return;
      claim.cost = micros(costUsd);
      days.set(claim.date, Math.max(0, (days.get(claim.date) ?? 0) - claim.reserved + claim.cost));
    },
  };
  return store;
}
