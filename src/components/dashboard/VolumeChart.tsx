import { motion } from 'motion/react';
import type { MuscleVolume } from '@/types';
import { MUSCLE_GROUP_LABELS } from '@/types';
import { springs } from '@/lib/animations';

interface VolumeChartProps {
  volumeData: MuscleVolume[];
}

const statusColors: Record<string, string> = {
  below_mev: '#8B6B6B',
  mev_mav: '#A68B6B',
  mav: '#8B9A7D',
  approaching_mrv: '#9A8B7D',
  above_mrv: '#7D6B6B',
};

export function VolumeChart({ volumeData }: VolumeChartProps) {
  if (volumeData.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[#6B6B6B] text-sm">No volume data this week</p>
        <p className="text-[#6B6B6B]/60 text-xs mt-2 tracking-wide">Complete a workout to see your progress</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {volumeData.map((mv, index) => {
        const landmark = mv.landmark;
        const maxDisplay = landmark ? landmark.mrv + 5 : mv.weekly_sets + 5;
        const widthPercent = Math.min((mv.weekly_sets / maxDisplay) * 100, 100);

        return (
          <motion.div
            key={mv.muscle_group}
            className="space-y-2"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06, ...springs.smooth }}
          >
            <div className="flex justify-between items-baseline">
              <span className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="number-medium text-[#E8E4DE]">{mv.weekly_sets}</span>
                {landmark && <span className="text-xs tabular-nums text-[#6B6B6B]">/ {landmark.mav_low}-{landmark.mav_high}</span>}
              </div>
            </div>

            <div className="relative h-3 bg-[#2E2E2E] rounded-[999px] overflow-hidden">
              <motion.div
                className="absolute h-full rounded-[999px]"
                style={{
                  background: mv.status === 'mav'
                    ? 'linear-gradient(to right, #8B9A7D, rgba(139, 154, 125, 0.4))'
                    : statusColors[mv.status] || '#6B6B6B'
                }}
                initial={{ width: 0 }}
                animate={{ width: `${widthPercent}%` }}
                transition={{ duration: 0.8, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </motion.div>
        );
      })}

      {/* Legend */}
      <motion.div
        className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-white/5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.4 }}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8B6B6B' }} />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">Below MEV</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#A68B6B' }} />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">MEV-MAV</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#8B9A7D' }} />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">MAV</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#9A8B7D' }} />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">Near MRV</span>
        </div>
      </motion.div>
    </div>
  );
}
