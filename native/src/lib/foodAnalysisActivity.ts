// Native bridge for Gemini meal-analysis background execution and its Live
// Activity (lock screen and Dynamic Island). Ordering and payload shaping live
// in src/lib/foodAnalysisActivitySync.ts.
import { isAppVisible, onAppHidden, onAppVisible } from '@/lib/appVisibility';
import { createFoodAnalysisActivitySync } from '@/lib/foodAnalysisActivitySync';

import {
  addBackgroundTaskExpiredListener,
  beginBackgroundTask,
  endBackgroundTask,
  endFoodAnalysis,
  syncFoodAnalysis,
} from '../../modules/hyper-activity';

const activity = createFoodAnalysisActivitySync({
  sync: syncFoodAnalysis,
  end: endFoodAnalysis,
});

export const syncFoodAnalysisActivity = activity.sync;
export const endFoodAnalysisActivity = activity.end;

export interface FoodAnalysisBackgroundTask {
  /** True once the app is backgrounded and iOS's background grace period has expired. */
  isExpired(): boolean;
  /** True if the app entered the background at any point during this task. */
  wasBackgrounded(): boolean;
  /** Releases the iOS background task and cleans up listeners. Idempotent. */
  end(): void;
}

/**
 * Claims iOS background execution time so an in-flight Gemini meal analysis
 * continues running when the person switches to another app. If iOS expires
 * the background window before the server answers, marks the task expired so
 * recovery pauses cleanly until the app returns (and re-claims a fresh window
 * if they leave again).
 */
export function startFoodAnalysisBackgroundTask(name = 'MealAnalysis'): FoodAnalysisBackgroundTask {
  let token = beginBackgroundTask(name);
  let expired = !token;
  let backgrounded = !isAppVisible();
  let ended = false;

  const expiredSub = addBackgroundTaskExpiredListener((expiredToken) => {
    if (ended || expiredToken !== token) return;
    token = '';
    expired = true;
  });
  const stopHidden = onAppHidden(() => {
    backgrounded = true;
  });
  const stopVisible = onAppVisible(() => {
    if (ended || !expired) return;
    const renewed = beginBackgroundTask(name);
    if (renewed) {
      token = renewed;
      expired = false;
    }
  });

  return {
    isExpired: () => expired,
    wasBackgrounded: () => backgrounded,
    end() {
      if (ended) return;
      ended = true;
      expiredSub.remove();
      stopHidden();
      stopVisible();
      if (token) {
        const current = token;
        token = '';
        endBackgroundTask(current);
      }
    },
  };
}

/** Resolves immediately if the app is visible, or as soon as it returns from the background. */
export function waitForAppForeground(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
  if (isAppVisible()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      stopVisible();
      reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError'));
    };
    const stopVisible = onAppVisible(() => {
      signal?.removeEventListener('abort', onAbort);
      stopVisible();
      resolve();
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    // Guard against the app becoming visible between the check above and listener registration.
    if (isAppVisible()) {
      signal?.removeEventListener('abort', onAbort);
      stopVisible();
      resolve();
    }
  });
}
