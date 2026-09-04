import { format, parseISO } from 'date-fns';
import { Card, CardTitle } from '@/components/shared';
import { useAdherenceData } from '@/hooks/useAdherenceData';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_MACRO_TARGET, MUSCLE_GROUP_LABELS } from '@/types';
import type { MuscleGroup } from '@/types';
import { Flame, Zap, Target, Activity } from 'lucide-react';

// ─── Streak Pill ───────────────────────────────────────

function StreakPill({
  icon: Icon,
  count,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  count: number;
  label: string;
}) {
  const isActive = count > 0;

  return (
    <div className="pt-3">
      <Icon
        className={`w-3.5 h-3.5 mb-2 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}
        strokeWidth={1.5}
      />
      <span className="number-large text-[var(--color-text)] tabular-nums block">{count}</span>
      <span className="t-label-sm mt-2 block">{label}</span>
    </div>
  );
}

// ─── Weekly Nutrition Bars ─────────────────────────────

function WeeklyNutritionChart({
  weeklyNutrition,
  calorieTarget,
  proteinTarget,
}: {
  weeklyNutrition: { date: string; calories: number; protein: number }[];
  calorieTarget: number;
  proteinTarget: number;
}) {
  if (weeklyNutrition.length === 0) {
    return (
      <p className="t-caption py-4">
        Log your meals to see your weekly nutrition trend.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Calorie bars */}
      <div>
        <p className="t-label-sm mb-3">Calories vs Target</p>
        <div className="flex items-end gap-px h-20 border-b border-[var(--color-border-strong)]">
          {weeklyNutrition.map((day, i) => {
            const pct = calorieTarget > 0 ? Math.min(day.calories / calorieTarget, 1.3) : 0;
            const isHit = day.calories >= calorieTarget * 0.85 && day.calories <= calorieTarget * 1.15;
            const isToday = i === weeklyNutrition.length - 1;
            const heightPct = Math.max(pct * 100, 4);
            const over = pct > 1.15;

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="relative w-full h-16 flex items-end">
                  {/* Target line */}
                  <div
                    className="absolute w-full border-t border-dashed border-[var(--color-border-strong)]"
                    style={{ bottom: `${(1 / 1.3) * 100}%` }}
                  />
                  <div
                    className="w-full"
                    style={{
                      backgroundColor: over ? 'var(--color-accent)' : 'var(--color-text)',
                      opacity: over ? 1 : isHit ? (isToday ? 1 : 0.85) : isToday ? 0.5 : 0.32,
                      height: `${heightPct}%`,
                    }}
                  />
                </div>
                <span
                  className={`t-caption ${
                    isToday ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                >
                  {format(parseISO(day.date), 'EEE').charAt(0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Protein bars */}
      <div>
        <p className="t-label-sm mb-3">Protein vs Target</p>
        <div className="flex items-end gap-px h-20 border-b border-[var(--color-border-strong)]">
          {weeklyNutrition.map((day, i) => {
            const pct = proteinTarget > 0 ? Math.min(day.protein / proteinTarget, 1.3) : 0;
            const isHit = day.protein >= proteinTarget * 0.85 && day.protein <= proteinTarget * 1.15;
            const isToday = i === weeklyNutrition.length - 1;
            const heightPct = Math.max(pct * 100, 4);
            const over = pct > 1.15;

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="relative w-full h-16 flex items-end">
                  <div
                    className="absolute w-full border-t border-dashed border-[var(--color-border-strong)]"
                    style={{ bottom: `${(1 / 1.3) * 100}%` }}
                  />
                  <div
                    className="w-full"
                    style={{
                      backgroundColor: over ? 'var(--color-accent)' : 'var(--color-text)',
                      opacity: over ? 1 : isHit ? (isToday ? 1 : 0.85) : isToday ? 0.5 : 0.32,
                      height: `${heightPct}%`,
                    }}
                  />
                </div>
                <span
                  className={`t-caption ${
                    isToday ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                >
                  {format(parseISO(day.date), 'EEE').charAt(0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-[var(--color-text)]" />
          <span className="t-label-sm">On target</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-[var(--color-text)] opacity-32" />
          <span className="t-label-sm">Under</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-[var(--color-accent)]" />
          <span className="t-label-sm">Over</span>
        </div>
      </div>
    </div>
  );
}

// ─── Lift Readiness ────────────────────────────────────

function LiftReadiness({
  data,
}: {
  data: { muscleGroup: string; status: 'high' | 'moderate' | 'low'; label: string }[];
}) {
  if (data.length === 0) {
    return (
      <p className="t-caption py-4">
        Complete workouts with volume tracking to see readiness signals.
      </p>
    );
  }

  const statusConfig = {
    high: {
      mark: 'bg-[var(--color-text)]',
      text: 'text-[var(--color-text)]',
      badge: 'Ready',
    },
    moderate: {
      mark: 'bg-[var(--color-text-dim)]',
      text: 'text-[var(--color-text-dim)]',
      badge: 'OK',
    },
    low: {
      mark: 'bg-[var(--color-accent)]',
      text: 'text-[var(--color-accent)]',
      badge: 'Recover',
    },
  };

  // Sort: high first, then moderate, then low
  const sorted = [...data].sort((a, b) => {
    const order = { high: 0, moderate: 1, low: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <ul>
      {sorted.map((item) => {
        const cfg = statusConfig[item.status];
        const label =
          MUSCLE_GROUP_LABELS[item.muscleGroup as MuscleGroup] ||
          item.label;

        return (
          <li
            key={item.muscleGroup}
            className="flex items-center gap-3 py-2.5 border-t border-[var(--color-border)]"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.mark}`} />
            <span className="flex-1 min-w-0 t-body text-[var(--color-text)]">
              {label}
            </span>
            <span className={`t-label-sm flex-shrink-0 ${cfg.text}`}>
              {cfg.badge}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Shimmer Skeletons ─────────────────────────────────

function AdherenceSkeleton() {
  return (
    <div className="space-y-8">
      {/* Streaks skeleton */}
      <div>
        <div className="shimmer h-3 w-20 mb-4" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-t border-[var(--color-border)] pt-3 space-y-2">
              <div className="shimmer h-8 w-10" />
              <div className="shimmer h-2 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* Chart skeleton */}
      <div>
        <div className="shimmer h-3 w-32 mb-4" />
        <div className="flex items-end gap-px h-20">
          {[60, 85, 45, 70, 90, 55, 40].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="relative w-full h-16 flex items-end">
                <div className="shimmer w-full" style={{ height: `${h}%` }} />
              </div>
              <div className="shimmer h-2 w-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Readiness skeleton */}
      <div>
        <div className="shimmer h-3 w-24 mb-4" />
        <div className="space-y-px">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer h-9" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────

export function AdherenceDashboard() {
  const { weeklyNutrition, streaks, liftReadiness, loading } = useAdherenceData();
  const { macroTarget } = useAppStore();

  const calorieTarget = macroTarget?.calories || DEFAULT_MACRO_TARGET.calories;
  const proteinTarget = macroTarget?.protein || DEFAULT_MACRO_TARGET.protein;

  return (
    <div>
      <Card variant="slab" className="overflow-hidden">
        {/* Section header */}
        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-[var(--color-text)]">
          <Activity className="w-3.5 h-3.5 text-[var(--color-text)]" strokeWidth={1.5} />
          <CardTitle>Adherence</CardTitle>
        </div>

        {loading ? (
          <AdherenceSkeleton />
        ) : (
          <div className="space-y-9">
            {/* ── Streaks ── */}
            <div>
              <p className="t-label mb-4">Active Streaks</p>
              <div className="grid grid-cols-3 gap-3">
                <StreakPill
                  icon={Flame}
                  count={streaks.protein}
                  label="Protein"
                />
                <StreakPill
                  icon={Target}
                  count={streaks.calories}
                  label="Calories"
                />
                <StreakPill
                  icon={Zap}
                  count={streaks.workout}
                  label="Training"
                />
              </div>
            </div>

            {/* ── Weekly Nutrition ── */}
            <div className="pt-8 border-t border-[var(--color-border)]">
              <WeeklyNutritionChart
                weeklyNutrition={weeklyNutrition}
                calorieTarget={calorieTarget}
                proteinTarget={proteinTarget}
              />
            </div>

            {/* ── Lift Readiness ── */}
            <div className="pt-8 border-t border-[var(--color-border)]">
              <p className="t-label mb-2">Lift Readiness</p>
              <LiftReadiness data={liftReadiness} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
