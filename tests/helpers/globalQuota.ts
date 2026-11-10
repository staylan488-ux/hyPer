import type { GlobalQuota } from '../../supabase/functions/analyze-food-trial/gateway';

/** In-memory stand-in for public.ai_usage_daily + claim_ai_request (one counter per UTC date). */
export function memoryGlobalQuota(): GlobalQuota & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async used(date) { return counts.get(date) ?? 0; },
    async claim(date, max) {
      const used = counts.get(date) ?? 0;
      if (used >= max) return false;
      counts.set(date, used + 1);
      return true;
    },
  };
}
