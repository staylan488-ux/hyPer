import { motion } from 'motion/react';

import { springs } from '@/lib/animations';
import type { TrainingHoursPoint } from '@/lib/workoutSessions';

interface TrainingHoursHistogramProps {
  points: TrainingHoursPoint[];
}

export function TrainingHoursHistogram({ points }: TrainingHoursHistogramProps) {
  const maxMinutes = Math.max(...points.map((point) => point.totalMinutes), 60);
  const hasTraining = points.some((point) => point.totalMinutes > 0);

  if (!hasTraining) {
    return (
      <div className="py-12 text-center">
        <p className="text-[#6B6B6B] text-sm">No training hours yet</p>
        <p className="text-[#6B6B6B]/60 text-xs mt-2 tracking-wide">Complete a workout to see your weekly time trend</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-40 flex items-end gap-2">
        {points.map((point, index) => {
          const height = Math.max(12, Math.round((point.totalMinutes / maxMinutes) * 100));

          return (
            <div key={point.weekStart} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[10px] tabular-nums text-[var(--color-text-dim)]">
                {point.totalHours > 0 ? `${point.totalHours}h` : '0h'}
              </span>
              <div className="w-full h-28 rounded-[18px] bg-[var(--color-surface-high)] border border-[var(--color-border-soft)] flex items-end overflow-hidden">
                <motion.div
                  className="w-full rounded-[16px] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-accent)_80%,transparent),color-mix(in_srgb,var(--color-sage)_70%,transparent))]"
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ delay: index * 0.05, ...springs.smooth }}
                />
              </div>
              <span className="text-[9px] tracking-[0.1em] uppercase text-[var(--color-muted)]">
                {point.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
        Completed session time over the last 8 weeks
      </p>
    </div>
  );
}
