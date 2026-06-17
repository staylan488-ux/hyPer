import { motion } from 'motion/react';

import { springs } from '@/lib/animations';
import type { TrainingHoursPoint } from '@/lib/workoutSessions';

interface TrainingHoursHistogramProps {
  points: TrainingHoursPoint[];
}

export function TrainingHoursHistogram({ points }: TrainingHoursHistogramProps) {
  const maxMinutes = Math.max(...points.map((point) => point.totalMinutes), 60);
  const hasTraining = points.some((point) => point.totalMinutes > 0);
  const peakMinutes = Math.max(...points.map((point) => point.totalMinutes), 0);

  if (!hasTraining) {
    return (
      <div className="py-12 text-center">
        <p className="t-display text-[15px] text-[var(--color-text-dim)]">No training hours yet.</p>
        <p className="t-label-sm mt-3">Complete a workout to chart your weekly time</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-40 flex items-end gap-px border-b border-[var(--color-border-strong)]">
        {points.map((point, index) => {
          const height = Math.max(4, Math.round((point.totalMinutes / maxMinutes) * 100));
          const isPeak = point.totalMinutes > 0 && point.totalMinutes === peakMinutes;

          return (
            <div key={point.weekStart} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
              <span
                className={`number-medium text-[1rem] leading-none tabular-nums ${
                  isPeak ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'
                }`}
              >
                {point.totalHours > 0 ? point.totalHours : '0'}
                <span className="t-data-sm text-[10px] text-[var(--color-muted)] ml-0.5">h</span>
              </span>
              <div className="w-full h-24 flex items-end">
                <motion.div
                  className="w-full"
                  style={{ backgroundColor: isPeak ? 'var(--color-accent)' : 'var(--color-text)' }}
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ delay: index * 0.05, ...springs.smooth }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-end gap-px">
        {points.map((point) => (
          <span key={point.weekStart} className="flex-1 text-center t-label-sm text-[9px]">
            {point.label}
          </span>
        ))}
      </div>
      <p className="t-label-sm pt-2 border-t border-[var(--color-border)]">
        Completed session time · last 8 weeks
      </p>
    </div>
  );
}
