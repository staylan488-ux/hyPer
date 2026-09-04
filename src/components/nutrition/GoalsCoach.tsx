import { useState } from 'react';

import { Button } from '@/components/shared/Button';
import { supabase } from '@/lib/supabase';
import {
  buildCoachContext,
  requestCoachRecommendation,
  type CoachRecommendation,
} from '@/lib/nutritionCoach';
import { getBodyWeightHistorySince } from '@/lib/healthWeights';
import { buildWeightTrend } from '@/lib/weightTrend';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import type { TargetNumbers } from '@/lib/nutritionCoach';

/**
 * Describe a goal in plain words; get calories and macros reasoned from YOUR
 * data.
 *
 * What separates this from asking a chatbot: the request carries the adaptive
 * engine's measured expenditure - this person's actual daily burn, learned from
 * weeks of their logged intake against their weight trend - plus age, size,
 * activity and current targets, and the model is told to anchor on measurement
 * over formulas.
 *
 * The numbers are never applied directly. They land in the same editable
 * fields as manual entry, pre-filled, for the user to adjust and save. The
 * coach proposes; the person disposes.
 */
export function GoalsCoach({
  profile,
  weightKg,
  currentTargets,
  onRecommendation,
}: {
  profile: NutritionProfile | null;
  weightKg: number | null;
  currentTargets: TargetNumbers | null;
  onRecommendation: (recommendation: CoachRecommendation) => void;
}) {
  const [goals, setGoals] = useState(() => globalThis.localStorage?.getItem('hyper.coach.goals') ?? '');
  // On by default: the measured burn and weight trend are what make the advice
  // personal. Off means the coach sees only basic stats plus the typed goals.
  const [shareMeasured, setShareMeasured] = useState(true);
  const [recommendation, setRecommendation] = useState<CoachRecommendation | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askCoach = async () => {
    if (!profile) {
      setError('Run "Calculate my targets" once first, so the coach knows your stats.');
      return;
    }
    setAsking(true);
    setError(null);
    try {
      globalThis.localStorage?.setItem('hyper.coach.goals', goals);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const userId = sessionData.session?.user?.id;
      if (!accessToken || !userId) throw new Error('Your session expired. Sign out and back in.');

      // the measured rate of change over the last three weeks, if shared
      let trendKgPerWeek: number | null = null;
      if (shareMeasured) {
        try {
          const samples = await getBodyWeightHistorySince(userId, 21);
          trendKgPerWeek = buildWeightTrend(samples, { windowDays: 21 }).kgPerWeek;
        } catch {
          // no weigh-ins is not a reason to refuse to coach
        }
      }

      const result = await requestCoachRecommendation({
        goals,
        context: buildCoachContext(profile, weightKg, currentTargets, { trendKgPerWeek, shareMeasured }),
        accessToken,
      });
      setRecommendation(result);
      onRecommendation(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The coach is unavailable right now.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mt-8">
      <span className="t-label-sm">Describe a goal</span>
      <textarea
        value={goals}
        onChange={(event) => setGoals(event.target.value)}
        placeholder="e.g., Cut to 175 lb by November without losing strength. I lift 4x a week and run intervals twice."
        className="well w-full min-h-24 px-3 py-3 mt-3 text-[1rem] text-[var(--color-text)] outline-none resize-y placeholder:text-[var(--color-muted)]"
      />
      <label className="flex items-start gap-3 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={shareMeasured}
          onChange={(event) => setShareMeasured(event.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="t-caption">
          Share my measured data — learned daily burn and recent weight trend.
          This is what makes the advice yours rather than generic.
        </span>
      </label>
      <Button
        className="w-full mt-3"
        variant="secondary"
        loading={asking}
        disabled={goals.trim().length < 5}
        onClick={() => void askCoach()}
      >
        {asking ? 'Reasoning over your data…' : 'Recommend targets from this'}
      </Button>
      {asking && (
        <p className="t-caption mt-2">
          Uses your measured burn and weight trend, so it can take a minute or two.
        </p>
      )}
      {recommendation && !asking && (
        <div className="mt-4">
          <p className="t-caption">{recommendation.rationale}</p>
          {recommendation.cautions && (
            <p className="t-caption mt-2 text-[var(--color-accent)]">{recommendation.cautions}</p>
          )}
          <p className="t-label-sm mt-2 text-[var(--color-muted)]">
            Filled into the fields below — adjust anything, then Save targets. Not medical advice.
          </p>
        </div>
      )}
      {error && (
        <p className="mt-3 t-caption text-[var(--color-accent)]">{error}</p>
      )}
    </div>
  );
}
