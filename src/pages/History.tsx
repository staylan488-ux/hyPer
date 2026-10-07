import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, Check, Plus, Link2, Unlink2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Modal, Button, Input, Toast, SelectSheet, DateField, TimeField, PageHeader, CalendarHeader } from '@/components/shared';
import { LapPaceChart } from '@/components/shared/charts';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { isPreviewActive } from '@/preview/flag';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import { createNoteAutosaver, mergeMovementNoteDrafts, mergeQueuedMovementNotePayload, remainingMovementNoteDrafts, type NoteAutosaver } from '@/lib/noteAutosave';
import { runWorkoutEdit } from '@/lib/workoutEdit';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { captureAccountScope } from '@/lib/accountScope';
import { useAuthStore } from '@/stores/authStore';
import {
  formatWorkoutDuration,
  getWorkoutDurationMs,
  getWorkoutStartDateKey,
  resolveEditedSetCompletedAt,
  resolveWorkoutTitle,
} from '@/lib/workoutSessions';
import {
  formatActivityDuration,
  formatActivityStartTime,
  getActivitySessionDateKey,
  resolveActivityTitle,
  sortActivitySessionsByStart,
} from '@/lib/activitySessions';
import {
  activityTypeLabel,
  customActivityTypeSuggestions,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  paceSecondsPerMile,
} from '@/lib/activityMetrics';
import { springs } from '@/lib/animations';
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  type ActivitySegment,
  type ActivitySession,
  type ActivitySessionInput,
  type ActivityType,
  type Exercise,
  type FlexiblePlanItem,
  type Workout,
  type WorkoutDayPlan,
  type WorkoutSet,
} from '@/types';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { activityHasStats, searchWhoopForWorkout, workoutHasWhoopStats } from '@/lib/workoutWhoop';
import { calendarMonthLabel } from '@/lib/calendarLabel';
import './progress-liquid.css';

interface WorkoutWithSplit extends Workout {
  split_day?: {
    day_name: string;
  } | null;
  day_label?: string | null;
}

interface SetEditorProps {
  workoutSet: WorkoutSet;
  onSave: (updates: { weight: number | null; reps: number | null; rpe: number | null }) => void;
  onCancel: () => void;
}

interface PickerState {
  workoutId: string;
  baseExerciseId: string | null;
  excludeExerciseIds: string[];
}

function SetEditor({ workoutSet, onSave, onCancel }: SetEditorProps) {
  const [weight, setWeight] = useState(workoutSet.weight?.toString() || '');
  const [reps, setReps] = useState(workoutSet.reps?.toString() || '');
  const [rpe, setRpe] = useState(workoutSet.rpe?.toString() || '');

  const handleSave = () => {
    onSave({
      weight: weight ? parseFloat(weight) : null,
      reps: reps ? parseInt(reps, 10) : null,
      rpe: rpe ? parseFloat(rpe) : null,
    });
  };

  return (
    <div className="space-y-5">
      <p className="t-label-sm">Editing Set {workoutSet.set_number}</p>

      <div className="grid grid-cols-3 gap-4">
        <Input
          label="Weight (lbs)"
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="-"
        />
        <Input
          label="Reps"
          type="number"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="-"
        />
        <Input
          label="RPE"
          type="number"
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          placeholder="-"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

interface ActivityEditorProps {
  activity: ActivitySession | null;
  defaultDate: Date;
  // previously used custom names, offered back so they can be reused verbatim
  customTypeSuggestions: string[];
  saving: boolean;
  onSave: (input: ActivitySessionInput) => void;
  onCancel: () => void;
  /** Saved activities only: asks for confirmation before anything is removed. */
  onDelete?: () => void;
}

interface ActivityLedgerRowProps {
  activity: ActivitySession;
  segments: ActivitySegment[];
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}

function formatSegmentDistance(distanceM: number | null): string | null {
  if (distanceM == null || distanceM <= 0) return null;
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return formatDistanceMi(distanceM);
}

const ACTIVITY_OPTIONS = ACTIVITY_TYPES.map((type) => ({
  value: type,
  label: ACTIVITY_TYPE_LABELS[type],
}));

function parseDateKey(dateKey: string): Date {
  const parsed = parseISO(dateKey);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getTimeInputValue(value?: string | null): string {
  if (!value) return '';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';

  return format(parsed, 'HH:mm');
}

function localDateTimeToIso(date: Date, timeValue: string): string | null {
  if (!timeValue) return null;

  const [hourRaw, minuteRaw] = timeValue.split(':').map((value) => Number.parseInt(value, 10));
  if (![hourRaw, minuteRaw].every(Number.isFinite)) return null;
  if (hourRaw < 0 || hourRaw > 23 || minuteRaw < 0 || minuteRaw > 59) return null;

  const localDate = new Date(date);
  localDate.setHours(hourRaw, minuteRaw, 0, 0);
  return localDate.toISOString();
}

function parseDurationSeconds(durationMinutes: string): number | null {
  if (!durationMinutes.trim()) return null;

  const parsed = Number.parseInt(durationMinutes, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.min(parsed, 24 * 60) * 60;
}

function isDateKeyInMonth(dateKey: string, month: Date): boolean {
  const parsed = parseISO(dateKey);
  return !Number.isNaN(parsed.getTime()) && isSameMonth(parsed, month);
}

function ActivityEditor({ activity, defaultDate, customTypeSuggestions, saving, onSave, onCancel, onDelete }: ActivityEditorProps) {
  const [activityType, setActivityType] = useState<ActivityType>(activity?.activity_type || 'bike_ride');
  const [customType, setCustomType] = useState(activity?.custom_type || '');
  const [title, setTitle] = useState(activity?.title || '');
  const [date, setDate] = useState(activity?.date ? parseDateKey(activity.date) : defaultDate);
  const [startTime, setStartTime] = useState(getTimeInputValue(activity?.started_at));
  const [durationMinutes, setDurationMinutes] = useState(
    activity?.duration_seconds ? String(Math.round(activity.duration_seconds / 60)) : ''
  );
  const [notes, setNotes] = useState(activity?.notes || '');

  const handleSubmit = () => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const durationSeconds = parseDurationSeconds(durationMinutes);
    const startedAt = localDateTimeToIso(date, startTime);
    const endedAt = startedAt && durationSeconds
      ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
      : null;

    onSave({
      activity_type: activityType,
      custom_type: activityType === 'other' ? customType.trim().slice(0, 40) || null : null,
      title: title.trim() || null,
      date: dateKey,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      source: activity?.source || 'manual',
      notes: notes.trim() || null,
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="t-label-sm block mb-2">Type</label>
        <SelectSheet
          value={activityType}
          onChange={setActivityType}
          options={ACTIVITY_OPTIONS}
          title="Activity type"
        />
      </div>

      {activityType === 'other' && (
        <Input
          label="Activity name"
          value={customType}
          maxLength={40}
          onChange={(event) => setCustomType(event.target.value)}
          placeholder="Yoga, surfing, rowing…"
          list="hyper-custom-activity-types"
        />
      )}
      {activityType === 'other' && customTypeSuggestions.length > 0 && (
        <datalist id="hyper-custom-activity-types">
          {customTypeSuggestions.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}

      <Input
        label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={activityType === 'other' && customType.trim()
          ? customType.trim()
          : ACTIVITY_TYPE_LABELS[activityType]}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="t-label-sm block mb-2">Date</label>
          <DateField value={date} onChange={setDate} />
        </div>
        <div>
          <label className="t-label-sm block mb-2">Start</label>
          <TimeField value={startTime} onChange={setStartTime} />
        </div>
      </div>

      <Input
        label="Duration (min)"
        type="number"
        min={1}
        max={1440}
        inputMode="numeric"
        value={durationMinutes}
        onChange={(event) => setDurationMinutes(event.target.value)}
        placeholder="Optional"
      />

      <div>
        <label htmlFor="activity-notes" className="t-label-sm block mb-2">
          Notes
        </label>
        <textarea
          id="activity-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={280}
          placeholder="Optional"
          className="material-inset w-full rounded-[var(--radius-control)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-placeholder)] focus:outline-none transition-colors resize-none"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" loading={saving} onClick={handleSubmit}>
          Save
        </Button>
      </div>
      {onDelete && (
        <div className="flex justify-center">
          <button type="button" className="text-action" data-tone="danger" disabled={saving} onClick={onDelete}>
            Delete activity
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * WHOOP physiology on a lifting workout.
 *
 * Offered here rather than on the completion screen because WHOOP usually
 * publishes a workout minutes to hours after it ends: at the moment you finish
 * lifting there is generally nothing to attach yet.
 */
/**
 * Attaching an activity's physiology to a lifting workout.
 *
 * Selection is manual rather than automatic. Time-window matching was tried and
 * is too fragile: a lift's window comes from set timestamps, WHOOP brackets its
 * own records differently, and an activity the user merged spans whatever it
 * absorbed - which produced a 0% overlap against three perfectly good WHOOP
 * records on the same day. The user knows which activity was the lift; asking
 * is more reliable than inferring, and it also allows attaching a merged
 * activity made of several WHOOP records.
 *
 * Any suggestion from the overlap search is shown first as a convenience, but
 * never required.
 */
function WorkoutActivityPanel({
  workout,
  dayActivities,
  suggestedId,
  onAttach,
  onDetach,
}: {
  workout: WorkoutWithSplit;
  dayActivities: ActivitySession[];
  suggestedId: string | null;
  onAttach: (workout: Workout, session: ActivitySession) => Promise<void>;
  onDetach: (workout: Workout) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attached = workoutHasWhoopStats(workout);
  // an activity already attached to this workout is not offered again
  const options = dayActivities.filter((activity) => activityHasStats(activity));
  const suggested = options.find((activity) => activity.id === suggestedId) ?? null;
  const ordered = suggested
    ? [suggested, ...options.filter((activity) => activity.id !== suggested.id)]
    : options;

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id); setError(null);
    try {
      await fn();
      setPicking(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="t-label">Activity stats</p>
        {attached ? (
          <button
            type="button"
            className="pressable min-h-11 -mr-2 px-2 t-label-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            disabled={busyId != null}
            onClick={() => void run(workout.id, () => onDetach(workout))}
          >
            Remove
          </button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={options.length === 0}
            onClick={() => setPicking((open) => !open)}
          >
            {picking ? 'Cancel' : 'Attach activity'}
          </Button>
        )}
      </div>

      {attached ? (
        <div className="ledger-well grid grid-cols-4 gap-2 mt-3 px-4 py-3.5">
          {([
            ['strain', workout.strain != null ? workout.strain.toFixed(1) : '—'],
            ['avg hr', workout.avg_hr != null ? String(workout.avg_hr) : '—'],
            ['max hr', workout.max_hr != null ? String(workout.max_hr) : '—'],
            ['kcal', workout.energy_kcal != null ? String(Math.round(workout.energy_kcal)) : '—'],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <p className="number-small text-[var(--color-text)]">{value}</p>
              <p className="t-label-sm mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="t-caption mt-2">
          No activity on this day carries strain or heart rate to attach.
        </p>
      ) : picking ? (
        <div className="mt-3 space-y-2">
          {ordered.map((activity) => (
            <button
              key={activity.id}
              type="button"
              disabled={busyId != null}
              className="ledger-choice disabled:opacity-50"
              onClick={() => void run(activity.id, () => onAttach(workout, activity))}
            >
              <span className="t-body block">
                {resolveActivityTitle(activity)}
                {activity.id === suggestedId && (
                  <span className="t-label-sm text-[var(--color-muted)]"> · closest match</span>
                )}
              </span>
              <span className="t-caption block mt-0.5">
                {activity.strain != null ? `strain ${activity.strain.toFixed(1)}` : 'no strain'}
                {activity.avg_hr != null ? ` · ${activity.avg_hr} bpm avg` : ''}
                {activity.energy_kcal != null ? ` · ${Math.round(activity.energy_kcal)} kcal` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="t-caption mt-2">
          Attach the activity that covers this session. Its strain and heart rate
          move onto the workout and it leaves the activity list.
        </p>
      )}

      {error && <p className="t-caption mt-2 text-[var(--color-accent)]">{error}</p>}
    </div>
  );
}

function ActivityLedgerRow({
  activity, segments, expanded, onToggleExpand, onEdit,
  selectable = false, selected = false, onToggleSelected,
}: ActivityLedgerRowProps) {
  // cross-source sessions carry enrichment segments (e.g. a WHOOP record
  // absorbed into a GPS run); the splits table shows only the primary
  // recording's laps — foreign-source segments contribute metrics, not rows
  const primarySegments = segments.filter((segment) => segment.source === activity.source);
  const title = resolveActivityTitle(activity);
  const typeLabel = activityTypeLabel(activity);
  const startTime = formatActivityStartTime(activity.started_at);
  const duration = formatActivityDuration(activity.duration_seconds);
  const subtitleParts = [
    activity.title?.trim() ? typeLabel : null,
    startTime,
    duration !== '-' ? duration : null,
    activity.source !== 'manual' ? activity.source.toUpperCase() : null,
  ].filter(Boolean);
  const metricsParts = [
    formatDistanceMi(activity.distance_m),
    activity.avg_hr != null ? `${activity.avg_hr} bpm` : null,
    activity.strain != null ? `strain ${activity.strain.toFixed(1)}` : null,
  ].filter(Boolean);
  // one segment = the whole workout; a splits table only means something for 2+
  const hasSplits = primarySegments.length >= 2;

  // The row itself opens the editor (where it can also be deleted); while
  // merging, it toggles the activity's selection instead.
  const onRowPress = selectable ? onToggleSelected : onEdit;

  return (
    <div className="px-5">
      <div className="flex items-stretch gap-3">
        {selectable && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${title} to merge`}
            onClick={onToggleSelected}
            className="pressable -ml-2.5 w-11 shrink-0 flex items-center justify-center"
          >
            <span
              aria-hidden
              className={`h-[22px] w-[22px] rounded-full flex items-center justify-center transition-colors ${
                selected ? 'bg-[var(--color-text)] text-[var(--color-base)]' : 'shadow-[inset_0_0_0_1.5px_var(--color-muted)]'
              }`}
            >
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onRowPress}
          tabIndex={selectable ? -1 : undefined}
          aria-label={selectable ? undefined : `Edit ${title}`}
          className="pressable min-w-0 flex-1 py-4 text-left flex items-center gap-3"
        >
          <span className="block min-w-0 flex-1">
          <span className="block t-body text-[var(--color-text)] break-words">{title}</span>
          <span className="block t-data-sm text-[var(--color-muted)] mt-1">
            {subtitleParts.length > 0 ? subtitleParts.join(' · ') : typeLabel}
          </span>
          {metricsParts.length > 0 && (
            <span className="block t-data-sm text-[var(--color-text-dim)] mt-0.5">
              {metricsParts.join(' · ')}
            </span>
          )}
          {activity.notes && (
            <span className="block t-caption mt-2 line-clamp-2">{activity.notes}</span>
          )}
          </span>
          {!hasSplits && !selectable && (
            <ChevronRight className="trail-chevron w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={1.5} aria-hidden />
          )}
        </button>

        {hasSplits && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="pressable -mr-3 flex items-center justify-center w-11 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            title={expanded ? 'Hide splits' : 'Show splits'}
            aria-label={expanded ? 'Hide splits' : 'Show splits'}
            aria-expanded={expanded}
          >
            {expanded
              ? <ChevronUp className="w-4 h-4" strokeWidth={1.5} />
              : <ChevronDown className="w-4 h-4" strokeWidth={1.5} />}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasSplits && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.settle}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 shadow-[inset_0_1px_0_var(--platter-divider)]">
              <LapPaceChart
                className="mb-4"
                laps={primarySegments.map((segment) => ({
                  key: segment.id,
                  durationS: segment.duration_seconds,
                  distanceM: segment.distance_m,
                }))}
                formatPace={formatPace}
                formatDistance={formatSegmentDistance}
                formatDuration={formatClockDuration}
              />
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-label-sm pb-1">
                <span>#</span>
                <span>Time</span>
                <span>Dist</span>
                <span>Pace</span>
              </div>
              {primarySegments.map((segment, index) => (
                <div
                  key={segment.id}
                  className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-data-sm text-[var(--color-text-dim)] py-0.5"
                >
                  <span>{index + 1}</span>
                  <span>{formatClockDuration(segment.duration_seconds) ?? '—'}</span>
                  <span>{formatSegmentDistance(segment.distance_m) ?? '—'}</span>
                  <span>{formatPace(paceSecondsPerMile(segment.distance_m, segment.duration_seconds)) ?? '—'}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildCalendarDays(baseDate: Date): Date[] {
  const monthStart = startOfMonth(baseDate);
  const monthEnd = endOfMonth(baseDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = startDate;
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

function groupSetsByExercise(sets: WorkoutSet[]) {
  const grouped = sets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
    if (!acc[set.exercise_id]) {
      acc[set.exercise_id] = [];
    }
    acc[set.exercise_id].push(set);
    return acc;
  }, {});

  Object.keys(grouped).forEach((exerciseId) => {
    grouped[exerciseId] = grouped[exerciseId].slice().sort((a, b) => a.set_number - b.set_number);
  });

  return grouped;
}

function progressFromSets(sets: WorkoutSet[]) {
  const totalSets = sets.length;
  const completedSets = sets.filter((set) => set.completed).length;
  const percent = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const completed = totalSets > 0 && completedSets === totalSets;
  return { totalSets, completedSets, percent, completed };
}

export function History() {
  const userId = useAuthStore((state) => state.user?.id);
  const {
    fetchWorkoutsByMonth,
    fetchWorkoutById,
    deleteWorkout,
    updateSet,
    addSetToWorkout,
    removeSetFromWorkout,
    addExerciseToWorkout,
    removeExerciseFromWorkout,
    syncWorkoutCompletion,
    updateWorkoutNotes,
    fetchWorkoutDayPlanByWorkoutId,
    addSupersetToWorkout,
    clearWorkoutSuperset,
    updateWorkoutExerciseTargetSets,
    reorderWorkoutExercises,
    fetchActivitySessionsByMonth,
    createActivitySession,
    updateActivitySession,
    deleteActivitySession,
    mergeActivitySessions,
    hasLinkedWhoopSegments,
    fetchActivitySegmentsBySessionIds,
    syncWhoop,
    whoopConnection,
    fetchWhoopConnection,
    attachWhoopToWorkout,
    detachWhoopFromWorkout,
  } = useAppStore();

  const [monthWorkouts, setMonthWorkouts] = useState<WorkoutWithSplit[]>([]);
  const [monthActivities, setMonthActivities] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<WorkoutSet | null>(null);
  const [activityEditor, setActivityEditor] = useState<{ activity: ActivitySession | null; defaultDate: Date } | null>(null);
  const [savingActivity, setSavingActivity] = useState(false);
  const [showActivityDeleteConfirm, setShowActivityDeleteConfirm] = useState<ActivitySession | null>(null);
  const [segmentsBySession, setSegmentsBySession] = useState<Record<string, ActivitySegment[]>>({});
  const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState('Saved');
  const [syncingWhoop, setSyncingWhoop] = useState(false);
  const [monthDirection, setMonthDirection] = useState(0);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [workoutPlans, setWorkoutPlans] = useState<Record<string, WorkoutDayPlan | null>>({});
  const [movementNotesByWorkout, setMovementNotesByWorkout] = useState<Record<string, Record<string, string>>>({});
  const [legacyNotesByWorkout, setLegacyNotesByWorkout] = useState<Record<string, string | null>>({});
  const [savingMovementNoteKey, setSavingMovementNoteKey] = useState<string | null>(null);
  const [savedMovementNoteKey, setSavedMovementNoteKey] = useState<string | null>(null);
  const [targetSetDrafts, setTargetSetDrafts] = useState<Record<string, string>>({});

  const noteSaverRef = useRef<NoteAutosaver | null>(null);
  const mountedRef = useRef(false);
  const movementNotesRef = useRef<Record<string, Record<string, string>>>({});
  const dirtyMovementNotesRef = useRef<Record<string, Record<string, string>>>({});
  const legacyNotesRef = useRef<Record<string, string | null>>({});
  // Only the latest month request may write state, so quick month taps (or a
  // late sync refetch) can never leave one month's data under another header.
  const monthRequestRef = useRef(0);
  const selectedMonthRef = useRef(selectedMonth);

  useEffect(() => {
    selectedMonthRef.current = selectedMonth;
  }, [selectedMonth]);

  useEffect(() => {
    movementNotesRef.current = movementNotesByWorkout;
  }, [movementNotesByWorkout]);

  useEffect(() => {
    legacyNotesRef.current = legacyNotesByWorkout;
  }, [legacyNotesByWorkout]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setShowSuccess(true);
    window.setTimeout(() => setShowSuccess(false), 1500);
  }, []);

  const showSavedToast = useCallback(() => {
    showToast('Saved');
  }, [showToast]);

  useEffect(() => {
    mountedRef.current = true;
    const saver = createNoteAutosaver({
      debounceMs: 1000,
      mergePayload: mergeQueuedMovementNotePayload,
      isCurrent: captureAccountScope(),
      save: async (workoutId, serialized, exerciseId) => {
        const noteKey = `${workoutId}:${exerciseId}`;
        if (mountedRef.current) setSavingMovementNoteKey(noteKey);
        try {
          await updateWorkoutNotes(workoutId, serialized);
        } catch {
          // the draft stays in place, so the next edit or blur retries
          if (mountedRef.current) {
            setSavingMovementNoteKey(null);
            showToast('Note not saved');
          }
          return false;
        }

        if (!mountedRef.current) return true;
        setMonthWorkouts((prev) => prev.map((workout) => (
          workout.id === workoutId ? { ...workout, notes: serialized } : workout
        )));
        setSavingMovementNoteKey(null);
        setSavedMovementNoteKey(noteKey);
        window.setTimeout(() => {
          setSavedMovementNoteKey((current) => (current === noteKey ? null : current));
        }, 1200);
        return true;
      },
      onSaved: (workoutId, payload) => {
        dirtyMovementNotesRef.current[workoutId] = remainingMovementNoteDrafts(
          dirtyMovementNotesRef.current[workoutId] ?? {},
          parseWorkoutNotes(payload).movementNotes,
        );
      },
    });
    noteSaverRef.current = saver;

    // leaving the app or the page saves a note still waiting in its debounce
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flushAll();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      void saver.flushAll();
    };
  }, [showToast, updateWorkoutNotes, userId]);

  // Serializes a workout's notes from the refs when the save fires. A workout
  // no longer loaded (the month changed) has nothing to save, so its server
  // notes are never overwritten with an empty payload.
  const buildNotesPayload = useCallback((workoutId: string) => () => {
    const movementNotes = movementNotesRef.current[workoutId];
    if (!movementNotes) return null;
    return serializeWorkoutNotes(movementNotes, legacyNotesRef.current[workoutId] || null);
  }, []);

  const fetchMonthWorkouts = useCallback(async (month: Date) => {
    const requestId = ++monthRequestRef.current;
    const isStale = () => requestId !== monthRequestRef.current;
    setLoading(true);
    try {
      // The store fetchers already return [] when nobody is signed in.
      const [workouts, activities] = await Promise.all([
        fetchWorkoutsByMonth(month),
        fetchActivitySessionsByMonth(month),
      ]);
      if (isStale()) return;
      const splitDayIds = workouts.filter((workout) => workout.split_day_id).map((workout) => workout.split_day_id as string);
      const uniqueSplitDayIds = [...new Set(splitDayIds)];
      const flexibleWorkoutIds = workouts
        .filter((workout) => workout.split_day_id === null)
        .map((workout) => workout.id);

      // The two label lookups are independent, so they run together; an empty
      // id list makes no request.
      const [splitDayResult, planResult] = await Promise.all([
        uniqueSplitDayIds.length > 0
          ? supabase.from('split_days').select('id, day_name').in('id', uniqueSplitDayIds)
          : Promise.resolve({ data: null }),
        flexibleWorkoutIds.length > 0
          ? supabase.from('workout_day_plans').select('workout_id, day_label').in('workout_id', flexibleWorkoutIds)
          : Promise.resolve({ data: null }),
      ]);
      if (isStale()) return;

      const splitDays: { id: string; day_name: string }[] = splitDayResult.data || [];
      const splitDayMap = new Map(splitDays.map((splitDay) => [splitDay.id, splitDay.day_name]));
      const planRows: { workout_id: string; day_label: string }[] = planResult.data || [];
      const workoutPlanLabels = new Map(planRows.map((plan) => [plan.workout_id, plan.day_label]));

      const workoutsWithSplit: WorkoutWithSplit[] = workouts.map((workout) => ({
        ...workout,
        split_day: workout.split_day_id ? { day_name: splitDayMap.get(workout.split_day_id) || 'Unknown' } : null,
        day_label: workoutPlanLabels.get(workout.id) || null,
      }));

      setMonthWorkouts(workoutsWithSplit);
      setMonthActivities(activities);

      const notesByWorkout: Record<string, Record<string, string>> = {};
      const legacyByWorkout: Record<string, string | null> = {};
      workoutsWithSplit.forEach((workout) => {
        const parsed = parseWorkoutNotes(workout.notes || null);
        notesByWorkout[workout.id] = mergeMovementNoteDrafts(parsed.movementNotes, dirtyMovementNotesRef.current[workout.id] ?? {});
        legacyByWorkout[workout.id] = parsed.legacyNote;
        noteSaverRef.current?.markPersisted(workout.id, serializeWorkoutNotes(parsed.movementNotes, parsed.legacyNote));
      });

      setMovementNotesByWorkout(notesByWorkout);
      setLegacyNotesByWorkout(legacyByWorkout);
    } catch (error) {
      if (isStale()) return;
      console.error('Error fetching month workouts:', error);
    }

    if (isStale()) return;
    setLoading(false);
  }, [fetchActivitySessionsByMonth, fetchWorkoutsByMonth]);

  useEffect(() => {
    void fetchWhoopConnection();
  }, [fetchWhoopConnection]);

  const selectedDateKey = getDateKey(selectedDate);
  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);
  const todayStart = startOfDay(new Date());
  // sandbox always offers sync (fixture transport); production needs a connection
  const syncAvailable = isPreviewActive() || !!whoopConnection;

  const selectedDayWorkouts = useMemo(() => {
    return monthWorkouts
      .filter((workout) => (getWorkoutStartDateKey(workout) || workout.date) === selectedDateKey)
      .sort((a, b) => new Date(a.created_at || `${a.date}T00:00:00`).getTime() - new Date(b.created_at || `${b.date}T00:00:00`).getTime());
  }, [monthWorkouts, selectedDateKey]);

  // Attaching is a two-list operation: the workout gains the stats and the
  // activity leaves the day. Doing it in the parent is what makes it stick -
  // the panel previously kept its own copy of the workout, which a re-render
  // overwrote, so the stats appeared for a moment and then vanished.
  const selectedDayActivities = useMemo(() => {
    return sortActivitySessionsByStart(
      monthActivities.filter((activity) => getActivitySessionDateKey(activity) === selectedDateKey)
    );
  }, [monthActivities, selectedDateKey]);

  // Best-effort "closest match" hint. Never required - selection is manual -
  // so a poor overlap simply means no hint rather than no feature.
  const [whoopSuggestions, setWhoopSuggestions] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const next: Record<string, string> = {};
    for (const workout of selectedDayWorkouts) {
      const found = searchWhoopForWorkout(workout, selectedDayActivities);
      if (found.match) next[workout.id] = found.match.session.id;
    }
    if (!cancelled) setWhoopSuggestions(next);
    return () => { cancelled = true; };
  }, [selectedDayWorkouts, selectedDayActivities]);

  const handleAttachActivity = useCallback(async (workout: Workout, session: ActivitySession) => {
    const updated = await attachWhoopToWorkout(workout, session);
    if (!updated) throw new Error('Could not attach that activity.');
    setMonthWorkouts((prev) => prev.map((entry) => (
      entry.id === updated.id ? { ...entry, ...updated } as WorkoutWithSplit : entry
    )));
    // it is tombstoned server-side; drop it from the day so it stops showing
    setMonthActivities((prev) => prev.filter((entry) => entry.id !== session.id));
  }, [attachWhoopToWorkout]);

  const handleDetachActivity = useCallback(async (workout: Workout) => {
    const sessionId = workout.whoop_session_id ?? null;
    const updated = await detachWhoopFromWorkout(workout);
    if (!updated) throw new Error('Could not remove those stats.');
    setMonthWorkouts((prev) => prev.map((entry) => (
      entry.id === updated.id ? { ...entry, ...updated } as WorkoutWithSplit : entry
    )));
    // the session is un-tombstoned server-side; bring it back into the day
    if (sessionId) await fetchMonthWorkouts(selectedMonthRef.current);
  }, [detachWhoopFromWorkout, fetchMonthWorkouts]);


  // merge mode: pick same-day activities WHOOP recorded as separate records
  const [mergeSelection, setMergeSelection] = useState<string[] | null>(null);
  const [merging, setMerging] = useState(false);

  // leaving the day cancels a half-made selection
  useEffect(() => { setMergeSelection(null); }, [selectedDateKey]);

  const handleMergeActivities = useCallback(async () => {
    if (!mergeSelection || mergeSelection.length < 2 || merging) return;
    const chosen = selectedDayActivities.filter((activity) => mergeSelection.includes(activity.id));
    if (chosen.length < 2) return;

    setMerging(true);
    try {
      const merged = await mergeActivitySessions(chosen);
      if (!merged) return;
      const absorbed = new Set(chosen.map((activity) => activity.id).filter((id) => id !== merged.id));
      setMonthActivities((prev) => prev
        .filter((activity) => !absorbed.has(activity.id))
        .map((activity) => (activity.id === merged.id ? merged : activity)));
      setMergeSelection(null);
      showSavedToast();
    } catch (error) {
      console.error('Error merging activities:', error);
    } finally {
      setMerging(false);
    }
  }, [mergeSelection, merging, selectedDayActivities, mergeActivitySessions, showSavedToast]);

  // lazily load split segments for the selected day's activities, once per session
  const requestedSegmentIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = selectedDayActivities
      .map((activity) => activity.id)
      .filter((id) => !requestedSegmentIdsRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => requestedSegmentIdsRef.current.add(id));
    // A failed load forgets the request so revisiting the day tries again.
    const forgetRequest = () => {
      missing.forEach((id) => requestedSegmentIdsRef.current.delete(id));
    };
    void fetchActivitySegmentsBySessionIds(missing).then((segments) => {
      if (!segments) {
        forgetRequest();
        return;
      }
      const grouped: Record<string, ActivitySegment[]> = {};
      segments.forEach((segment) => {
        if (!segment.session_id) return;
        (grouped[segment.session_id] ||= []).push(segment);
      });
      setSegmentsBySession((prev) => {
        const next = { ...prev };
        // replace rather than append so overlapping loads never double splits
        missing.forEach((id) => {
          next[id] = grouped[id] ?? [];
        });
        return next;
      });
    }).catch((error) => {
      console.error('Error loading activity splits:', error);
      forgetRequest();
    });
  }, [selectedDayActivities, fetchActivitySegmentsBySessionIds]);

  const workoutsByDay = useMemo(() => {
    return monthWorkouts.reduce<Record<string, WorkoutWithSplit[]>>((acc, workout) => {
      const dateKey = getWorkoutStartDateKey(workout) || workout.date;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(workout);
      return acc;
    }, {});
  }, [monthWorkouts]);

  const activitiesByDay = useMemo(() => {
    return monthActivities.reduce<Record<string, ActivitySession[]>>((acc, activity) => {
      const dateKey = getActivitySessionDateKey(activity);
      if (!dateKey) return acc;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(activity);
      return acc;
    }, {});
  }, [monthActivities]);

  const selectedDaySummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedDayWorkouts.length > 0) {
      parts.push(`${selectedDayWorkouts.length} lift${selectedDayWorkouts.length !== 1 ? 's' : ''}`);
    }
    if (selectedDayActivities.length > 0) {
      parts.push(`${selectedDayActivities.length} activit${selectedDayActivities.length !== 1 ? 'ies' : 'y'}`);
    }
    return parts.length > 0 ? parts.join(' · ') : '0 sessions';
  }, [selectedDayActivities.length, selectedDayWorkouts.length]);

  const refreshWorkout = useCallback(async (workoutId: string, syncCompletion = true) => {
    let completionError: unknown;
    if (syncCompletion) {
      try {
        await syncWorkoutCompletion(workoutId);
      } catch (error) {
        completionError = error;
      }
    }

    const [workout, plan] = await Promise.all([
      fetchWorkoutById(workoutId),
      fetchWorkoutDayPlanByWorkoutId(workoutId),
    ]);

    if (!workout) return;

    setMonthWorkouts((prev) => prev.map((item) => {
      if (item.id !== workoutId) return item;
      return {
        ...(workout as WorkoutWithSplit),
        split_day: item.split_day,
        day_label: plan?.day_label ?? item.day_label ?? null,
      };
    }));

    setWorkoutPlans((prev) => ({ ...prev, [workoutId]: plan || null }));

    const parsed = parseWorkoutNotes(workout.notes || null);
    noteSaverRef.current?.markPersisted(workoutId, serializeWorkoutNotes(parsed.movementNotes, parsed.legacyNote));
    setMovementNotesByWorkout((prev) => ({
      ...prev,
      [workoutId]: mergeMovementNoteDrafts(parsed.movementNotes, dirtyMovementNotesRef.current[workoutId] ?? {}),
    }));
    setLegacyNotesByWorkout((prev) => ({ ...prev, [workoutId]: parsed.legacyNote }));
    if (completionError) throw completionError;
  }, [fetchWorkoutById, fetchWorkoutDayPlanByWorkoutId, syncWorkoutCompletion]);

  // Never rejects: a failed edit says so, and the workout is refreshed either
  // way so the screen shows what the server really holds (a partial failure
  // can leave a delete applied but not its follow-up).
  const runMutation = useCallback(async (workoutId: string, mutate: () => Promise<void>): Promise<boolean> => {
    const saved = await runWorkoutEdit(
      () => noteSaverRef.current ? noteSaverRef.current.runAfterFlush(workoutId, mutate) : mutate(),
      (syncCompletion) => refreshWorkout(workoutId, syncCompletion),
    );
    if (!saved) {
      showToast('Could not save');
    } else {
      showSavedToast();
    }
    return saved;
  }, [refreshWorkout, showSavedToast, showToast]);

  const loadPlanIfExists = useCallback(async (workoutId: string) => {
    if (Object.prototype.hasOwnProperty.call(workoutPlans, workoutId)) return;
    const plan = await fetchWorkoutDayPlanByWorkoutId(workoutId);
    setWorkoutPlans((prev) => ({ ...prev, [workoutId]: plan || null }));
    if (plan?.day_label) {
      setMonthWorkouts((prev) => prev.map((workout) => (
        workout.id === workoutId ? { ...workout, day_label: plan.day_label } : workout
      )));
    }
  }, [fetchWorkoutDayPlanByWorkoutId, workoutPlans]);

  const handleMovementNoteChange = useCallback((workoutId: string, exerciseId: string, value: string) => {
    const bounded = value.slice(0, 200);
    dirtyMovementNotesRef.current[workoutId] = {
      ...dirtyMovementNotesRef.current[workoutId], [exerciseId]: bounded,
    };
    // Keep refs current synchronously; a blur/unmount can flush before React
    // runs the effect that mirrors state back into these refs.
    const next = {
      ...movementNotesRef.current,
      [workoutId]: { ...movementNotesRef.current[workoutId], [exerciseId]: bounded },
    };
    movementNotesRef.current = next;
    setMovementNotesByWorkout(next);

    noteSaverRef.current?.schedule(workoutId, exerciseId, buildNotesPayload(workoutId));
  }, [buildNotesPayload]);

  const handleMovementNoteBlur = useCallback((workoutId: string, exerciseId: string) => {
    // an unchanged note sends nothing and shows no 'Saved'
    void noteSaverRef.current?.saveNow(workoutId, exerciseId, buildNotesPayload(workoutId));
  }, [buildNotesPayload]);

  useEffect(() => {
    // Save any note still waiting in its debounce before the new month's data
    // replaces the note maps; the payload is built from them synchronously.
    void noteSaverRef.current?.flushAll();

    const timer = setTimeout(() => {
      void fetchMonthWorkouts(selectedMonth);
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchMonthWorkouts, selectedMonth]);

  const handleDeleteWorkout = async (workoutId: string) => {
    try {
      await deleteWorkout(workoutId);
      setMonthWorkouts((prev) => prev.filter((workout) => workout.id !== workoutId));
      setWorkoutPlans((prev) => {
        const next = { ...prev };
        delete next[workoutId];
        return next;
      });
      setShowDeleteConfirm(null);
      showSavedToast();
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  const handleSyncWhoop = useCallback(async () => {
    if (syncingWhoop) return;
    const runWhoop = isPreviewActive() || !!whoopConnection;

    setSyncingWhoop(true);
    try {
      if (!runWhoop) {
        showToast('Sync unavailable');
        return;
      }

      const whoop = await syncWhoop();
      if (!whoop) {
        showToast('Sync unavailable');
        return;
      }

      // imported segments may belong to already-rendered sessions: reload both
      requestedSegmentIdsRef.current.clear();
      setSegmentsBySession({});
      await fetchMonthWorkouts(selectedMonthRef.current);

      const changes = whoop.created + whoop.updated;
      showToast(changes > 0 ? `Synced · ${whoop.created} new · ${whoop.updated} updated` : 'Up to date');
    } catch (error) {
      console.error('Error syncing activities:', error);
      showToast('Sync failed');
    } finally {
      setSyncingWhoop(false);
    }
  }, [fetchMonthWorkouts, showToast, syncWhoop, syncingWhoop, whoopConnection]);

  const handleSaveActivity = useCallback(async (input: ActivitySessionInput) => {
    if (!activityEditor) return;

    const editing = activityEditor.activity;
    // manual edits to an auto-grouped import must survive future re-syncs
    const guardedInput: ActivitySessionInput =
      editing && editing.source === 'whoop' && editing.auto_grouped
        ? { ...input, user_edited: true }
        : input;

    setSavingActivity(true);
    try {
      const saved = editing
        ? await updateActivitySession(editing.id, guardedInput)
        : await createActivitySession(guardedInput);

      if (!saved) return;

      setMonthActivities((prev) => {
        const withoutSaved = prev.filter((activity) => activity.id !== saved.id);
        return isDateKeyInMonth(saved.date, selectedMonth)
          ? [...withoutSaved, saved]
          : withoutSaved;
      });
      setSelectedDate(parseDateKey(saved.date));
      setActivityEditor(null);
      showSavedToast();
    } catch (error) {
      console.error('Error saving activity session:', error);
    } finally {
      setSavingActivity(false);
    }
  }, [activityEditor, createActivitySession, selectedMonth, showSavedToast, updateActivitySession]);

  const handleDeleteActivity = useCallback(async (activity: ActivitySession) => {
    try {
      // soft-dismiss anything WHOOP knows about: hard-deleting a session whose
      // segments came from (or were enriched by) WHOOP orphans those segments
      // (ON DELETE SET NULL) and the next sync resurrects the workout. The
      // dismissed_at tombstone keeps segments attached so re-sync relinks
      // instead of recreating.
      const needsTombstone = activity.source === 'whoop'
        || await hasLinkedWhoopSegments(activity.id);
      if (needsTombstone) {
        // updateActivitySession returns null on failure (it does not throw), so
        // check it — otherwise a failed tombstone still removes the row from the
        // UI and shows "saved", and the activity reappears on the next sync.
        const tombstoned = await updateActivitySession(activity.id, { dismissed_at: new Date().toISOString() });
        if (!tombstoned) {
          console.error('Failed to dismiss activity session:', activity.id);
          return;
        }
      } else {
        await deleteActivitySession(activity.id);
      }
      setMonthActivities((prev) => prev.filter((entry) => entry.id !== activity.id));
      setShowActivityDeleteConfirm(null);
      setActivityEditor(null);
      showSavedToast();
    } catch (error) {
      console.error('Error deleting activity session:', error);
    }
  }, [deleteActivitySession, hasLinkedWhoopSegments, showSavedToast, updateActivitySession]);

  const handleUpdateSet = async (workoutSet: WorkoutSet, updates: { weight: number | null; reps: number | null; rpe: number | null }) => {
    const completed = updates.weight !== null && updates.reps !== null;
    const workout = monthWorkouts.find((entry) => entry.id === workoutSet.workout_id);

    const saved = await runMutation(workoutSet.workout_id, async () => {
      await updateSet(workoutSet.id, {
        weight: updates.weight,
        reps: updates.reps,
        rpe: updates.rpe,
        completed,
        completed_at: resolveEditedSetCompletedAt({
          completed,
          existingSetCompletedAt: workoutSet.completed_at,
          workoutCompletedAt: workout?.completed_at,
        }),
      });
    });

    // keep the typed values in the open editor so a failed save can be retried
    if (saved) setEditingSet(null);
  };

  const handleAddSet = async (workoutId: string, exerciseId: string) => {
    await runMutation(workoutId, async () => {
      const created = await addSetToWorkout(workoutId, exerciseId);
      if (!created) throw new Error('Could not add that set.');
    });
  };

  const handleRemoveSet = async (workoutId: string, exerciseId: string, setId: string) => {
    await runMutation(workoutId, async () => {
      await removeSetFromWorkout(workoutId, exerciseId, setId);
    });
  };

  const handleRemoveExercise = async (workoutId: string, exerciseId: string) => {
    await runMutation(workoutId, async () => {
      await removeExerciseFromWorkout(workoutId, exerciseId);

      setMovementNotesByWorkout((prev) => {
        const current = { ...(prev[workoutId] || {}) };
        delete current[exerciseId];
        return {
          ...prev,
          [workoutId]: current,
        };
      });

      noteSaverRef.current?.cancel(workoutId, exerciseId);
    });
  };

  const handleTargetSetBlur = async (workoutId: string, exerciseId: string) => {
    const draftKey = `${workoutId}:${exerciseId}`;
    const draftValue = targetSetDrafts[draftKey];

    if (typeof draftValue !== 'string') return;

    const parsed = Number.parseInt(draftValue, 10);
    if (!Number.isFinite(parsed)) {
      setTargetSetDrafts((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      return;
    }

    const bounded = Math.max(1, Math.min(12, parsed));
    // Reconcile even when the target already matches: a previous attempt may
    // have saved the plan but failed to insert/delete its sets.
    const saved = await runMutation(workoutId, async () => {
      await updateWorkoutExerciseTargetSets(workoutId, exerciseId, bounded);
    });
    if (!saved) return;

    setTargetSetDrafts((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  };

  const handleToggleWorkout = async (workout: WorkoutWithSplit) => {
    const next = expandedWorkout === workout.id ? null : workout.id;
    setExpandedWorkout(next);
    if (next) {
      await loadPlanIfExists(workout.id);
    }
  };

  return (
    <motion.div className="px-6 pt-7 pb-nav">
      <Toast show={showSuccess} message={toastMessage} />

      <PageHeader back={{ label: 'Today', to: '/' }} eyebrow="Training ledger" title="History" className="mb-2" />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle}>
        <section aria-label="Calendar" className="pt-2">
          <CalendarHeader
            className="mb-1"
            label={calendarMonthLabel(selectedMonth)}
            ariaLabel={format(selectedMonth, 'MMMM yyyy')}
            direction={monthDirection}
            previous={{ label: 'Previous month', onClick: () => { setMonthDirection(-1); setSelectedMonth((prev) => subMonths(prev, 1)); } }}
            next={{ label: 'Next month', onClick: () => { setMonthDirection(1); setSelectedMonth((prev) => addMonths(prev, 1)); } }}
          />

          <div className="grid grid-cols-7" aria-hidden>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={`${day}-${index}`} className="calendar-weekday">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const dayWorkouts = workoutsByDay[key] || [];
              const dayActivities = sortActivitySessionsByStart(activitiesByDay[key] || []);
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const isTodayDate = isToday(day);
              // Days still to come read lighter than days on record.
              const isFutureDate = day > todayStart;
              const workoutTitles = dayWorkouts.map((workout) => resolveWorkoutTitle({
                splitDayName: workout.split_day?.day_name,
                dayLabel: workout.day_label || null,
                exerciseNames: workout.sets.map((set) => set.exercise?.name || null),
              }));
              const activityTitles = dayActivities.map((activity) => resolveActivityTitle(activity));
              const titleLabel = [...workoutTitles, ...activityTitles].join(', ');

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day);
                    if (!isSameMonth(day, selectedMonth)) {
                      setSelectedMonth(startOfMonth(day));
                    }
                  }}
                  aria-label={`${format(day, 'EEEE, MMMM d')}${isTodayDate ? ', today' : ''}${titleLabel ? ` · ${titleLabel}` : ''}`}
                  aria-pressed={isSelected}
                  className={`ledger-day ${inMonth ? '' : 'opacity-35'}`}
                >
                  {isSelected && (
                    <motion.span
                      aria-hidden
                      className="ledger-day-disc"
                      layoutId="history-day-selected"
                      transition={springs.settle}
                    />
                  )}
                  <span
                    className={`ledger-day-number ${
                      isTodayDate ? 'text-[var(--color-accent)] font-semibold' : isFutureDate && !isSelected ? 'ledger-day-future' : 'text-[var(--color-text)]'
                    } ${isSelected ? 'font-semibold' : ''}`}
                  >
                    {format(day, 'd')}
                  </span>
                  {(dayWorkouts.length > 0 || dayActivities.length > 0) && (
                    <span aria-hidden className="ledger-day-marks">
                      {dayWorkouts.length > 0 && <span className="ledger-mark-lift" />}
                      {dayActivities.length > 0 && <span className="ledger-mark-activity" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-4 t-caption text-[var(--color-muted)]" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="ledger-mark-lift" />Lift</span>
            <span className="inline-flex items-center gap-1.5"><span className="ledger-mark-activity" />Activity</span>
          </div>
        </section>
      </motion.div>

      {loading ? (
        <div className="platter mt-7 space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="shimmer h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="shimmer h-3.5 w-1/2" />
                <div className="shimmer h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle}>
          {/* One caps eyebrow; the day's count reads as plain text under it,
              sharing its line with the day's actions. */}
          <span className="t-label block mt-9">{format(selectedDate, 'EEEE, MMM d')}</span>
          <div className="flex items-center justify-between gap-3 -mt-1.5 mb-1.5">
            <p className="t-caption min-w-0">{selectedDaySummary}</p>
            <div className="flex items-center shrink-0 -mr-2.5">
              {/* Sync says what it does: a labelled text action beside Add activity. */}
              {syncAvailable && (
                <button
                  type="button"
                  className="text-action"
                  aria-label={syncingWhoop ? 'Syncing WHOOP' : 'Sync WHOOP'}
                  disabled={syncingWhoop}
                  onClick={() => { void handleSyncWhoop(); }}
                >
                  {syncingWhoop ? 'Syncing…' : 'Sync WHOOP'}
                </button>
              )}
              <button
                type="button"
                className="text-action"
                onClick={() => setActivityEditor({ activity: null, defaultDate: selectedDate })}
              >
                <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden />
                Add activity
              </button>
            </div>
          </div>

          {selectedDayWorkouts.length === 0 && selectedDayActivities.length === 0 ? (
            <div className="platter py-10 text-center">
              <p className="t-display text-[1.25rem] text-[var(--color-text-dim)]">No sessions recorded.</p>
            </div>
          ) : (
            <>
              {selectedDayWorkouts.map((workout, workoutIndex) => {
              const isExpanded = expandedWorkout === workout.id;
              const groupedSets = groupSetsByExercise(workout.sets);
              const plan = workoutPlans[workout.id] || null;
              const progress = progressFromSets(workout.sets);
              const resolvedTitle = resolveWorkoutTitle({
                splitDayName: workout.split_day?.day_name,
                dayLabel: workout.day_label || plan?.day_label || null,
                exerciseNames: workout.sets.map((set) => set.exercise?.name || null),
              });
              const durationLabel = formatWorkoutDuration(getWorkoutDurationMs(workout));
              const subtitle = durationLabel === '—'
                ? `${progress.completedSets}/${progress.totalSets} sets`
                : `${durationLabel} · ${progress.completedSets}/${progress.totalSets} sets`;

              const plannedVisible = plan
                ? plan.items.filter((item) => !item.hidden).sort((a, b) => a.order - b.order)
                : [];

              const plannedIds = plannedVisible.map((item) => item.exercise_id);
              const groupedIds = Object.keys(groupedSets);
              const orderedExerciseIds = [
                ...plannedIds.filter((exerciseId) => groupedIds.includes(exerciseId)),
                ...groupedIds.filter((exerciseId) => !plannedIds.includes(exerciseId)),
              ];

              const planByExercise = new Map<string, FlexiblePlanItem>(
                plannedVisible.map((item) => [item.exercise_id, item])
              );

              const supersetByExercise = new Map<string, string>();
              plannedVisible.forEach((item) => {
                if (item.superset_group_id) {
                  supersetByExercise.set(item.exercise_id, item.superset_group_id);
                }
              });

              const supersetPartnerByExercise = new Map<string, string>();
              const groupedBySuperset = new Map<string, string[]>();
              plannedVisible.forEach((item) => {
                if (!item.superset_group_id) return;
                const current = groupedBySuperset.get(item.superset_group_id) || [];
                current.push(item.exercise_id);
                groupedBySuperset.set(item.superset_group_id, current);
              });

              groupedBySuperset.forEach((exerciseIds) => {
                if (exerciseIds.length !== 2) return;
                supersetPartnerByExercise.set(exerciseIds[0], exerciseIds[1]);
                supersetPartnerByExercise.set(exerciseIds[1], exerciseIds[0]);
              });

              return (
                <motion.div
                  key={workout.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: workoutIndex * 0.06, ...springs.settle }}
                  className={`platter platter-flush ${workoutIndex > 0 ? 'mt-3' : ''}`}
                >
                  <div>
                    <button type="button" aria-expanded={isExpanded} aria-label={`View ${resolvedTitle} workout`} className="pressable w-full text-left flex items-center justify-between gap-3 px-5 py-4 min-h-[76px]" onClick={() => { void handleToggleWorkout(workout); }}>
                      <div className="min-w-0">
                        <p className="t-heading text-[var(--color-text)] break-words">{resolvedTitle}</p>
                        <p className="t-caption mt-1">
                          {!workout.completed && (
                            <span className="text-[var(--color-accent)]">In progress · </span>
                          )}
                          {subtitle}
                        </p>
                      </div>
                      {/* Sets read inline in the subtitle ("3/9 sets"); the ring is
                          kept for Today's live session. */}
                      <motion.div className="trail-disclosure shrink-0" animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile}>
                        <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                      </motion.div>
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
                          <div className="ledger-rule mx-5" />
                          <WorkoutActivityPanel
                            workout={workout}
                            dayActivities={selectedDayActivities}
                            suggestedId={whoopSuggestions[workout.id] ?? null}
                            onAttach={handleAttachActivity}
                            onDetach={handleDetachActivity}
                          />
                          <div className="ledger-rule mx-5" />
                          <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
                            <p className="t-label">Exercises</p>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setPickerState({
                                  workoutId: workout.id,
                                  baseExerciseId: null,
                                  excludeExerciseIds: orderedExerciseIds,
                                });
                              }}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add Exercise
                            </Button>
                          </div>

                          {orderedExerciseIds.map((exerciseId, exIndex) => {
                            const sets = groupedSets[exerciseId] || [];
                            const firstSet = sets[0];
                            const exerciseName = planByExercise.get(exerciseId)?.exercise_name
                              || (firstSet?.exercise as { name?: string } | undefined)?.name
                              || 'Unknown Exercise';

                            const expandedExerciseKey = `${workout.id}:${exerciseId}`;
                            const isExerciseExpanded = expandedExercise === expandedExerciseKey;
                            const exerciseProgress = progressFromSets(sets);
                            const planItem = planByExercise.get(exerciseId);
                            const currentTargetSets = Math.max(1, Math.min(12, planItem?.target_sets || sets.length || 1));
                            const targetDraftKey = `${workout.id}:${exerciseId}`;
                            const targetDraft = targetSetDrafts[targetDraftKey];
                            const targetInputValue = typeof targetDraft === 'string' ? targetDraft : String(currentTargetSets);
                            // A program's set-range tag rides in plan notes; it is never a note to show.
                            const movementNote = movementNotesByWorkout[workout.id]?.[exerciseId]
                              || parseSetRangeNotes(planItem?.notes, 1).baseNotes || '';
                            const substitutedFor = planItem?.substitutes_for ?? null;
                            const noteCharacterCount = movementNote.length;
                            const hasMovementNote = movementNote.trim().length > 0;
                            const supersetGroupId = supersetByExercise.get(exerciseId) || null;
                            const supersetPartnerId = supersetPartnerByExercise.get(exerciseId) || null;
                            const supersetPartnerName = supersetPartnerId
                              ? (
                                  planByExercise.get(supersetPartnerId)?.exercise_name
                                  || (groupedSets[supersetPartnerId]?.[0]?.exercise as { name?: string } | undefined)?.name
                                  || 'Exercise'
                                )
                              : null;
                            const canMoveUp = exIndex > 0;
                            const canMoveDown = exIndex < orderedExerciseIds.length - 1;

                            return (
                              <motion.div
                                key={exerciseId}
                                className="platter-row px-5 pb-1"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: exIndex * 0.04, ...springs.settle }}
                              >
                                <div
                                  className="flex flex-wrap items-center justify-between pt-2.5"
                                >
                                  <button
                                    type="button"
                                    aria-expanded={isExerciseExpanded}
                                    onClick={() => setExpandedExercise(isExerciseExpanded ? null : expandedExerciseKey)}
                                    className="pressable flex items-center gap-3 min-w-0 w-full min-h-11 text-left"
                                  >
                                    <div
                                      className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-medium tabular-nums shrink-0 ${
                                        exerciseProgress.completed
                                          ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                                          : 'shadow-[inset_0_0_0_1px_var(--color-border)] text-[var(--color-muted)]'
                                      }`}
                                    >
                                      {exerciseProgress.completed ? <Check className="w-3.5 h-3.5" strokeWidth={2.25} /> : `${exerciseProgress.completedSets}/${exerciseProgress.totalSets}`}
                                    </div>
                                    <div className="min-w-0">
                                      <span className="t-body text-[var(--color-text)]">{exerciseName}</span>
                                      {substitutedFor && (
                                        <p className="t-caption mt-0.5">Instead of {substitutedFor.exercise_name ?? 'the planned exercise'}</p>
                                      )}
                                      {supersetGroupId && supersetPartnerName && (
                                        <p className="t-label-sm mt-0.5">Superset with {supersetPartnerName}</p>
                                      )}
                                      {hasMovementNote && !isExerciseExpanded && (
                                        <p className="t-caption mt-0.5 break-words max-w-[220px]">{movementNote}</p>
                                      )}
                                    </div>
                                  </button>

                                  <div className="flex items-center shrink-0 ml-auto -mr-3" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={!canMoveUp}
                                      aria-label={`Move ${exerciseName} earlier`}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex <= 0) return;
                                        [nextOrder[currentIndex - 1], nextOrder[currentIndex]] = [nextOrder[currentIndex], nextOrder[currentIndex - 1]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                    >
                                      <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!canMoveDown}
                                      aria-label={`Move ${exerciseName} later`}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex < 0 || currentIndex >= nextOrder.length - 1) return;
                                        [nextOrder[currentIndex], nextOrder[currentIndex + 1]] = [nextOrder[currentIndex + 1], nextOrder[currentIndex]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                    >
                                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                    {supersetGroupId ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void runMutation(workout.id, async () => {
                                            await clearWorkoutSuperset(workout.id, exerciseId);
                                          });
                                        }}
                                        className="studio-row-action p-1.5 text-[var(--color-text)] hover:text-[var(--color-text-dim)] transition-colors"
                                        title="Remove superset"
                                      >
                                        <Unlink2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPickerState({
                                            workoutId: workout.id,
                                            baseExerciseId: exerciseId,
                                            excludeExerciseIds: orderedExerciseIds,
                                          });
                                        }}
                                        className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                        title="Add superset"
                                      >
                                        <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { void handleRemoveExercise(workout.id, exerciseId); }}
                                      className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                      title="Remove exercise"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={isExerciseExpanded ? 'Collapse exercise' : 'Expand exercise'}
                                      aria-expanded={isExerciseExpanded}
                                      onClick={() => setExpandedExercise(isExerciseExpanded ? null : expandedExerciseKey)}
                                      className="studio-row-action"
                                    >
                                      <motion.span animate={{ rotate: isExerciseExpanded ? 180 : 0 }} transition={springs.tactile}>
                                        <ChevronDown className="w-3 h-3 text-[var(--color-muted)]" strokeWidth={1.5} />
                                      </motion.span>
                                    </button>
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {isExerciseExpanded && (
                                    <motion.div
                                      className="overflow-hidden"
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={springs.settle}
                                    >
                                      <div className="ledger-well ledger-sets mt-1 px-4">
                                      <div className="flex items-center justify-between gap-2 py-2.5">
                                        <p className="t-label-sm">Target Sets</p>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="number"
                                            min={1}
                                            max={12}
                                            value={targetInputValue}
                                            onChange={(event) => {
                                              setTargetSetDrafts((prev) => ({
                                                ...prev,
                                                [targetDraftKey]: event.target.value,
                                              }));
                                            }}
                                            onBlur={() => { void handleTargetSetBlur(workout.id, exerciseId); }}
                                            aria-label="Target sets"
                                            className="ledger-field w-14 min-h-11 px-2 py-1 t-data-sm text-[var(--color-text)] text-center focus:outline-none"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => { void handleAddSet(workout.id, exerciseId); }}
                                            className="studio-secondary-action px-3 t-label-sm text-[var(--color-text)]"
                                          >
                                            + Add Set
                                          </button>
                                        </div>
                                      </div>

                                      {sets.map((set) => (
                                        <motion.div
                                          key={set.id}
                                          className="flex items-center justify-between py-0.5"
                                          initial={{ opacity: 0, y: 4 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          transition={springs.settle}
                                        >
                                          <div className="flex items-baseline gap-3">
                                            <span className="t-data-sm text-[var(--color-muted)] w-10">{set.set_number.toString().padStart(2, '0')}</span>
                                            <span className="t-data text-[var(--color-text)]">
                                              {set.weight ?? '—'} <span className="text-[var(--color-muted)]">lb</span> × {set.reps ?? '—'}
                                              {set.rpe ? <span className="text-[var(--color-muted)]"> @ {set.rpe}</span> : ''}
                                            </span>
                                          </div>
                                          <div className="flex items-center -mr-3">
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingSet(set);
                                              }}
                                              aria-label={`Edit set ${set.set_number}`}
                                              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                              whileTap={{ scale: 0.985 }}
                                            >
                                              <Pencil className="w-3 h-3" strokeWidth={1.5} />
                                            </motion.button>
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void handleRemoveSet(workout.id, exerciseId, set.id);
                                              }}
                                              aria-label={`Remove set ${set.set_number}`}
                                              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                              whileTap={{ scale: 0.985 }}
                                            >
                                              <X className="w-3 h-3" strokeWidth={1.5} />
                                            </motion.button>
                                          </div>
                                        </motion.div>
                                      ))}
                                      </div>

                                      <div className="pt-4 pb-4">
                                        <label
                                          htmlFor={`history-note-${workout.id}-${exerciseId}`}
                                          className="t-label-sm block mb-2"
                                        >
                                          Movement Note
                                        </label>
                                        <textarea
                                          id={`history-note-${workout.id}-${exerciseId}`}
                                          value={movementNote}
                                          onChange={(event) => handleMovementNoteChange(workout.id, exerciseId, event.target.value)}
                                          onBlur={() => handleMovementNoteBlur(workout.id, exerciseId)}
                                          rows={2}
                                          maxLength={200}
                                          placeholder="Note - technique, feel, cues..."
                                          className="material-inset w-full rounded-[var(--radius-control)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-placeholder)] focus:outline-none transition-colors resize-none"
                                        />
                                        <div className="mt-2 flex items-center justify-between">
                                          <div>
                                            {savingMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="t-label-sm">Saving...</p>
                                            ) : savedMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="t-label-sm text-[var(--color-text)]">Saved</p>
                                            ) : null}
                                          </div>
                                          {noteCharacterCount >= 160 && (
                                            <p className="t-data-sm text-[var(--color-muted)]">{noteCharacterCount}/200</p>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}

                          <div className="px-5 pt-3 pb-5">
                            <motion.button
                              onClick={() => setShowDeleteConfirm(workout.id)}
                              className="w-full studio-row-action text-[var(--color-text-dim)] t-label hover:text-[var(--color-text)] transition-colors flex items-center justify-center gap-2"
                              whileTap={{ scale: 0.98 }}
                            >
                              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                              Delete session
                            </motion.button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
              {selectedDayActivities.length > 0 && (
                <div className={selectedDayWorkouts.length > 0 ? 'mt-7' : ''}>
                  {/* One header-to-first-row rhythm (Today, Fuel): the
                      header's 44px actions overhang its 28px line. */}
                  <div className="flex items-center justify-between gap-3 min-h-7">
                    <span className="t-label">
                      Activities <span className="text-[var(--color-muted)] tabular-nums ml-1">{selectedDayActivities.length}</span>
                    </span>
                    {selectedDayActivities.length > 1 && (
                      mergeSelection ? (
                        <div className="flex items-center shrink-0 -mr-2.5 -my-2">
                          <button
                            type="button"
                            className="text-action"
                            onClick={() => setMergeSelection(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={mergeSelection.length < 2 || merging}
                            className="text-action"
                            onClick={() => { void handleMergeActivities(); }}
                          >
                            {merging ? 'Merging…' : 'Merge'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-action -mr-2.5 -my-2"
                          onClick={() => setMergeSelection([])}
                        >
                          Merge activities
                        </button>
                      )
                    )}
                  </div>
                  {selectedDayActivities.length > 1 && mergeSelection && (
                    <p className="t-caption -mt-1 mb-1" aria-live="polite">
                      {mergeSelection.length < 2
                        ? 'Pick the activities that were really one'
                        : `${mergeSelection.length} selected`}
                    </p>
                  )}
                  <div className="platter platter-flush">
                  {selectedDayActivities.map((activity, activityIndex) => (
                    <motion.div
                      key={activity.id}
                      className="platter-row"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (selectedDayWorkouts.length + activityIndex) * 0.04, ...springs.settle }}
                    >
                      <ActivityLedgerRow
                        activity={activity}
                        selectable={mergeSelection != null}
                        selected={mergeSelection?.includes(activity.id) ?? false}
                        onToggleSelected={() => setMergeSelection((prev) => {
                          if (!prev) return prev;
                          return prev.includes(activity.id)
                            ? prev.filter((id) => id !== activity.id)
                            : [...prev, activity.id];
                        })}
                        segments={segmentsBySession[activity.id] || []}
                        expanded={expandedActivity === activity.id}
                        onToggleExpand={() => setExpandedActivity((prev) => (prev === activity.id ? null : activity.id))}
                        onEdit={() => setActivityEditor({ activity, defaultDate: parseDateKey(getActivitySessionDateKey(activity) || selectedDateKey) })}
                      />
                    </motion.div>
                  ))}
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      <Modal isOpen={!!editingSet} onClose={() => setEditingSet(null)} title="Edit set">
        {editingSet && (
          <SetEditor
            workoutSet={editingSet}
            onSave={(updates) => { void handleUpdateSet(editingSet, updates); }}
            onCancel={() => setEditingSet(null)}
          />
        )}
      </Modal>

      <Modal
        isOpen={!!activityEditor}
        onClose={() => setActivityEditor(null)}
        title={activityEditor?.activity ? 'Edit activity' : 'Add activity'}
      >
        {activityEditor && (
          <ActivityEditor
            key={activityEditor.activity?.id || format(activityEditor.defaultDate, 'yyyy-MM-dd')}
            activity={activityEditor.activity}
            defaultDate={activityEditor.defaultDate}
            customTypeSuggestions={customActivityTypeSuggestions(monthActivities)}
            saving={savingActivity}
            onSave={(input) => { void handleSaveActivity(input); }}
            onCancel={() => setActivityEditor(null)}
            onDelete={activityEditor.activity ? () => {
              const target = activityEditor.activity;
              setActivityEditor(null);
              setShowActivityDeleteConfirm(target);
            } : undefined}
          />
        )}
      </Modal>

      <Modal isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title="Delete session">
        <div className="space-y-5">
          <p className="t-body text-[var(--color-text-dim)]">
            Are you sure you want to delete this session? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => showDeleteConfirm && void handleDeleteWorkout(showDeleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!showActivityDeleteConfirm} onClose={() => setShowActivityDeleteConfirm(null)} title="Delete activity">
        <div className="space-y-5">
          <p className="t-body text-[var(--color-text-dim)]">
            Delete this activity from your calendar?
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setShowActivityDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => showActivityDeleteConfirm && void handleDeleteActivity(showActivityDeleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <ExercisePicker
        isOpen={Boolean(pickerState)}
        onClose={() => setPickerState(null)}
        onSelect={(exercise: Exercise) => {
          if (!pickerState) return;
          const { workoutId, baseExerciseId } = pickerState;
          setPickerState(null);

          if (baseExerciseId) {
            void runMutation(workoutId, async () => {
              await addSupersetToWorkout(workoutId, baseExerciseId, exercise);
            });
            return;
          }

          void runMutation(workoutId, async () => {
            const created = await addExerciseToWorkout(workoutId, exercise);
            if (!created) throw new Error('Could not add that exercise.');
          });
        }}
        excludeExerciseIds={pickerState?.excludeExerciseIds || []}
        title={pickerState?.baseExerciseId ? 'Add Superset Exercise' : 'Add Exercise'}
      />
    </motion.div>
  );
}
