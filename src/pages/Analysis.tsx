import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, subWeeks } from 'date-fns';
import { Button, EmptyState, MetalRing, Screen, VolumeRail, PageTitle } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleVolume } from '@/types';
import { getVolumeRecommendation } from '@/lib/volumeStatus';
import { buildWeeklyTrainingHours, TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { TrainingHoursHistogram } from '@/components/dashboard/TrainingHoursHistogram';
import { WeeklyNutrition } from '@/components/dashboard/WeeklyNutrition';
import { VolumeMaquette } from '@/components/coaching/VolumeMaquette';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { springs } from '@/lib/animations';
import './progress-liquid.css';

type CoachingTone = 'amber' | 'sage' | 'berry' | 'stone';

interface CoachingCall {
  chip: string;
  tone: CoachingTone;
  headline: string;
  priority: number;
}

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
  const { weeklyVolume, calculateWeeklyVolume } = useAppStore();
  const [expandedMuscle, setExpandedMuscle] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [trainingHours, setTrainingHours] = useState<TrainingHoursPoint[]>([]);
  const [hoursLoading, setHoursLoading] = useState(true);

  const fetchTrainingHours = useCallback(async () => {
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        setTrainingHours(buildWeeklyTrainingHours([]));
        return;
      }

      const from = startOfWeek(subWeeks(new Date(), 7), TRAINING_WEEK).toISOString();

      const { data: workouts, error } = await supabase
        .from('workouts')
        .select('date, completed, completed_at, created_at')
        .eq('user_id', userId)
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
    calculateWeeklyVolume();
    void fetchTrainingHours();
  }, [calculateWeeklyVolume, fetchTrainingHours]);

  const coached = useMemo(
    () =>
      weeklyVolume
        .map((mv) => ({ mv, call: buildCoachingCall(mv) }))
        .sort((a, b) => a.call.priority - b.call.priority || b.mv.weekly_sets - a.mv.weekly_sets),
    [weeklyVolume]
  );

  // One headline ratio: muscles whose weekly volume sits in the productive
  // range (between MEV and the adaptive ceiling). Derived, never invented.
  const rangeSummary = useMemo(() => {
    const total = weeklyVolume.length;
    const inRange = weeklyVolume.filter((mv) => mv.status === 'mev_mav' || mv.status === 'mav').length;
    const under = weeklyVolume.filter((mv) => mv.status === 'below_mev').length;
    const high = weeklyVolume.filter((mv) => mv.status === 'approaching_mrv' || mv.status === 'above_mrv').length;
    const detail = [
      under > 0 ? `${under} under` : null,
      high > 0 ? `${high} near or over ceiling` : null,
    ].filter(Boolean).join(' · ');
    return { total, inRange, detail };
  }, [weeklyVolume]);

  return (
    <Screen>
      {/* Header */}
      <header className="mb-7">
        <Link
          to="/"
          className="studio-row-action mb-4 -ml-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          Home
        </Link>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Progress</span>
          <span className="t-label-sm">Week of {format(startOfWeek(new Date(), TRAINING_WEEK), 'MMM d')}</span>
        </div>
        <PageTitle className="mt-3 pt-5 border-t border-[var(--color-border)]">Coaching</PageTitle>
      </header>

      {/* Per-muscle calls */}
      {weeklyVolume.length === 0 ? (
        <EmptyState
          art="chart"
          title="No training data this week"
          body="Log a session and hyPer starts coaching your weekly volume against research landmarks."
          action={
            <Link to="/train">
              <Button metal size="md" className="px-6">
                Start training
              </Button>
            </Link>
          }
        />
      ) : (
        <>
        <section className="platter" aria-label="This week's volume by muscle">
          <VolumeMaquette
            volume={weeklyVolume}
            onSelectMuscle={(muscle) => {
              if (!muscle) return;
              const rows = new Set(weeklyVolume.map((entry) => entry.muscle_group));
              const target = rows.has(muscle) ? muscle : ['front_delts', 'side_delts', 'rear_delts'].includes(muscle) && rows.has('shoulders') ? 'shoulders' : null;
              if (target) setExpandedMuscle(target);
            }}
          />
        </section>
        <section className="platter platter-flush mt-4" aria-label="Volume calls">
          <div className="platter-row flex items-center justify-between gap-4 px-5 pt-5 pb-5">
            <div className="min-w-0">
              <p className="t-label">This week</p>
              <p className="t-heading mt-2">
                {rangeSummary.inRange} of {rangeSummary.total} {rangeSummary.total === 1 ? 'muscle' : 'muscles'} in range
              </p>
              {rangeSummary.detail && <p className="t-caption mt-1">{rangeSummary.detail}</p>}
            </div>
            <MetalRing
              progress={rangeSummary.total > 0 ? rangeSummary.inRange / rangeSummary.total : 0}
              label={`${rangeSummary.inRange} of ${rangeSummary.total} muscles in their productive volume range`}
              size={72}
              thickness={5}
              reveal="coaching-range-ring"
            >
              <span className="number-medium text-[18px]! text-[var(--color-text)] tabular-nums">
                {rangeSummary.inRange}<span className="text-[var(--color-text-dim)]">/{rangeSummary.total}</span>
              </span>
            </MetalRing>
          </div>
          {coached.map(({ mv, call }) => {
            const isExpanded = expandedMuscle === mv.muscle_group;
            const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
            const isHot = call.tone === 'berry';

            return (
              <motion.div
                key={mv.muscle_group}
                className="platter-row"
              >
                <button
                  type="button"
                  className="w-full text-left px-5 py-5"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedMuscle(isExpanded ? null : mv.muscle_group)}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <span className="t-label">
                      {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
                    </span>
                    <span className="flex items-center gap-2.5 shrink-0">
                      <span className="status-capsule" data-tone={isHot ? 'hot' : call.tone === 'amber' ? 'under' : undefined}>
                        {call.chip}
                      </span>
                      <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile}>
                        <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" strokeWidth={1.5} />
                      </motion.span>
                    </span>
                  </div>

                  <div className="flex items-end justify-between gap-4 mb-4">
                    <span className="flex items-baseline gap-1.5">
                      <span className={`number-large ${isHot ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                        {mv.weekly_sets}
                      </span>
                      <span className="t-caption">sets</span>
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
                      reveal={`coaching-volume-${mv.muscle_group}`}
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
                      transition={springs.settle}
                    >
                      <div className="px-5 pb-5">
                        <div className="ledger-well grid grid-cols-4 mb-4">
                          {[
                            { label: 'MV', value: mv.landmark?.mv },
                            { label: 'MEV', value: mv.landmark?.mev },
                            { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}–${mv.landmark.mav_high}` : undefined },
                            { label: 'MRV', value: mv.landmark?.mrv },
                          ].map((item, itemIndex) => (
                            <div
                              key={item.label}
                              className={`py-3 ${itemIndex > 0 ? 'border-l border-[var(--color-border-soft)]' : ''} pl-3`}
                            >
                              <p className="t-label-sm">{item.label}</p>
                              <p className="t-data text-[var(--color-text)] mt-1">{item.value ?? '—'}</p>
                            </div>
                          ))}
                        </div>
                        {recommendation && (
                          <p className="t-caption">{recommendation.message}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </section>
        </>
      )}

      {/* Training hours */}
      <motion.section
        className={`platter ${weeklyVolume.length === 0 ? 'mt-8' : 'mt-4'}`}
      >
        <div className="flex items-baseline justify-between mb-1">
          <span className="t-label">Training hours</span>
          <span className="t-label-sm text-[var(--color-muted)]">8 weeks</span>
        </div>
        {hoursLoading ? (
          <div className="flex items-end justify-around h-40 mt-11 border-b border-[var(--color-border)]">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="shimmer w-[7%] h-[45%] rounded-t-[6px]" />
            ))}
          </div>
        ) : (
          <TrainingHoursHistogram points={trainingHours} />
        )}
      </motion.section>

      {/* Weekly nutrition */}
      <motion.section
        className="progress-platter-host mt-4"
      >
        <WeeklyNutrition />
      </motion.section>

      {/* Research explainer — supporting detail, not the primary UI */}
      <motion.section
        className="platter platter-flush mt-4"
      >
        <button
          type="button"
          className="w-full min-h-[60px] px-5 flex items-center justify-between text-left"
          aria-expanded={showExplainer}
          onClick={() => setShowExplainer(!showExplainer)}
        >
          <span className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-[var(--color-muted)]" strokeWidth={1.5} />
            <span className="t-label">What the landmarks mean</span>
          </span>
          <motion.span animate={{ rotate: showExplainer ? 180 : 0 }} transition={springs.tactile}>
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
              transition={springs.settle}
            >
              <div className="ledger-sets shadow-[inset_0_1px_0_var(--platter-divider)]">
                {[
                  { tone: 'stone', label: 'MV — Maintenance', desc: 'Minimum weekly sets to keep the muscle you have.' },
                  { tone: 'amber', label: 'MEV — Minimum Effective', desc: 'The floor for growth. Below this, the stimulus is too small.' },
                  { tone: 'sage', label: 'MAV — Maximum Adaptive', desc: 'The zone where added sets buy the most growth.' },
                  { tone: 'berry', label: 'MRV — Maximum Recoverable', desc: 'The ceiling. Past this, recovery loses to fatigue.' },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3 px-5 py-4">
                    <div>
                      <p className="t-heading">{item.label}</p>
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
