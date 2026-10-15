import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfWeek, subWeeks } from 'date-fns';
import { VolumeRail } from '@/components/shared';
import {
  Chevron,
  Eyebrow,
  MetalSection,
  MetalTitle,
  useCommandCapsule,
  type CommandCapsuleSpec,
} from '@/components/metal';
import { BackLink } from '@/components/progress/BackLink';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleVolume } from '@/types';
import { getVolumeRecommendation } from '@/lib/volumeStatus';
import { buildWeeklyTrainingHours, TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { TrainingHoursHistogram } from '@/components/dashboard/TrainingHoursHistogram';
import { WeeklyNutrition } from '@/components/dashboard/WeeklyNutrition';
import { pickInsight, summarizeWeekVolume } from '@/components/dashboard/todayModel';
import { VolumeMaquette } from '@/components/coaching/VolumeMaquette';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { springs } from '@/lib/animations';

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

const LANDMARK_NOTES = [
  { label: 'MV — Maintenance', desc: 'Minimum weekly sets to keep the muscle you have.' },
  { label: 'MEV — Minimum Effective', desc: 'The floor for growth. Below this, the stimulus is too small.' },
  { label: 'MAV — Maximum Adaptive', desc: 'The zone where added sets buy the most growth.' },
  { label: 'MRV — Maximum Recoverable', desc: 'The ceiling. Past this, recovery loses to fatigue.' },
];

export function Analysis() {
  const { weeklyVolume, calculateWeeklyVolume } = useAppStore();
  const navigate = useNavigate();
  const [expandedMuscle, setExpandedMuscle] = useState<string | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [trainingHours, setTrainingHours] = useState<TrainingHoursPoint[]>([]);
  const [hoursLoading, setHoursLoading] = useState(true);
  // This week's volume has been read once since the screen opened, so an
  // empty list means "nothing logged" rather than "not loaded yet".
  const [volumeRead, setVolumeRead] = useState(false);

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
    let active = true;
    void Promise.resolve(calculateWeeklyVolume())
      .catch(() => {})
      .finally(() => { if (active) setVolumeRead(true); });
    void fetchTrainingHours();
    return () => { active = false; };
  }, [calculateWeeklyVolume, fetchTrainingHours]);

  const coached = useMemo(
    () =>
      weeklyVolume
        .map((mv) => ({ mv, call: buildCoachingCall(mv) }))
        .sort((a, b) => a.call.priority - b.call.priority || b.mv.weekly_sets - a.mv.weekly_sets),
    [weeklyVolume]
  );
  // The same week summary and flag Today shows, so the two screens agree.
  const week = useMemo(() => summarizeWeekVolume(weeklyVolume), [weeklyVolume]);
  const insight = useMemo(() => pickInsight(weeklyVolume), [weeklyVolume]);

  const hasVolume = weeklyVolume.length > 0;
  const volumeLoading = !hasVolume && !volumeRead;
  const isEmpty = !hasVolume && volumeRead;

  // Progress reads; its one action is main's empty-state "Start training".
  const capsule: CommandCapsuleSpec | null = isEmpty ? {
    key: 'progress-start',
    label: 'Start training',
    sublabel: 'Log a session to start coaching',
    glyph: 'arrow',
    dock: 'tabbar',
    onPress: () => navigate('/train'),
  } : null;
  useCommandCapsule(capsule);

  return (
    <div className="metal-page pb-nav">
      <header>
        <BackLink to="/">Today</BackLink>
        <Eyebrow className="mt-1">Progress</Eyebrow>
        <MetalTitle note={`Week of ${format(startOfWeek(new Date(), TRAINING_WEEK), 'MMM d')}`}>Coaching</MetalTitle>
      </header>

      {/* ── Headline: muscles in range this week ── */}
      <section aria-label="This week">
        {volumeLoading ? (
          <div aria-hidden>
            <div className="shimmer h-[90px] w-36 mt-5" />
            <div className="shimmer h-[2px] w-full mt-[18px]" />
          </div>
        ) : isEmpty ? (
          <>
            <div className="metal-hero">
              <span className="metal-num">0</span>
              <span className="metal-hero-caption">muscles trained this week</span>
            </div>
            <p className="metal-line mt-6">No training data this week</p>
            <p className="metal-note mt-1">Log a session and hyPer starts coaching your weekly volume against research landmarks.</p>
          </>
        ) : (
          <>
            <div className="metal-hero">
              <span className="metal-num">{week.inRange}<i>/{week.trained}</i></span>
              <span className="metal-hero-caption">muscles in range this week</span>
            </div>
            <WeekSegments inRange={week.inRange} under={week.under} over={week.over} />
            {insight && insight.tone !== 'zone' && (
              <p className="metal-flag mt-4"><span><b>{insight.muscle}</b> {insight.flag}</span></p>
            )}
          </>
        )}
      </section>

      {hasVolume && (
        <>
          {/* ── The figure ── */}
          <MetalSection label="Muscle map" className="!mt-8">
            <VolumeMaquette
              volume={weeklyVolume}
              onSelectMuscle={(muscle) => {
                if (!muscle) return;
                const rows = new Set(weeklyVolume.map((entry) => entry.muscle_group));
                const target = rows.has(muscle) ? muscle : ['front_delts', 'side_delts', 'rear_delts'].includes(muscle) && rows.has('shoulders') ? 'shoulders' : null;
                if (target) setExpandedMuscle(target);
              }}
            />
          </MetalSection>

          {/* ── Per-muscle calls ── */}
          <MetalSection
            label="By muscle"
            right={week.under + week.over > 0 ? (
              <span>
                {week.under > 0 && <><b>{week.under}</b> under</>}
                {week.under > 0 && week.over > 0 && <span className="text-[var(--metal-ink-3)]" aria-hidden> · </span>}
                {week.over > 0 && <><b className="!text-[var(--metal-red)]">{week.over}</b> over</>}
              </span>
            ) : week.trained > 0 ? <span>All in range</span> : undefined}
          >
            <div className="mt-2" aria-label="This week's volume by muscle" role="list">
              {coached.map(({ mv, call }) => (
                <MuscleRow
                  key={mv.muscle_group}
                  mv={mv}
                  call={call}
                  expanded={expandedMuscle === mv.muscle_group}
                  onToggle={() => setExpandedMuscle(expandedMuscle === mv.muscle_group ? null : mv.muscle_group)}
                />
              ))}
            </div>
          </MetalSection>
        </>
      )}

      {/* ── Training hours ── */}
      <MetalSection label="Training hours" right="8 weeks">
        {hoursLoading ? (
          <div className="mt-3" aria-hidden>
            <div className="h-[2.75rem]" />
            <div className="flex items-end gap-px h-36 border-b border-[var(--metal-line)]">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="shimmer flex-1 h-[45%]" />
              ))}
            </div>
          </div>
        ) : (
          <TrainingHoursHistogram points={trainingHours} />
        )}
      </MetalSection>

      {/* ── Weekly nutrition ── */}
      <WeeklyNutrition />

      {/* ── Research explainer: supporting detail, not the primary UI ── */}
      <section className="metal-section">
        <button
          type="button"
          className="w-full min-h-11 mt-1.5 flex items-center justify-between gap-3 text-left"
          aria-expanded={showExplainer}
          onClick={() => setShowExplainer(!showExplainer)}
        >
          <Eyebrow>What the landmarks mean</Eyebrow>
          <Disclosure open={showExplainer} />
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
              <div className="metal-list mt-1">
                {LANDMARK_NOTES.map((item) => (
                  <div key={item.label} className="metal-row !min-h-0 !py-3.5">
                    <span className="min-w-0">
                      <span className="metal-row-title">{item.label}</span>
                      <span className="metal-row-detail !text-[13px]">{item.desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

/**
 * One segment per trained muscle: in range in ink, under on the bare track,
 * over the ceiling in red. Same counts as Today's week line.
 */
function WeekSegments({ inRange, under, over }: { inRange: number; under: number; over: number }) {
  const total = inRange + under + over;
  if (total === 0) return null;
  const kinds = [
    ...Array<string | undefined>(inRange).fill('is-on'),
    ...Array<string | undefined>(under).fill(undefined),
    ...Array<string | undefined>(over).fill('is-now'),
  ];
  return (
    <div
      className={`metal-segs${total <= 12 ? ' is-wide' : ''}`}
      role="img"
      aria-label={`${inRange} of ${total} muscles in range, ${under} under, ${over} over`}
    >
      {kinds.map((kind, index) => <span key={index} className={kind} />)}
    </div>
  );
}

/** A 7×12 chevron that points down and turns up when open. */
function Disclosure({ open }: { open: boolean }) {
  return (
    <motion.span
      className="flex-none w-3 h-3 flex items-center justify-center text-[var(--metal-ink-3)]"
      initial={false}
      animate={{ rotate: open ? -90 : 90 }}
      transition={springs.tactile}
      aria-hidden
    >
      <Chevron className="w-[7px] h-[12px]" />
    </motion.span>
  );
}

function MuscleRow({ mv, call, expanded, onToggle }: {
  mv: MuscleVolume;
  call: CoachingCall;
  expanded: boolean;
  onToggle: () => void;
}) {
  const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
  const isHot = call.tone === 'berry';
  const name = MUSCLE_GROUP_LABELS[mv.muscle_group] || mv.muscle_group.replace('_', ' ');

  return (
    <div role="listitem" className="border-t-[0.5px] border-[var(--metal-rule)]">
      <button
        type="button"
        className="w-full text-left pt-3 pb-4"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="flex items-baseline justify-between gap-4">
          <span className="metal-row-title min-w-0">{name}</span>
          <span className="flex items-baseline gap-3 shrink-0">
            <span className="flex items-baseline gap-[5px]">
              <span className={`metal-num text-[30px] leading-none ${isHot ? '!text-[var(--metal-red)]' : ''}`}>
                {mv.weekly_sets}
              </span>
              <span className="metal-unit">sets</span>
            </span>
            <Disclosure open={expanded} />
          </span>
        </span>
        <span className="metal-row-detail !mt-0.5">
          <span className={isHot ? 'text-[var(--metal-red)]' : 'text-[var(--metal-ink)]'}>{call.chip}</span>
          <span className="text-[var(--metal-ink-3)]" aria-hidden> · </span>
          {call.headline}
        </span>

        {mv.landmark ? (
          <VolumeRail
            // The marker's carrier is a full-width box shifted right; clip it so
            // the page cannot pan sideways.
            className="mt-3 overflow-hidden"
            current={mv.weekly_sets}
            mev={mv.landmark.mev}
            mavLow={mv.landmark.mav_low}
            mavHigh={mv.landmark.mav_high}
            mrv={mv.landmark.mrv}
            reveal={`coaching-volume-${mv.muscle_group}`}
          />
        ) : (
          <span className="block mt-2 text-[12.5px] text-[var(--metal-ink-2)]">No landmarks set</span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.settle}
          >
            <div className="pb-5">
              <dl className="grid grid-cols-4">
                {[
                  { label: 'MV', value: mv.landmark?.mv },
                  { label: 'MEV', value: mv.landmark?.mev },
                  { label: 'MAV', value: mv.landmark ? `${mv.landmark.mav_low}–${mv.landmark.mav_high}` : undefined },
                  { label: 'MRV', value: mv.landmark?.mrv },
                ].map((item, itemIndex) => (
                  <div
                    key={item.label}
                    className={`py-1 ${itemIndex > 0 ? 'pl-3 border-l-[0.5px] border-[var(--metal-rule)]' : ''}`}
                  >
                    <dt className="metal-eyebrow">{item.label}</dt>
                    <dd className="metal-num text-[24px] leading-none mt-2">{item.value ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              {recommendation && (
                <p className="metal-note !max-w-none mt-4">{recommendation.message}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
