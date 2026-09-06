import { useId, useState } from 'react';

import { Button } from '@/components/shared/Button';
import { supabase } from '@/lib/supabase';
import {
  buildCoachContext,
  requestCoachRecommendation,
  type CoachRecommendation,
} from '@/lib/nutritionCoach';
import { getPhotoWorkerSettings } from '@/lib/photoAnalysis';
import { getBodyWeightHistorySince } from '@/lib/healthWeights';
import { buildWeightTrend } from '@/lib/weightTrend';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import type { TargetNumbers } from '@/lib/nutritionCoach';

/** Suggestions enter the shared target draft; they never save targets directly. */
export function GoalsCoach({
  profile,
  weightKg,
  currentTargets,
  onRecommendation,
  onSetupProfile,
  onSetupWorker,
  workerConfigured,
  onDraftChange,
  onBusyChange,
}: {
  profile: NutritionProfile | null;
  weightKg: number | null;
  currentTargets: TargetNumbers | null;
  onRecommendation: (recommendation: CoachRecommendation) => void;
  onSetupProfile?: () => void;
  onSetupWorker?: () => void;
  workerConfigured?: boolean;
  onDraftChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const goalId = useId();
  const sharingId = useId();
  const [goals, setGoals] = useState(() => globalThis.localStorage?.getItem('hyper.coach.goals') ?? '');
  const [shareMeasured, setShareMeasured] = useState(true);
  const [recommendation, setRecommendation] = useState<CoachRecommendation | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixturePreview = isPreviewActive() && !isAppSandboxActive();
  const hasWorker = fixturePreview || (workerConfigured ?? Boolean(getPhotoWorkerSettings().url));

  const askCoach = async () => {
    if (!profile || !hasWorker || asking) return;
    setAsking(true);
    onBusyChange?.(true);
    setError(null);
    try {
      globalThis.localStorage?.setItem('hyper.coach.goals', goals);
      let result: CoachRecommendation;
      if (fixturePreview) {
        result = {
          calories: 2400,
          protein: 170,
          carbs: 268,
          fat: 72,
          rationale: 'Preview suggestion: this example keeps protein steady and adjusts the daily calorie target. In your account, the coach explains suggestions using your profile and the information you choose to share.',
          cautions: 'Sample numbers for trying the interface; these are not personalized recommendations.',
          confidence: 0.7,
          provider: 'preview',
          reconciled: false,
        };
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const userId = sessionData.session?.user?.id;
        if (!accessToken || !userId) throw new Error('Your session expired. Sign out and back in.');

        let trendKgPerWeek: number | null = null;
        if (shareMeasured) {
          try {
            const samples = await getBodyWeightHistorySince(userId, 21);
            trendKgPerWeek = buildWeightTrend(samples, { windowDays: 21 }).kgPerWeek;
          } catch {
            // Weight-history failure does not prevent a recommendation from basic stats.
          }
        }
        result = await requestCoachRecommendation({
          goals,
          context: buildCoachContext(profile, weightKg, currentTargets, { trendKgPerWeek, shareMeasured }),
          accessToken,
        });
      }
      setRecommendation(result);
      onDraftChange?.(false);
      onRecommendation(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The coach is unavailable right now.');
    } finally {
      setAsking(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--color-text-dim)]">
        Describe what you want to change, then review the suggested calories and macros before saving.
      </p>
      {!profile && (
        <div className="border-y border-[var(--color-border)] py-4 space-y-2">
          <p className="text-sm font-medium">Set up your nutrition profile first</p>
          <p className="text-sm leading-relaxed text-[var(--color-text-dim)]">
            The calculator saves the basic stats the coach needs. Your goal text stays here while you set it up.
          </p>
          {onSetupProfile && <Button variant="secondary" className="normal-case tracking-normal text-sm" onClick={onSetupProfile}>Calculate targets</Button>}
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor={goalId} className="block text-sm font-medium">Your goal</label>
        <textarea
          id={goalId}
          value={goals}
          disabled={asking}
          maxLength={2000}
          onChange={(event) => {
            setGoals(event.target.value);
            onDraftChange?.(true);
          }}
          placeholder="For example: I want to maintain my weight while getting stronger. I lift four times a week."
          className="well w-full min-h-32 px-3 py-3 text-[1rem] text-[var(--color-text)] resize-y placeholder:text-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-text)]"
        />
      </div>
      <div>
        <label className="flex items-start gap-3 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            checked={shareMeasured}
            disabled={asking}
            aria-describedby={sharingId}
            onChange={(event) => {
              setShareMeasured(event.target.checked);
              onDraftChange?.(true);
            }}
            className="mt-1 w-5 h-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="text-sm leading-relaxed">Include daily-burn estimates and recent weight trend</span>
        </label>
        <p id={sharingId} className="mt-1 text-sm leading-relaxed text-[var(--color-text-dim)]">
          Your basic profile information, current targets, and typed goal are still sent when this is off.
          Daily-burn estimates and trends are inferred from your logs when available.
        </p>
      </div>
      <div className="border-t border-[var(--color-border)] pt-4">
        <p className="text-sm leading-relaxed text-[var(--color-text-dim)]">
          {fixturePreview
            ? 'This preview uses sample suggestions and sends no coach request.'
            : 'The coach uses your configured Mac worker. Changing the meal-analysis method or photo-analysis provider does not change the coach model.'}
        </p>
        {!hasWorker && <p className="mt-2 text-sm font-medium">Set up your Mac worker to request suggestions.</p>}
        {onSetupWorker && (
          <button type="button" onClick={onSetupWorker} className="min-h-11 text-sm underline underline-offset-4">
            {hasWorker ? 'Mac worker settings' : 'Set up Mac worker'}
          </button>
        )}
      </div>
      <Button
        className="w-full normal-case tracking-normal text-sm"
        loading={asking}
        disabled={!profile || !hasWorker || goals.trim().length < 5}
        onClick={() => void askCoach()}
      >
        {asking ? 'Getting suggestions…' : 'Get target suggestions'}
      </Button>
      {asking && <p role="status" className="text-sm text-[var(--color-text-dim)]">This can take a minute or two. You can keep this screen open while the coach responds.</p>}
      {recommendation && !asking && (
        <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
          <h3 className="text-[1rem] font-medium">Latest suggestion</h3>
          <p className="text-sm leading-relaxed">{recommendation.rationale}</p>
          {recommendation.cautions && <p className="text-sm leading-relaxed text-[var(--color-accent)]">{recommendation.cautions}</p>}
          <p className="text-sm leading-relaxed text-[var(--color-text-dim)]">
            Review and adjust these suggestions in your target draft. Saving sets manual targets that
            stay fixed until you resume adaptive targets. Not medical advice.
          </p>
          <Button variant="secondary" className="w-full normal-case tracking-normal text-sm" onClick={() => onRecommendation(recommendation)}>
            Review this suggestion
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm leading-relaxed text-[var(--color-accent)]">{error}</p>}
    </div>
  );
}
