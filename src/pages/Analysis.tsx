import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, subWeeks } from 'date-fns';
import { Button, EmptyState, Screen, PageHeader } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleVolume } from '@/types';
import { getVolumeRecommendation } from '@/lib/volumeStatus';
import { buildWeeklyTrainingHours, TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { TrainingHoursHistogram } from '@/components/dashboard/TrainingHoursHistogram';
import { WeeklyNutrition } from '@/components/dashboard/WeeklyNutrition';
import { VolumeMap } from '@/components/coaching/VolumeMap';
import { LandmarkRail } from '@/components/coaching/LandmarkRail';
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

// One name per state, the same in the summary, the figure's legend and the
// row chips: "Under", "In range" (MEV up to the adaptive ceiling), "Near
// ceiling", "Over ceiling". Only the words; the thresholds are volumeStatus's.
function buildCoachingCall(mv: MuscleVolume): CoachingCall {
  const mev = mv.landmark?.mev ?? 0;
  switch (mv.status) {
    case 'below_mev': {
      const gap = Math.max(1, Math.ceil(mev - mv.weekly_sets));
      return { chip: 'Under', tone: 'amber', headline: `Add ~${gap} ${gap === 1 ? 'set' : 'sets'} this week`, priority: 0 };
    }
    case 'above_mrv':
      return { chip: 'Over ceiling', tone: 'berry', headline: 'Pull back — beyond recoverable volume', priority: 1 };
    case 'approaching_mrv':
      return { chip: 'Near ceiling', tone: 'berry', headline: 'Hold here — fatigue is compounding', priority: 2 };
    case 'mav':
      return { chip: 'In range', tone: 'sage', headline: 'Hold volume — growth is compounding', priority: 3 };
    case 'mev_mav':
    default:
      return { chip: 'In range', tone: 'sage', headline: 'Building — room to add when ready', priority: 4 };
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
    // Named exactly as each muscle's own status label: near and over are
    // counted apart.
    const near = weeklyVolume.filter((mv) => mv.status === 'approaching_mrv').length;
    const over = weeklyVolume.filter((mv) => mv.status === 'above_mrv').length;
    const detail = [
      under > 0 ? `${under} under` : null,
      near > 0 ? `${near} near ceiling` : null,
      over > 0 ? `${over} over ceiling` : null,
    ].filter(Boolean).join(' · ');
    return { total, inRange, detail };
  }, [weeklyVolume]);

  // Supporting detail, not the primary UI. It closes the volume list (it
  // explains the rails' landmarks), or stands alone on an empty week.
  const explainer = (
    <section className={weeklyVolume.length === 0 ? 'mt-12 border-t border-[var(--color-border)]' : ''} aria-label="What the landmarks mean">
      <button
        type="button"
        className="w-full min-h-[56px] flex items-center justify-between text-left"
        aria-expanded={showExplainer}
        onClick={() => setShowExplainer(!showExplainer)}
      >
        <span className="t-row-title">What the landmarks mean</span>
        <motion.span className="trail-disclosure" animate={{ rotate: showExplainer ? 180 : 0 }} transition={springs.tactile}>
          <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {showExplainer && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.settle}
          >
            <dl className="pb-4 space-y-4">
              {[
                { label: 'MV — Maintenance', desc: 'Minimum weekly sets to keep the muscle you have.' },
                { label: 'MEV — Minimum Effective', desc: 'The floor for growth. Below this, the stimulus is too small.' },
                { label: 'MAV — Maximum Adaptive', desc: 'The zone where added sets buy the most growth.' },
                { label: 'MRV — Maximum Recoverable', desc: 'The ceiling. Past this, recovery loses to fatigue.' },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="t-heading">{item.label}</dt>
                  <dd className="t-caption mt-1">{item.desc}</dd>
                </div>
              ))}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );

  return (
    <Screen>
      <PageHeader
        back={{ label: 'Today', to: '/' }}
        eyebrow={`Week of ${format(startOfWeek(new Date(), TRAINING_WEEK), 'MMM d')}`}
        title="Progress"
        className="mb-8"
      />

      {/* Per-muscle calls */}
      {weeklyVolume.length === 0 ? (
        <EmptyState
          art="chart"
          title="No training data this week"
          body="Log a session and hyPer starts coaching your weekly volume against research landmarks."
          action={
            <Link to="/train">
              <Button size="md" className="px-6">
                Start training
              </Button>
            </Link>
          }
        />
      ) : (
        <>
        {/* The figure and its legend are one rest unit: it passes under the
            bar only while the legend still has the figures' legs above it. */}
        <section aria-label="This week's volume by muscle" data-rest-block data-rest-sliver="112">
          <VolumeMap
            volume={weeklyVolume}
            onSelectMuscle={(muscle) => {
              if (!muscle) return;
              const rows = new Set(weeklyVolume.map((entry) => entry.muscle_group));
              const target = rows.has(muscle) ? muscle : ['front_delts', 'side_delts', 'rear_delts'].includes(muscle) && rows.has('shoulders') ? 'shoulders' : null;
              if (target) setExpandedMuscle(target);
            }}
          />
        </section>

        <section className="mt-12" aria-label="Volume calls">
          <div className="flex items-end justify-between gap-4 pb-5 border-b border-[var(--color-border)]">
            <div className="min-w-0">
              <p className="t-label">In range</p>
              {rangeSummary.detail && <p className="t-caption mt-2">{rangeSummary.detail}</p>}
            </div>
            <p
              className="number-large text-[var(--color-text)] tabular-nums"
              aria-label={`${rangeSummary.inRange} of ${rangeSummary.total} muscles in their productive volume range`}
            >
              {rangeSummary.inRange}<span className="text-[var(--color-text-dim)]">/{rangeSummary.total}</span>
            </p>
          </div>
          {coached.map(({ mv, call }) => {
            const isExpanded = expandedMuscle === mv.muscle_group;
            const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
            const isHot = mv.status === 'above_mrv';

            return (
              <div key={mv.muscle_group} className="border-b border-[var(--color-border-soft)]">
                <button
                  type="button"
                  className="w-full text-left py-5"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedMuscle(isExpanded ? null : mv.muscle_group)}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="t-row-title">
                      {MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ')}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="status-label" data-tone={isHot ? 'hot' : call.tone === 'amber' ? 'under' : undefined}>
                        {call.chip}
                      </span>
                      <motion.span className="trail-disclosure" animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile}>
                        <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                      </motion.span>
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-4 mb-4">
                    <span className="flex items-baseline gap-1.5">
                      {/* The count stays ink: the status label and the rail's
                          marker already carry "over ceiling". */}
                      <span className="number-medium text-[var(--color-text)]">
                        {mv.weekly_sets}
                      </span>
                      <span className="t-caption">sets</span>
                    </span>
                    <p className="t-caption text-right">{call.headline}</p>
                  </div>

                  {mv.landmark ? (
                    <LandmarkRail
                      current={mv.weekly_sets}
                      mev={mv.landmark.mev}
                      mavLow={mv.landmark.mav_low}
                      mavHigh={mv.landmark.mav_high}
                      mrv={mv.landmark.mrv}
                      over={isHot}
                      reveal={`coaching-volume-${mv.muscle_group}`}
                    />
                  ) : (
                    <span className="t-caption">No landmarks set</span>
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springs.settle}
                    >
                      <div className="pb-5">
                        <dl className="grid grid-cols-4 mb-4">
                          {[
                            { label: 'MV', value: mv.landmark?.mv },
                            { label: 'MEV', value: mv.landmark?.mev },
                            { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}–${mv.landmark.mav_high}` : undefined },
                            { label: 'MRV', value: mv.landmark?.mrv },
                          ].map((item) => (
                            <div key={item.label}>
                              <dt className="t-label-sm">{item.label}</dt>
                              <dd className="t-data text-[var(--color-text)] mt-1">{item.value ?? '—'}</dd>
                            </div>
                          ))}
                        </dl>
                        {recommendation && (
                          <p className="t-caption">{recommendation.message}</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {explainer}
        </section>
        </>
      )}

      {/* Training hours */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <span className="t-label">Training hours</span>
          <span className="t-caption">Last 8 weeks</span>
        </div>
        {hoursLoading ? (
          <div className="flex items-end justify-around h-36 mt-11 border-b border-[var(--color-border)]">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="shimmer w-[7%] h-[45%]" />
            ))}
          </div>
        ) : (
          <TrainingHoursHistogram points={trainingHours} />
        )}
      </section>

      {/* Weekly nutrition */}
      <section className="mt-14">
        <WeeklyNutrition />
      </section>

      {weeklyVolume.length === 0 && explainer}
    </Screen>
  );
}
