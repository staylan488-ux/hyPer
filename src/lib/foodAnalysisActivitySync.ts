import type { AnalysisTrail } from '@/lib/analysisProgress';
import { trialFoodTotals, type FoodTrialResult } from '@/lib/foodTrial';
import { withTimeout } from '@/lib/withTimeout';

/**
 * The Gemini meal analysis Live Activity (lock screen and Dynamic Island),
 * kept in strict call order so rapid SSE step updates collapse cleanly and a
 * running step can never overwrite a finished estimate or run after end().
 */
export type FoodAnalysisActivityPhase = 'running' | 'ready' | 'clarify' | 'failed';

export interface FoodAnalysisActivityPayload {
  phase: FoodAnalysisActivityPhase;
  title: string;
  detail: string;
  startedAtEpochMs: number;
  calories?: number;
  itemCount?: number;
  /** When set on a finished outcome, iOS expands the Dynamic Island / alerts. */
  alertTitle?: string;
  alertBody?: string;
}

export interface FoodAnalysisActivityBridge {
  sync(payload: FoodAnalysisActivityPayload): Promise<void>;
  end(): Promise<void>;
}

export interface FoodAnalysisActivitySync {
  sync(payload: FoodAnalysisActivityPayload): void;
  end(): void;
}

const STEP_TIMEOUT_MS = 10_000;
const MAX_LABEL_CHARS = 52;

const whole = (value: number) => Math.round(value).toLocaleString('en-US');

/** Short label for the meal being analyzed when a step has no detail of its own. */
export function foodAnalysisMealLabel(hint: string, photoCount: number): string {
  const firstLine = hint
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    return firstLine.length > MAX_LABEL_CHARS
      ? `${firstLine.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`
      : firstLine;
  }
  if (photoCount === 1) return 'Meal photo';
  if (photoCount > 1) return `${photoCount} meal photos`;
  return 'Your meal';
}

/** Running Live Activity snapshot from the server's real AnalysisTrail (never invented steps). */
export function foodAnalysisRunningPayload(
  trail: AnalysisTrail,
  startedAtEpochMs: number,
  mealLabel: string,
): FoodAnalysisActivityPayload {
  const current = trail.lines.at(-1);
  return {
    phase: 'running',
    title: current?.now ?? 'Analyzing meal',
    detail: current?.detail ?? mealLabel,
    startedAtEpochMs,
  };
}

/** Settled Live Activity snapshot once an estimate with foods is ready. */
export function foodAnalysisReadyPayload(
  result: Pick<FoodTrialResult, 'items'>,
  startedAtEpochMs: number,
  alert: boolean,
): FoodAnalysisActivityPayload {
  const totals = result.items.reduce(
    (sum, item) => {
      const each = trialFoodTotals(item);
      return { calories: sum.calories + each.calories, protein: sum.protein + each.protein };
    },
    { calories: 0, protein: 0 },
  );
  const calories = Math.round(totals.calories);
  const protein = Math.round(totals.protein);
  const count = result.items.length;
  const lead = count === 1
    ? result.items[0].name.trim() || '1 food'
    : `${count} foods`;
  const detail = [
    lead,
    protein > 0 ? `${whole(protein)} g protein` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    phase: 'ready',
    title: 'Estimate ready',
    detail,
    startedAtEpochMs,
    calories,
    itemCount: count,
    ...(alert
      ? {
          alertTitle: 'Estimate ready',
          alertBody: `${whole(calories)} kcal · ${detail}`,
        }
      : null),
  };
}

/** Settled Live Activity snapshot when Gemini asks its one follow-up question. */
export function foodAnalysisClarifyPayload(
  question: string,
  startedAtEpochMs: number,
  alert: boolean,
): FoodAnalysisActivityPayload {
  const detail = question.trim() || 'What is the main food in this meal?';
  return {
    phase: 'clarify',
    title: 'One quick detail',
    detail,
    startedAtEpochMs,
    ...(alert
      ? {
          alertTitle: 'One quick detail',
          alertBody: detail,
        }
      : null),
  };
}

/** Settled Live Activity snapshot when an analysis ends in an error or limit while away. */
export function foodAnalysisFailedPayload(
  title: string,
  detail: string,
  startedAtEpochMs: number,
  alert: boolean,
): FoodAnalysisActivityPayload {
  const cleanTitle = title.trim() || 'Analysis didn’t finish';
  const cleanDetail = detail.trim() || 'Tap to return to hyPer.';
  return {
    phase: 'failed',
    title: cleanTitle,
    detail: cleanDetail,
    startedAtEpochMs,
    ...(alert
      ? {
          alertTitle: cleanTitle,
          alertBody: cleanDetail,
        }
      : null),
  };
}

export function createFoodAnalysisActivitySync(bridge: FoodAnalysisActivityBridge): FoodAnalysisActivitySync {
  let latest: FoodAnalysisActivityPayload | null = null;
  let tail: Promise<void> = Promise.resolve();
  let queuedSync: object | null = null;

  function enqueue(step: () => Promise<void> | void): void {
    tail = tail
      .then(() => withTimeout(Promise.resolve(step()), STEP_TIMEOUT_MS, 'Food analysis Live Activity call timed out'))
      .catch(() => {
        // The Live Activity is garnish around the analysis — fail quietly.
      });
  }

  return {
    sync(payload) {
      latest = payload;
      if (queuedSync) return;
      const token = {};
      queuedSync = token;
      enqueue(() => {
        if (queuedSync !== token) return;
        queuedSync = null;
        if (!latest) return;
        return bridge.sync(latest);
      });
    },
    end() {
      latest = null;
      queuedSync = null;
      enqueue(() => bridge.end());
    },
  };
}
