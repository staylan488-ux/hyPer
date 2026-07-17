import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, Check, Plus, Link2, Unlink2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Modal, Button, Input, TickStrip, Toast, SelectSheet, DateField, TimeField } from '@/components/shared';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { isPreviewActive } from '@/preview/flag';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
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
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

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
  saving: boolean;
  onSave: (input: ActivitySessionInput) => void;
  onCancel: () => void;
}

interface ActivityLedgerRowProps {
  activity: ActivitySession;
  segments: ActivitySegment[];
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
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

function ActivityEditor({ activity, defaultDate, saving, onSave, onCancel }: ActivityEditorProps) {
  const [activityType, setActivityType] = useState<ActivityType>(activity?.activity_type || 'bike_ride');
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

      <Input
        label="Title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={ACTIVITY_TYPE_LABELS[activityType]}
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
          className="w-full bg-transparent border-b border-[var(--color-border-strong)] pb-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-text)] transition-colors resize-none"
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
    </div>
  );
}

function ActivityLedgerRow({ activity, segments, expanded, onToggleExpand, onEdit, onDelete }: ActivityLedgerRowProps) {
  // cross-source sessions carry enrichment segments (e.g. a WHOOP record
  // absorbed into a GPS run); the splits table shows only the primary
  // recording's laps — foreign-source segments contribute metrics, not rows
  const primarySegments = segments.filter((segment) => segment.source === activity.source);
  const title = resolveActivityTitle(activity);
  const typeLabel = ACTIVITY_TYPE_LABELS[activity.activity_type];
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

  return (
    <div className="border-t border-[var(--color-border)] py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-label-sm text-[9px]">Activity</p>
          <p className="mt-1 text-[13px] text-[var(--color-text)] truncate">{title}</p>
          <p className="t-data-sm text-[10px] text-[var(--color-muted)] mt-1">
            {subtitleParts.length > 0 ? subtitleParts.join(' • ') : typeLabel}
          </p>
          {metricsParts.length > 0 && (
            <p className="t-data-sm text-[10px] text-[var(--color-text-dim)] mt-1">
              {metricsParts.join(' • ')}
            </p>
          )}
          {activity.notes && (
            <p className="t-caption mt-2 line-clamp-2">{activity.notes}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {hasSplits && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              title={expanded ? 'Hide splits' : 'Show splits'}
            >
              {expanded
                ? <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                : <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            title="Edit activity"
          >
            <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-[var(--color-accent)] hover:text-[var(--color-accent-deep)] transition-colors"
            title="Delete activity"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {hasSplits && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={springs.smooth}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-[var(--color-border)] pt-2">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-label-sm text-[9px] pb-1">
                <span>#</span>
                <span>Time</span>
                <span>Dist</span>
                <span>Pace</span>
              </div>
              {primarySegments.map((segment, index) => (
                <div
                  key={segment.id}
                  className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-data-sm text-[11px] text-[var(--color-text-dim)] py-0.5"
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
    fetchActivitySegmentsBySessionIds,
    syncWhoop,
    whoopConnection,
    fetchWhoopConnection,
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

  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const movementNotesRef = useRef<Record<string, Record<string, string>>>({});
  const legacyNotesRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    movementNotesRef.current = movementNotesByWorkout;
  }, [movementNotesByWorkout]);

  useEffect(() => {
    legacyNotesRef.current = legacyNotesByWorkout;
  }, [legacyNotesByWorkout]);

  useEffect(() => {
    const timersRef = noteSaveTimersRef;
    return () => {
      Object.values(timersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setShowSuccess(true);
    window.setTimeout(() => setShowSuccess(false), 1500);
  }, []);

  const showSavedToast = useCallback(() => {
    showToast('Saved');
  }, [showToast]);

  const fetchMonthWorkouts = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMonthWorkouts([]);
        setMonthActivities([]);
        setLoading(false);
        return;
      }

      const [workouts, activities] = await Promise.all([
        fetchWorkoutsByMonth(month),
        fetchActivitySessionsByMonth(month),
      ]);
      const splitDayIds = workouts.filter((workout) => workout.split_day_id).map((workout) => workout.split_day_id as string);
      const uniqueSplitDayIds = [...new Set(splitDayIds)];

      let splitDays: { id: string; day_name: string }[] = [];
      if (uniqueSplitDayIds.length > 0) {
        const { data: splitDayData } = await supabase
          .from('split_days')
          .select('id, day_name')
          .in('id', uniqueSplitDayIds);
        splitDays = splitDayData || [];
      }

      const splitDayMap = new Map(splitDays.map((splitDay) => [splitDay.id, splitDay.day_name]));
      const flexibleWorkoutIds = workouts
        .filter((workout) => workout.split_day_id === null)
        .map((workout) => workout.id);

      let workoutPlanLabels = new Map<string, string>();
      if (flexibleWorkoutIds.length > 0) {
        const { data: planRows } = await supabase
          .from('workout_day_plans')
          .select('workout_id, day_label')
          .in('workout_id', flexibleWorkoutIds);

        workoutPlanLabels = new Map((planRows || []).map((plan) => [plan.workout_id, plan.day_label]));
      }

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
        notesByWorkout[workout.id] = parsed.movementNotes;
        legacyByWorkout[workout.id] = parsed.legacyNote;
      });

      setMovementNotesByWorkout(notesByWorkout);
      setLegacyNotesByWorkout(legacyByWorkout);
    } catch (error) {
      console.error('Error fetching month workouts:', error);
    }

    setLoading(false);
  }, [fetchActivitySessionsByMonth, fetchWorkoutsByMonth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMonthWorkouts(selectedMonth);
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchMonthWorkouts, selectedMonth]);

  useEffect(() => {
    void fetchWhoopConnection();
  }, [fetchWhoopConnection]);

  const selectedDateKey = getDateKey(selectedDate);
  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);
  // sandbox always offers sync (fixture transport); production needs a connection
  const syncAvailable = isPreviewActive() || !!whoopConnection;

  const selectedDayWorkouts = useMemo(() => {
    return monthWorkouts
      .filter((workout) => (getWorkoutStartDateKey(workout) || workout.date) === selectedDateKey)
      .sort((a, b) => new Date(a.created_at || `${a.date}T00:00:00`).getTime() - new Date(b.created_at || `${b.date}T00:00:00`).getTime());
  }, [monthWorkouts, selectedDateKey]);

  const selectedDayActivities = useMemo(() => {
    return sortActivitySessionsByStart(
      monthActivities.filter((activity) => getActivitySessionDateKey(activity) === selectedDateKey)
    );
  }, [monthActivities, selectedDateKey]);

  // lazily load split segments for the selected day's activities, once per session
  const requestedSegmentIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = selectedDayActivities
      .map((activity) => activity.id)
      .filter((id) => !requestedSegmentIdsRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => requestedSegmentIdsRef.current.add(id));
    void fetchActivitySegmentsBySessionIds(missing).then((segments) => {
      setSegmentsBySession((prev) => {
        const next = { ...prev };
        missing.forEach((id) => {
          if (!next[id]) next[id] = [];
        });
        segments.forEach((segment) => {
          if (!segment.session_id) return;
          next[segment.session_id] = [...(next[segment.session_id] || []), segment];
        });
        return next;
      });
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
    return parts.length > 0 ? parts.join(' • ') : '0 sessions';
  }, [selectedDayActivities.length, selectedDayWorkouts.length]);

  const refreshWorkout = useCallback(async (workoutId: string) => {
    await syncWorkoutCompletion(workoutId);

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
    setMovementNotesByWorkout((prev) => ({ ...prev, [workoutId]: parsed.movementNotes }));
    setLegacyNotesByWorkout((prev) => ({ ...prev, [workoutId]: parsed.legacyNote }));
  }, [fetchWorkoutById, fetchWorkoutDayPlanByWorkoutId, syncWorkoutCompletion]);

  const runMutation = useCallback(async (workoutId: string, mutate: () => Promise<void>) => {
    await mutate();
    await refreshWorkout(workoutId);
    showSavedToast();
  }, [refreshWorkout, showSavedToast]);

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

  const persistMovementNotes = useCallback(async (workoutId: string, exerciseId: string) => {
    const movementNotes = movementNotesRef.current[workoutId] || {};
    const legacyNote = legacyNotesRef.current[workoutId] || null;
    const serialized = serializeWorkoutNotes(movementNotes, legacyNote);

    setSavingMovementNoteKey(`${workoutId}:${exerciseId}`);
    await updateWorkoutNotes(workoutId, serialized);

    setMonthWorkouts((prev) => prev.map((workout) => (
      workout.id === workoutId ? { ...workout, notes: serialized } : workout
    )));

    setSavingMovementNoteKey(null);
    setSavedMovementNoteKey(`${workoutId}:${exerciseId}`);
    window.setTimeout(() => {
      setSavedMovementNoteKey((current) => (current === `${workoutId}:${exerciseId}` ? null : current));
    }, 1200);
  }, [updateWorkoutNotes]);

  const queueMovementNotePersist = useCallback((workoutId: string, exerciseId: string) => {
    const timerKey = `${workoutId}:${exerciseId}`;
    const existingTimer = noteSaveTimersRef.current[timerKey];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    noteSaveTimersRef.current[timerKey] = window.setTimeout(() => {
      delete noteSaveTimersRef.current[timerKey];
      void persistMovementNotes(workoutId, exerciseId);
    }, 1000);
  }, [persistMovementNotes]);

  const handleMovementNoteChange = useCallback((workoutId: string, exerciseId: string, value: string) => {
    const bounded = value.slice(0, 200);

    setMovementNotesByWorkout((prev) => {
      const currentWorkoutNotes = { ...(prev[workoutId] || {}) };

      if (bounded.trim()) {
        currentWorkoutNotes[exerciseId] = bounded;
      } else {
        delete currentWorkoutNotes[exerciseId];
      }

      return {
        ...prev,
        [workoutId]: currentWorkoutNotes,
      };
    });

    queueMovementNotePersist(workoutId, exerciseId);
  }, [queueMovementNotePersist]);

  const handleMovementNoteBlur = useCallback((workoutId: string, exerciseId: string) => {
    const timerKey = `${workoutId}:${exerciseId}`;
    const timerId = noteSaveTimersRef.current[timerKey];
    if (timerId) {
      window.clearTimeout(timerId);
      delete noteSaveTimersRef.current[timerKey];
    }

    void persistMovementNotes(workoutId, exerciseId);
  }, [persistMovementNotes]);

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
      await fetchMonthWorkouts(selectedMonth);

      const changes = whoop.created + whoop.updated;
      showToast(changes > 0 ? `Synced • ${whoop.created} new • ${whoop.updated} updated` : 'Up to date');
    } catch (error) {
      console.error('Error syncing activities:', error);
      showToast('Sync failed');
    } finally {
      setSyncingWhoop(false);
    }
  }, [fetchMonthWorkouts, selectedMonth, showToast, syncWhoop, syncingWhoop, whoopConnection]);

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
      if (activity.source === 'whoop' && activity.auto_grouped) {
        // soft-dismiss imports: the tombstone stops re-sync from resurrecting them
        await updateActivitySession(activity.id, { dismissed_at: new Date().toISOString() });
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
  }, [deleteActivitySession, showSavedToast, updateActivitySession]);

  const handleUpdateSet = async (workoutSet: WorkoutSet, updates: { weight: number | null; reps: number | null; rpe: number | null }) => {
    const completed = updates.weight !== null && updates.reps !== null;
    const workout = monthWorkouts.find((entry) => entry.id === workoutSet.workout_id);

    await runMutation(workoutSet.workout_id, async () => {
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

    setEditingSet(null);
  };

  const handleAddSet = async (workoutId: string, exerciseId: string) => {
    await runMutation(workoutId, async () => {
      await addSetToWorkout(workoutId, exerciseId);
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

      const timerKey = `${workoutId}:${exerciseId}`;
      const timerId = noteSaveTimersRef.current[timerKey];
      if (timerId) {
        window.clearTimeout(timerId);
        delete noteSaveTimersRef.current[timerKey];
      }
    });
  };

  const handleTargetSetBlur = async (workoutId: string, exerciseId: string, fallbackValue: number) => {
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
    if (bounded !== fallbackValue) {
      await runMutation(workoutId, async () => {
        await updateWorkoutExerciseTargetSets(workoutId, exerciseId, bounded);
      });
    }

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
    <motion.div className="px-5 pt-6 pb-nav">
      <Toast show={showSuccess} message={toastMessage} />

      <motion.header className="mb-7" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Training ledger</span>
          <span className="t-label-sm">{format(new Date(), 'yyyy')}</span>
        </div>
        <h1 className="t-title mt-3 pt-5 border-t border-[var(--color-text)]">History</h1>
      </motion.header>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="mb-9">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-[var(--color-border)]">
            <motion.button
              onClick={() => {
                setMonthDirection(-1);
                setSelectedMonth((prev) => subMonths(prev, 1));
              }}
              className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              whileTap={{ scale: 0.9, x: -2 }}
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>
            <AnimatePresence mode="wait">
              <motion.h3
                key={format(selectedMonth, 'yyyy-MM')}
                className="t-label"
                initial={{ opacity: 0, x: monthDirection * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: monthDirection * -20 }}
                transition={{ duration: 0.2 }}
              >
                {format(selectedMonth, 'MMMM yyyy')}
              </motion.h3>
            </AnimatePresence>
            <motion.button
              onClick={() => {
                setMonthDirection(1);
                setSelectedMonth((prev) => addMonths(prev, 1));
              }}
              className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              whileTap={{ scale: 0.9, x: 2 }}
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>
          </div>

          <div className="grid grid-cols-7">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={`${day}-${index}`} className="t-label-sm text-[9px] text-center pb-2">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-t border-l border-[var(--color-border)]">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const dayWorkouts = workoutsByDay[key] || [];
              const dayActivities = sortActivitySessionsByStart(activitiesByDay[key] || []);
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const isTodayDate = isToday(day);
              const firstWorkout = dayWorkouts[0] || null;
              const firstActivity = dayActivities[0] || null;
              const firstWorkoutTitle = firstWorkout
                ? resolveWorkoutTitle({
                    splitDayName: firstWorkout.split_day?.day_name,
                    dayLabel: firstWorkout.day_label || null,
                    exerciseNames: firstWorkout.sets.map((set) => set.exercise?.name || null),
                  })
                : '';
              const workoutSummaryLabel = dayWorkouts.length > 1
                ? `${firstWorkoutTitle} +${dayWorkouts.length - 1}`
                : firstWorkoutTitle;
              const firstActivityTitle = firstActivity ? resolveActivityTitle(firstActivity) : '';
              const activitySummaryLabel = dayActivities.length > 1
                ? `${firstActivityTitle} +${dayActivities.length - 1}`
                : firstActivityTitle;
              const daySummaryLabel = workoutSummaryLabel;
              const titleLabel = [workoutSummaryLabel, activitySummaryLabel].filter(Boolean).join(' / ');

              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedDate(day);
                    if (!isSameMonth(day, selectedMonth)) {
                      setSelectedMonth(startOfMonth(day));
                    }
                  }}
                  title={titleLabel || undefined}
                  className={`min-h-16 border-r border-b border-[var(--color-border)] transition-colors relative px-1.5 py-1.5 ${
                    isSelected
                      ? 'text-[var(--color-base)]'
                      : inMonth
                        ? 'text-[var(--color-text)] active:bg-[var(--color-surface-2)]'
                        : 'text-[var(--color-muted)] active:bg-[var(--color-surface-2)]'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      className="absolute inset-0 bg-[var(--color-text)]"
                      layoutId="history-day-selected"
                      transition={springs.smooth}
                    />
                  )}
                  {isTodayDate && !isSelected && (
                    <span className="absolute top-1.5 right-1.5 w-1 h-1 bg-[var(--color-accent)] z-10" />
                  )}
                  <div className="relative z-10 flex h-full flex-col items-start">
                    <span className={`t-data-sm text-[11px] ${isSelected ? 'font-semibold' : ''}`}>{format(day, 'd')}</span>
                    {daySummaryLabel && (
                      <span
                        className={`mt-1 line-clamp-2 text-left text-[8px] leading-tight font-sans ${
                          isSelected ? 'text-[color-mix(in_srgb,var(--color-base)_85%,transparent)]' : 'text-[var(--color-text-dim)]'
                        }`}
                      >
                        {daySummaryLabel}
                      </span>
                    )}
                  </div>
                  {(dayWorkouts.length > 0 || dayActivities.length > 0) && (
                    <motion.div
                      className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={springs.bouncy}
                    >
                      {dayWorkouts.length > 0 && (
                        <span
                          className={`w-1.5 h-1.5 ${
                            isSelected ? 'bg-[var(--color-base)]' : 'bg-[var(--color-text)]'
                          }`}
                        />
                      )}
                      {dayActivities.length > 0 && (
                        <span
                          className={`w-1.5 h-1.5 border ${
                            isSelected ? 'border-[var(--color-base)]' : 'border-[var(--color-text)]'
                          }`}
                        />
                      )}
                    </motion.div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="space-y-4 pt-8 border-t border-[var(--color-border)]">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="shimmer h-10 w-10" />
              <div className="flex-1 space-y-1.5">
                <div className="shimmer h-3.5 w-1/2" />
                <div className="shimmer h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="flex items-center justify-between gap-4 mb-4 pt-8 border-t border-[var(--color-border)]">
            <div>
              <span className="t-label">{format(selectedDate, 'EEEE, MMM d')}</span>
              <p className="t-label-sm mt-1">{selectedDaySummary}</p>
            </div>
            <div className="flex items-center gap-4">
              {syncAvailable && (
                <button
                  type="button"
                  className="pressable t-label-sm text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
                  disabled={syncingWhoop}
                  onClick={() => { void handleSyncWhoop(); }}
                >
                  {syncingWhoop ? 'Syncing…' : 'Sync'}
                </button>
              )}
              <button
                type="button"
                className="pressable t-label-sm text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => setActivityEditor({ activity: null, defaultDate: selectedDate })}
              >
                + Activity
              </button>
            </div>
          </div>

          {selectedDayWorkouts.length === 0 && selectedDayActivities.length === 0 ? (
            <div className="py-12">
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
                : `${durationLabel} • ${progress.completedSets}/${progress.totalSets} sets`;

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
                  transition={{ delay: workoutIndex * 0.06, ...springs.smooth }}
                  className="border-t border-[var(--color-border)] first:border-t-0"
                >
                  <div className="overflow-hidden">
                    <div className="flex items-center justify-between cursor-pointer py-4" onClick={() => { void handleToggleWorkout(workout); }}>
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 border border-[var(--color-border)] flex items-center justify-center shrink-0">
                          {progress.completed ? (
                            <Check className="w-4 h-4 text-[var(--color-text)]" strokeWidth={2} />
                          ) : (
                            <span className="t-data-sm text-[10px] text-[var(--color-muted)]">{progress.percent}%</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="t-heading normal-case tracking-[0.01em] text-[14px] text-[var(--color-text)] truncate">{resolvedTitle}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <TickStrip
                              total={Math.min(progress.totalSets, 16)}
                              filled={Math.min(progress.completedSets, 16)}
                              tone={progress.completed ? 'sage' : 'amber'}
                              size="sm"
                            />
                            <span className="t-data-sm text-[10px] text-[var(--color-muted)]">{subtitle}</span>
                          </div>
                        </div>
                      </div>
                      <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                        <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                      </motion.div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="pb-4 pt-1"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={springs.smooth}
                        >
                          <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-t border-[var(--color-border)] pt-4">
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
                            const movementNote = movementNotesByWorkout[workout.id]?.[exerciseId] || planItem?.notes || '';
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
                                className="mb-3"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: exIndex * 0.04, ...springs.smooth }}
                              >
                                <div
                                  className="flex items-center justify-between py-2.5 px-2 -mx-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)] transition-colors"
                                  onClick={() => setExpandedExercise(isExerciseExpanded ? null : expandedExerciseKey)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-7 h-7 border border-[var(--color-border)] flex items-center justify-center t-data-sm text-[10px] text-[var(--color-muted)] shrink-0">
                                      {exerciseProgress.completed ? <Check className="w-3.5 h-3.5 text-[var(--color-text)]" strokeWidth={2} /> : `${exerciseProgress.completedSets}/${exerciseProgress.totalSets}`}
                                    </div>
                                    <div className="min-w-0">
                                      <span className="text-[13px] text-[var(--color-text)]">{exerciseName}</span>
                                      {supersetGroupId && supersetPartnerName && (
                                        <p className="t-label-sm text-[9px] mt-0.5">Superset with {supersetPartnerName}</p>
                                      )}
                                      {hasMovementNote && !isExerciseExpanded && (
                                        <p className="t-caption text-[10px] mt-0.5 truncate max-w-[220px]">{movementNote}</p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-0.5 shrink-0" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={!canMoveUp}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex <= 0) return;
                                        [nextOrder[currentIndex - 1], nextOrder[currentIndex]] = [nextOrder[currentIndex], nextOrder[currentIndex - 1]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                    >
                                      <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!canMoveDown}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex < 0 || currentIndex >= nextOrder.length - 1) return;
                                        [nextOrder[currentIndex], nextOrder[currentIndex + 1]] = [nextOrder[currentIndex + 1], nextOrder[currentIndex]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
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
                                        className="p-1.5 text-[var(--color-text)] hover:text-[var(--color-text-dim)] transition-colors"
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
                                        className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                        title="Add superset"
                                      >
                                        <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { void handleRemoveExercise(workout.id, exerciseId); }}
                                      className="p-1.5 text-[var(--color-accent)] hover:text-[var(--color-accent-deep)] transition-colors"
                                      title="Remove exercise"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                                    </button>
                                    <motion.div animate={{ rotate: isExerciseExpanded ? 180 : 0 }} transition={springs.snappy}>
                                      <ChevronDown className="w-3 h-3 text-[var(--color-muted)]" strokeWidth={1.5} />
                                    </motion.div>
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {isExerciseExpanded && (
                                    <motion.div
                                      className="ml-4 mt-2 space-y-px"
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={springs.smooth}
                                    >
                                      <div className="flex items-center justify-between gap-2 py-2.5 border-t border-[var(--color-border)]">
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
                                            onBlur={() => { void handleTargetSetBlur(workout.id, exerciseId, currentTargetSets); }}
                                            className="w-14 px-2 py-1 well t-data-sm text-[var(--color-text)] text-center focus:outline-none"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => { void handleAddSet(workout.id, exerciseId); }}
                                            className="px-2.5 py-1 t-label-sm text-[9px] border border-[var(--color-border-strong)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-text)] transition-colors"
                                          >
                                            + Add Set
                                          </button>
                                        </div>
                                      </div>

                                      {sets.map((set) => (
                                        <motion.div
                                          key={set.id}
                                          className="flex items-center justify-between py-2.5 border-t border-[var(--color-border)]"
                                          initial={{ opacity: 0, y: 4 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          transition={springs.smooth}
                                        >
                                          <div className="flex items-baseline gap-3">
                                            <span className="t-data-sm text-[10px] text-[var(--color-muted)] w-10">{set.set_number.toString().padStart(2, '0')}</span>
                                            <span className="t-data text-[var(--color-text)]">
                                              {set.weight || '—'} <span className="text-[var(--color-muted)]">lb</span> × {set.reps || '—'}
                                              {set.rpe ? <span className="text-[var(--color-muted)]"> @ {set.rpe}</span> : ''}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-0.5">
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingSet(set);
                                              }}
                                              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                                              whileTap={{ scale: 0.9 }}
                                            >
                                              <Pencil className="w-3 h-3" strokeWidth={1.5} />
                                            </motion.button>
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void handleRemoveSet(workout.id, exerciseId, set.id);
                                              }}
                                              className="p-1.5 text-[var(--color-accent)] hover:text-[var(--color-accent-deep)] transition-colors"
                                              whileTap={{ scale: 0.9 }}
                                            >
                                              <X className="w-3 h-3" strokeWidth={1.5} />
                                            </motion.button>
                                          </div>
                                        </motion.div>
                                      ))}

                                      <div className="pt-4 border-t border-[var(--color-border)]">
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
                                          className="w-full bg-transparent border-b border-[var(--color-border-strong)] pb-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-text)] transition-colors resize-none"
                                        />
                                        <div className="mt-2 flex items-center justify-between">
                                          <div>
                                            {savingMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="t-label-sm text-[9px]">Saving...</p>
                                            ) : savedMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="t-label-sm text-[9px] text-[var(--color-text)]">Saved</p>
                                            ) : null}
                                          </div>
                                          {noteCharacterCount >= 160 && (
                                            <p className="t-data-sm text-[10px] text-[var(--color-muted)]">{noteCharacterCount}/200</p>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}

                          <motion.button
                            onClick={() => setShowDeleteConfirm(workout.id)}
                            className="w-full mt-5 min-h-11 border-t-2 border-[var(--color-accent)] border-x border-b border-[var(--color-border)] text-[var(--color-accent)] t-label hover:bg-rose-tint transition-colors flex items-center justify-center gap-2"
                            whileTap={{ scale: 0.98 }}
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                            Delete session
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
              {selectedDayActivities.length > 0 && (
                <div className={selectedDayWorkouts.length > 0 ? 'mt-6 pt-6 border-t border-[var(--color-border)]' : ''}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="t-label-sm">Activities</span>
                    <span className="t-label-sm">{selectedDayActivities.length}</span>
                  </div>
                  {selectedDayActivities.map((activity, activityIndex) => (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (selectedDayWorkouts.length + activityIndex) * 0.04, ...springs.smooth }}
                    >
                      <ActivityLedgerRow
                        activity={activity}
                        segments={segmentsBySession[activity.id] || []}
                        expanded={expandedActivity === activity.id}
                        onToggleExpand={() => setExpandedActivity((prev) => (prev === activity.id ? null : activity.id))}
                        onEdit={() => setActivityEditor({ activity, defaultDate: parseDateKey(getActivitySessionDateKey(activity) || selectedDateKey) })}
                        onDelete={() => setShowActivityDeleteConfirm(activity)}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      <Modal isOpen={!!editingSet} onClose={() => setEditingSet(null)} title="Edit Set">
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
        title={activityEditor?.activity ? 'Edit Activity' : 'Add Activity'}
      >
        {activityEditor && (
          <ActivityEditor
            key={activityEditor.activity?.id || format(activityEditor.defaultDate, 'yyyy-MM-dd')}
            activity={activityEditor.activity}
            defaultDate={activityEditor.defaultDate}
            saving={savingActivity}
            onSave={(input) => { void handleSaveActivity(input); }}
            onCancel={() => setActivityEditor(null)}
          />
        )}
      </Modal>

      <Modal isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title="Delete Session">
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

      <Modal isOpen={!!showActivityDeleteConfirm} onClose={() => setShowActivityDeleteConfirm(null)} title="Delete Activity">
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
            await addExerciseToWorkout(workoutId, exercise);
          });
        }}
        excludeExerciseIds={pickerState?.excludeExerciseIds || []}
        title={pickerState?.baseExerciseId ? 'Add Superset Exercise' : 'Add Exercise'}
      />
    </motion.div>
  );
}
