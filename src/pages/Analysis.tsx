import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChartNoAxesColumn, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, subWeeks } from 'date-fns';
import { EmptyState, Screen, VolumeRail } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleVolume } from '@/types';
import { getVolumeRecommendation } from '@/lib/splitTemplates';
import { buildWeeklyTrainingHours, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { TrainingHoursHistogram } from '@/components/dashboard/TrainingHoursHistogram';
import { AdherenceDashboard } from '@/components/dashboard/AdherenceDashboard';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';

type CoachingTone = 'amber' | 'sage' | 'berry' | 'stone';

interface CoachingCall {
  chip: string;
  tone: CoachingTone;
  headline: string;
  priority: number;
}

const TONE_STYLES: Record<CoachingTone, { text: string; bg: string }> = {
  amber: { text: 'var(--color-accent)', bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' },
  sage: { text: 'var(--color-sage)', bg: 'color-mix(in srgb, var(--color-sage) 14%, transparent)' },
  berry: { text: 'var(--color-danger)', bg: 'color-mix(in srgb, var(--color-danger) 14%, transparent)' },
  stone: { text: 'var(--color-stone)', bg: 'color-mix(in srgb, var(--color-stone) 16%, transparent)' },
};

function buildCoachingCall(mv: MuscleVolume): CoachingCall {
  const mev = mv.landmark?.mev ?? 0;
  switch (mv.status) {
    case 'below_mev': {
      const gap = Math.max(1, Math.ceil(mev - mv.weekly_sets));
      return { chip: 'Under-stimulated', tone: 'amber', headline: `Add ~${gap} ${gap === 1 ? 'set' : 'sets'} this week`, priority: 0 };
    }
    case 'above_mrv':
      return { chip: 'Over ceiling', tone: 'berry', headline: 'Pull back — beyond recoverable volume', priority: 1 };
    case 'approaching_mrv':
      return { chip: 'Near ceiling', tone: 'berry', headline: 'Hold here — fatigue is compounding', priority: 2 };
    case 'mav':
      return { chip: 'Adaptive zone', tone: 'sage', headline: 'Hold volume — growth is compounding', priority: 3 };
    case 'mev_mav':
    default:
      return { chip: 'Effective', tone: 'sage', headline: 'Building — room to add when ready', priority: 4 };
  }
}

export function Analysis() {
  const { weeklyVolume, fetchVolumeLandmarks, calculateWeeklyVolume } = useAppStore();
  const [expandedMuscle, setExpandedMuscle] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [trainingHours, setTrainingHours] = useState<TrainingHoursPoint[]>([]);
  const [hoursLoading, setHoursLoading] = useState(true);

  const fetchTrainingHours = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTrainingHours(buildWeeklyTrainingHours([]));
        return;
      }

      const from = startOfWeek(subWeeks(new Date(), 7), { weekStartsOn: 1 }).toISOString();

      const { data: workouts, error } = await supabase
        .from('workouts')
        .select('date, completed, completed_at, created_at')
        .eq('user_id', user.id)
        .eq('completed', true)
        .gte('created_at', from)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching training hours:', error);
        setTrainingHours(buildWeeklyTrainingHours([]));
        return;
      }

      setTrainingHours(buildWeeklyTrainingHours((workouts || []) as Array<{
        date: string;
        completed: boolean;
        completed_at: string | null;
        created_at: string;
      }>));
    } catch (error) {
      console.error('Error fetching training hours:', error);
      setTrainingHours(buildWeeklyTrainingHours([]));
    } finally {
      setHoursLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVolumeLandmarks();
    calculateWeeklyVolume();
    void fetchTrainingHours();
  }, [calculateWeeklyVolume, fetchTrainingHours, fetchVolumeLandmarks]);

  const coached = useMemo(
    () =>
      weeklyVolume
        .map((mv) => ({ mv, call: buildCoachingCall(mv) }))
        .sort((a, b) => a.call.priority - b.call.priority || b.mv.weekly_sets - a.mv.weekly_sets),
    [weeklyVolume]
  );

  return (
    <Screen>
      {/* Header */}
      <motion.header className="mb-8" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Link
          to="/"
          className="pressable inline-flex items-center gap-1.5 t-label-sm hover:text-[var(--color-text)] mb-4 -ml-1 py-1 px-1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          Home
        </Link>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Progress</span>
          <span className="t-label-sm">Week of {format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'MMM d')}</span>
        </div>
        <h1 className="t-title mt-3 pt-5 border-t border-[var(--color-text)]">Coaching</h1>
      </motion.header>

      {/* Per-muscle calls */}
      {weeklyVolume.length === 0 ? (
        <EmptyState
          icon={ChartNoAxesColumn}
          title="No training data this week"
          body="Log a session and hyPer starts coaching your weekly volume against research landmarks."
          action={
            <Link to="/train">
              <span className="pressable inline-flex items-center justify-center min-h-11 px-5 rounded-[var(--radius-md)] bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)] text-sm font-semibold">
                Start training
              </span>
            </Link>
          }
        />
      ) : (
        <div className="mb-12 border-t border-[var(--color-text)]">
          {coached.map(({ mv, call }, index) => {
            const isExpanded = expandedMuscle === mv.muscle_group;
            const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
            const isHot = call.tone === 'berry';

            return (
              <motion.div
                key={mv.muscle_group}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.smooth, delay: Math.min(index * 0.04, 0.3) }}
                className="border-b border-[var(--color-border)]"
              >
                <button
                  type="button"
                  className="w-full text-left py-5"
                  onClick={() => setExpandedMuscle(isExpanded ? null : mv.muscle_group)}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <span className="t-label">
                      {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
                    </span>
                    <span className="flex items-center gap-2.5 shrink-0">
                      <span className={`t-label-sm text-[9px] ${isHot ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'}`}>
                        {call.chip}
                      </span>
                      <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                        <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" strokeWidth={1.5} />
                      </motion.span>
                    </span>
                  </div>

                  <div className="flex items-end justify-between gap-4 mb-4">
                    <span className="flex items-baseline gap-1.5">
                      <span className={`number-large text-[2.5rem] ${isHot ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                        {mv.weekly_sets}
                      </span>
                      <span className="[font-family:var(--font-display)] italic text-[1rem] text-[var(--color-text-dim)]">sets</span>
                    </span>
                    <p className="t-caption text-right max-w-[20ch]">{call.headline}</p>
                  </div>

                  {mv.landmark ? (
                    <VolumeRail
                      current={mv.weekly_sets}
                      mev={mv.landmark.mev}
                      mavLow={mv.landmark.mav_low}
                      mavHigh={mv.landmark.mav_high}
                      mrv={mv.landmark.mrv}
                    />
                  ) : (
                    <span className="t-caption">No landmarks set</span>
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springs.smooth}
                    >
                      <div className="pb-5 pt-1">
                        <div className="grid grid-cols-4 border-t border-[var(--color-border)] mb-4">
                          {[
                            { label: 'MV', value: mv.landmark?.mv },
                            { label: 'MEV', value: mv.landmark?.mev },
                            { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}–${mv.landmark.mav_high}` : undefined },
                            { label: 'MRV', value: mv.landmark?.mrv },
                          ].map((item, itemIndex) => (
                            <div
                              key={item.label}
                              className={`py-3 ${itemIndex > 0 ? 'border-l border-[var(--color-border)]' : ''} pl-3`}
                            >
                              <p className="t-label-sm text-[9px]">{item.label}</p>
                              <p className="number-medium text-[1.125rem] text-[var(--color-text)] mt-1">{item.value ?? '—'}</p>
                            </div>
                          ))}
                        </div>
                        {recommendation && (
                          <p className="text-editorial text-[15px]">{recommendation.message}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Training hours */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.1 }}
      >
        <div className="flex items-baseline justify-between mb-5">
          <span className="t-label">Training hours</span>
          <span className="t-label-sm">8 weeks</span>
        </div>
        {hoursLoading ? (
          <div className="flex items-end gap-px h-40 border-b border-[var(--color-border-strong)]">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="shimmer flex-1 h-[45%]" />
            ))}
          </div>
        ) : (
          <TrainingHoursHistogram points={trainingHours} />
        )}
      </motion.section>

      {/* Adherence */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.14 }}
      >
        <AdherenceDashboard />
      </motion.section>

      {/* Research explainer — supporting detail, not the primary UI */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.18 }}
      >
        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() => setShowExplainer(!showExplainer)}
        >
          <span className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-[var(--color-muted)]" strokeWidth={1.5} />
            <span className="t-label">What the landmarks mean</span>
          </span>
          <motion.span animate={{ rotate: showExplainer ? 180 : 0 }} transition={springs.snappy}>
            <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
          </motion.span>
        </button>
        <AnimatePresence>
          {showExplainer && (
            <motion.div
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.smooth}
            >
              <div className="mt-5">
                {[
                  { tone: 'stone', label: 'MV — Maintenance', desc: 'Minimum weekly sets to keep the muscle you have.' },
                  { tone: 'amber', label: 'MEV — Minimum Effective', desc: 'The floor for growth. Below this, the stimulus is too small.' },
                  { tone: 'sage', label: 'MAV — Maximum Adaptive', desc: 'The zone where added sets buy the most growth.' },
                  { tone: 'berry', label: 'MRV — Maximum Recoverable', desc: 'The ceiling. Past this, recovery loses to fatigue.' },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 py-3 border-t border-[var(--color-border)]">
                    <span
                      className="w-[3px] h-8 mt-0.5 shrink-0"
                      style={{ backgroundColor: TONE_STYLES[item.tone as CoachingTone].text }}
                    />
                    <div>
                      <p className="t-heading text-[12px] normal-case tracking-[0.04em]">{item.label}</p>
                      <p className="t-caption mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </Screen>
  );
}
