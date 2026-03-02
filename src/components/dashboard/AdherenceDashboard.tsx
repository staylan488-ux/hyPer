import { motion } from 'motion/react';
import { format, parseISO } from 'date-fns';
import { Card, CardTitle } from '@/components/shared';
import { useAdherenceData } from '@/hooks/useAdherenceData';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS } from '@/types';
import type { MuscleGroup } from '@/types';
import { springs, staggerContainer, fadeUp } from '@/lib/animations';
import { Flame, Zap, Target, Activity } from 'lucide-react';

// ─── Streak Pill ───────────────────────────────────────

function StreakPill({
  icon: Icon,
  count,
  label,
  colorClass,
  delay,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  count: number;
  label: string;
  colorClass: string;
  delay: number;
}) {
  const isActive = count > 0;

  return (
    <motion.div
      className={`relative flex flex-col items-center gap-2 rounded-[var(--radius-md)] border p-4 transition-colors ${
        isActive
          ? `${colorClass} border-[var(--color-border-strong)]`
          : 'bg-[var(--color-surface-1)] border-[var(--color-border-soft)]'
      }`}
      initial={{ opacity: 0, y: 16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, ...springs.smooth }}
    >
      {/* Glow halo when active */}
      {isActive && (
        <motion.div
          className="absolute inset-0 rounded-[var(--radius-md)] opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at 50% 30%, var(--color-accent), transparent 70%)',
          }}
          animate={{ opacity: [0.15, 0.3, 0.15] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="relative z-10 flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.5} />
        <span className="number-large text-[var(--color-text)] tabular-nums">{count}</span>
      </div>
      <span className="relative z-10 text-[9px] tracking-[0.18em] uppercase text-[var(--color-muted)] text-center leading-tight">
        {label}
      </span>
    </motion.div>
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
      <p className="text-editorial py-4">
        Log your meals to see your weekly nutrition trend.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Calorie bars */}
      <div>
        <p className="text-[9px] tracking-[0.18em] uppercase text-[var(--color-muted)] mb-3">
          Calories vs Target
        </p>
        <div className="flex items-end gap-1.5 h-20">
          {weeklyNutrition.map((day, i) => {
            const pct = calorieTarget > 0 ? Math.min(day.calories / calorieTarget, 1.3) : 0;
            const isHit = day.calories >= calorieTarget * 0.85 && day.calories <= calorieTarget * 1.15;
            const isToday = i === weeklyNutrition.length - 1;
            const heightPct = Math.max(pct * 100, 4);

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="relative w-full h-16 flex items-end">
                  {/* Target line */}
                  <div
                    className="absolute w-full border-t border-dashed border-[var(--color-muted)]/30"
                    style={{ bottom: `${(1 / 1.3) * 100}%` }}
                  />
                  <motion.div
                    className={`w-full rounded-t-[4px] ${
                      isHit
                        ? 'bg-[var(--color-sage)]'
                        : pct > 1.15
                          ? 'bg-[var(--color-rose)]'
                          : 'bg-[var(--color-muted)]'
                    } ${isToday ? 'opacity-100' : 'opacity-70'}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{
                      duration: 0.7,
                      delay: i * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>
                <span
                  className={`text-[8px] tracking-[0.1em] uppercase ${
                    isToday
                      ? 'text-[var(--color-text)]'
                      : 'text-[var(--color-muted)]'
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
        <p className="text-[9px] tracking-[0.18em] uppercase text-[var(--color-muted)] mb-3">
          Protein vs Target
        </p>
        <div className="flex items-end gap-1.5 h-20">
          {weeklyNutrition.map((day, i) => {
            const pct = proteinTarget > 0 ? Math.min(day.protein / proteinTarget, 1.3) : 0;
            const isHit = day.protein >= proteinTarget * 0.85 && day.protein <= proteinTarget * 1.15;
            const isToday = i === weeklyNutrition.length - 1;
            const heightPct = Math.max(pct * 100, 4);

            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="relative w-full h-16 flex items-end">
                  <div
                    className="absolute w-full border-t border-dashed border-[var(--color-muted)]/30"
                    style={{ bottom: `${(1 / 1.3) * 100}%` }}
                  />
                  <motion.div
                    className={`w-full rounded-t-[4px] ${
                      isHit
                        ? 'bg-[var(--color-accent)]'
                        : pct > 1.15
                          ? 'bg-[var(--color-rose)]'
                          : 'bg-[var(--color-muted)]'
                    } ${isToday ? 'opacity-100' : 'opacity-70'}`}
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{
                      duration: 0.7,
                      delay: i * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>
                <span
                  className={`text-[8px] tracking-[0.1em] uppercase ${
                    isToday
                      ? 'text-[var(--color-text)]'
                      : 'text-[var(--color-muted)]'
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
      <div className="flex items-center gap-4 pt-2 border-t border-white/5">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--color-sage)]" />
          <span className="text-[8px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
            On target
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--color-muted)]" />
          <span className="text-[8px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
            Under
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[var(--color-rose)]" />
          <span className="text-[8px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
            Over
          </span>
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
      <p className="text-editorial py-4">
        Complete workouts with volume tracking to see readiness signals.
      </p>
    );
  }

  const statusConfig = {
    high: {
      dot: 'bg-[var(--color-sage)]',
      glow: 'shadow-[0_0_6px_var(--color-sage)]',
      text: 'text-[var(--color-sage)]',
      badge: 'Ready',
    },
    moderate: {
      dot: 'bg-[var(--color-accent)]',
      glow: '',
      text: 'text-[var(--color-accent)]',
      badge: 'OK',
    },
    low: {
      dot: 'bg-[var(--color-rose)]',
      glow: 'shadow-[0_0_6px_var(--color-rose)]',
      text: 'text-[var(--color-rose)]',
      badge: 'Recover',
    },
  };

  // Sort: high first, then moderate, then low
  const sorted = [...data].sort((a, b) => {
    const order = { high: 0, moderate: 1, low: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <motion.div
      className="grid grid-cols-2 gap-2"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {sorted.map((item) => {
        const cfg = statusConfig[item.status];
        const label =
          MUSCLE_GROUP_LABELS[item.muscleGroup as MuscleGroup] ||
          item.label;

        return (
          <motion.div
            key={item.muscleGroup}
            className={`flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-sm)] border transition-colors ${
              item.status === 'high'
                ? 'bg-sage-tint border-[var(--color-border-strong)]'
                : item.status === 'low'
                  ? 'bg-rose-tint border-[var(--color-border-strong)]'
                  : 'bg-[var(--color-surface-1)] border-[var(--color-border-soft)]'
            }`}
            variants={fadeUp}
            transition={springs.smooth}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.glow}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-[var(--color-text)] truncate leading-tight">
                {label}
              </p>
            </div>
            <span className={`text-[8px] tracking-[0.15em] uppercase font-medium flex-shrink-0 ${cfg.text}`}>
              {cfg.badge}
            </span>
          </motion.div>
        );
      })}
    </motion.div>
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
            <div
              key={i}
              className="rounded-[var(--radius-md)] border border-[var(--color-border-soft)] bg-[var(--color-surface-1)] p-4 flex flex-col items-center gap-2"
            >
              <div className="shimmer h-7 w-8" />
              <div className="shimmer h-2 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* Chart skeleton */}
      <div>
        <div className="shimmer h-3 w-32 mb-4" />
        <div className="flex items-end gap-1.5 h-20">
          {[60, 85, 45, 70, 90, 55, 40].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="relative w-full h-16 flex items-end">
                <div className={`shimmer w-full rounded-t-[4px]`} style={{ height: `${h}%` }} />
              </div>
              <div className="shimmer h-2 w-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Readiness skeleton */}
      <div>
        <div className="shimmer h-3 w-24 mb-4" />
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer h-10 rounded-[var(--radius-sm)]" />
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

  const calorieTarget = macroTarget?.calories || 2000;
  const proteinTarget = macroTarget?.protein || 150;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
    >
      <Card variant="slab" className="overflow-hidden">
        {/* Section header with accent left-bar styling */}
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.5} />
          <CardTitle>Adherence</CardTitle>
        </div>

        {loading ? (
          <AdherenceSkeleton />
        ) : (
          <div className="space-y-8">
            {/* ── Streaks ── */}
            <div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-[var(--color-muted)] mb-3">
                Active Streaks
              </p>
              <div className="grid grid-cols-3 gap-3">
                <StreakPill
                  icon={Flame}
                  count={streaks.protein}
                  label="Protein"
                  colorClass="bg-accent-tint"
                  delay={0}
                />
                <StreakPill
                  icon={Target}
                  count={streaks.calories}
                  label="Calories"
                  colorClass="bg-sage-tint"
                  delay={0.06}
                />
                <StreakPill
                  icon={Zap}
                  count={streaks.workout}
                  label="Training"
                  colorClass="bg-accent-tint-strong"
                  delay={0.12}
                />
              </div>
            </div>

            {/* ── Weekly Nutrition ── */}
            <div>
              <WeeklyNutritionChart
                weeklyNutrition={weeklyNutrition}
                calorieTarget={calorieTarget}
                proteinTarget={proteinTarget}
              />
            </div>

            {/* ── Lift Readiness ── */}
            <div>
              <p className="text-[9px] tracking-[0.18em] uppercase text-[var(--color-muted)] mb-3">
                Lift Readiness
              </p>
              <LiftReadiness data={liftReadiness} />
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
