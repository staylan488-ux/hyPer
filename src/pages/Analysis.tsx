import { useEffect } from 'react';
import { ArrowLeft, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Card, CardTitle } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS } from '@/types';
import { getVolumeRecommendation } from '@/lib/splitTemplates';
import { springs } from '@/lib/animations';

const statusColors: Record<string, string> = {
  below_mev: '#8B6B6B',
  mev_mav: '#A68B6B',
  mav: '#8B9A7D',
  approaching_mrv: '#9A8B7D',
  above_mrv: '#7D6B6B',
};

export function Analysis() {
  const { weeklyVolume, fetchVolumeLandmarks, calculateWeeklyVolume } = useAppStore();

  useEffect(() => {
    fetchVolumeLandmarks();
    calculateWeeklyVolume();
  }, [calculateWeeklyVolume, fetchVolumeLandmarks]);

  return (
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      {/* Header */}
      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] mb-4 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </Link>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Training Metrics</p>
        <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Volume Analysis</h1>
        <p className="text-xs text-[#6B6B6B] mt-2">Weekly muscle group volume vs. research landmarks</p>
      </motion.header>

      {weeklyVolume.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <Card variant="slab" className="text-center py-16">
            <p className="text-xs text-[#6B6B6B] mb-2">No volume data available</p>
            <p className="text-[10px] text-[#6B6B6B]/60">
              Complete a workout to see your volume analysis
            </p>
          </Card>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {weeklyVolume.map((mv, index) => {
            const recommendation = mv.landmark
              ? getVolumeRecommendation(mv.weekly_sets, mv.landmark)
              : null;

            return (
              <motion.div
                key={mv.muscle_group}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.smooth, delay: index * 0.05 }}
              >
                <Card variant="slab">
                  <div className="flex items-start gap-4">
                    <motion.div
                      className="w-2 h-2 rounded-[4px] mt-1.5 flex-shrink-0 animate-breathe"
                      style={{ backgroundColor: statusColors[mv.status] || '#6B6B6B' }}
                    />
                    <div className="flex-1">
                      <h3 className="text-sm text-[#E8E4DE] mb-4">
                        {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
                      </h3>

                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                          { label: 'MV', value: mv.landmark?.mv },
                          { label: 'MEV', value: mv.landmark?.mev },
                          { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}-${mv.landmark.mav_high}` : undefined },
                          { label: 'MRV', value: mv.landmark?.mrv },
                        ].map((item, i) => (
                          <motion.div
                            key={item.label}
                            className="text-center py-3 bg-[#1A1A1A] rounded-[12px]"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.05 + i * 0.04, ...springs.smooth }}
                          >
                            <p className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">{item.label}</p>
                            <p className="text-sm tabular-nums text-[#9A9A9A] mt-1">{item.value ?? '—'}</p>
                          </motion.div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between py-2 border-t border-white/5">
                        <span className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">Current</span>
                        <span className="text-xs tabular-nums text-[#E8E4DE] font-display">{mv.weekly_sets} sets/wk</span>
                      </div>

                      {recommendation && (
                        <p className="text-[10px] text-[#9A9A9A] leading-relaxed mt-3 pt-3 border-t border-white/5">
                          {recommendation.message}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mt-6">
          <CardTitle className="mb-5">Volume Landmarks</CardTitle>
          <div className="space-y-4">
            {[
              { color: '#6B6B6B', label: 'MV — Maintenance', desc: 'Minimum sets to maintain muscle mass' },
              { color: '#8B6B6B', label: 'MEV — Minimum Effective', desc: 'Minimum sets to stimulate growth' },
              { color: '#8B9A7D', label: 'MAV — Maximum Adaptive', desc: 'Optimal range for hypertrophy' },
              { color: '#9A8B7D', label: 'MRV — Maximum Recoverable', desc: 'Maximum sets before recovery suffers' },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                className="flex items-start gap-3"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, ...springs.smooth }}
              >
                <Circle className="w-2 h-2 mt-1 flex-shrink-0" fill={item.color} />
                <div>
                  <p className="text-[10px] tracking-[0.1em] uppercase text-[#9A9A9A]">{item.label}</p>
                  <p className="text-[10px] text-[#6B6B6B] mt-0.5">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
