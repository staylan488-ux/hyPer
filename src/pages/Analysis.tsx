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
      <motion.header className="mb-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Link
          to="/"
          className="pressable inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] mb-3 -ml-1 py-1 px-1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2.25} />
          Home
        </Link>
        <p className="t-label-sm mb-1">Progress · week of {format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'MMM d')}</p>
        <h1 className="t-title">Coaching</h1>
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
        <div className="space-y-2.5 mb-6">
          {coached.map(({ mv, call }, index) => {
            const isExpanded = expandedMuscle === mv.muscle_group;
            const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
            const toneStyle = TONE_STYLES[call.tone];

            return (
              <motion.div
                key={mv.muscle_group}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.smooth, delay: Math.min(index * 0.04, 0.3) }}
              >
                <div className="panel overflow-hidden">
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3.5"
                    onClick={() => setExpandedMuscle(isExpanded ? null : mv.muscle_group)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <h3 className="t-heading text-[15px]">
                        {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
                      </h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.06em]"
                          style={{ color: toneStyle.text, backgroundColor: toneStyle.bg }}
                        >
                          {call.chip}
                        </span>
                        <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                          <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                        </motion.span>
                      </div>
                    </div>

                    <p className="text-[13px] font-medium text-[var(--color-text-dim)] mb-2.5">{call.headline}</p>

                    <div className="flex items-center gap-3">
                      <span className="t-data text-[var(--color-text)] shrink-0 w-14">
                        {mv.weekly_sets}
                        <span className="text-[10px] text-[var(--color-muted)] ml-0.5">sets</span>
                      </span>
                      {mv.landmark ? (
                        <VolumeRail
                          className="flex-1"
                          current={mv.weekly_sets}
                          mev={mv.landmark.mev}
                          mavLow={mv.landmark.mav_low}
                          mavHigh={mv.landmark.mav_high}
                          mrv={mv.landmark.mrv}
                        />
                      ) : (
                        <span className="t-caption">No landmarks set</span>
                      )}
                    </div>
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
                        <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border)]">
                          <div className="grid grid-cols-4 gap-1.5 my-3">
                            {[
                              { label: 'MV', value: mv.landmark?.mv },
                              { label: 'MEV', value: mv.landmark?.mev },
                              { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}–${mv.landmark.mav_high}` : undefined },
                              { label: 'MRV', value: mv.landmark?.mrv },
                            ].map((item) => (
                              <div key={item.label} className="well text-center py-2.5">
                                <p className="t-label-sm text-[9px]">{item.label}</p>
                                <p className="t-data-sm text-[var(--color-text-dim)] mt-0.5">{item.value ?? '—'}</p>
                              </div>
                            ))}
                          </div>
                          {recommendation && (
                            <p className="text-[13px] italic leading-relaxed text-[var(--color-text-dim)]">{recommendation.message}</p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Training hours */}
      <motion.section
        className="panel p-4 mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="t-label">Training hours</span>
          <span className="t-data-sm text-[10px] text-[var(--color-muted)]">8 weeks</span>
        </div>
        {hoursLoading ? (
          <div className="flex items-end gap-3 h-36">
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
        className="mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.14 }}
      >
        <AdherenceDashboard />
      </motion.section>

      {/* Research explainer — supporting detail, not the primary UI */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.18 }}
      >
        <div className="panel overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3.5 text-left"
            onClick={() => setShowExplainer(!showExplainer)}
          >
            <span className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[var(--color-stone)]" strokeWidth={1.75} />
              <span className="t-label">What the landmarks mean</span>
            </span>
            <motion.span animate={{ rotate: showExplainer ? 180 : 0 }} transition={springs.snappy}>
              <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />
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
                <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border)] pt-3">
                  {[
                    { tone: 'stone', label: 'MV — Maintenance', desc: 'Minimum weekly sets to keep the muscle you have.' },
                    { tone: 'amber', label: 'MEV — Minimum Effective', desc: 'The floor for growth. Below this, the stimulus is too small.' },
                    { tone: 'sage', label: 'MAV — Maximum Adaptive', desc: 'The zone where added sets buy the most growth.' },
                    { tone: 'berry', label: 'MRV — Maximum Recoverable', desc: 'The ceiling. Past this, recovery loses to fatigue.' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start gap-3">
                      <span
                        className="w-[3px] h-7 rounded-full mt-0.5 shrink-0"
                        style={{ backgroundColor: TONE_STYLES[item.tone as CoachingTone].text }}
                      />
                      <div>
                        <p className="text-[12px] font-semibold text-[var(--color-text)]">{item.label}</p>
                        <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </Screen>
  );
}
