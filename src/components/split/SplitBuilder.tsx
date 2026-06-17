import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Link2, PenLine, Plus, Search, Unlink2, Wand2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, Chip, Input, SelectSheet, TickStrip } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { splitTemplates } from '@/lib/splitTemplates';
import { springs } from '@/lib/animations';
import {
  buildGuidedTemplate,
  recommendProgramTemplate,
  type EquipmentProfile,
  type ExperienceLevel,
  type ProgramDesignAnswers,
  type ProgramFocus,
  type SessionLength,
} from '@/lib/programDesigner';
import { normalizeSetRange, serializeSetRangeNotes } from '@/lib/setRangeNotes';
import type { MuscleGroup, SplitTemplate } from '@/types';

interface SplitBuilderProps {
  onComplete: (createdSplit?: { id: string; name: string }) => void;
}

type Step = 'choose' | 'guided' | 'guided-review' | 'custom-name' | 'custom-days' | 'custom-exercises';

type Option<T extends string | number> = {
  value: T;
  label: string;
  hint: string;
};

const DAY_OPTIONS: Option<number>[] = [
  { value: 3, label: '3 days', hint: 'Higher recovery between sessions' },
  { value: 4, label: '4 days', hint: 'Best balance for most lifters' },
  { value: 5, label: '5 days', hint: 'More weekly muscle exposure' },
  { value: 6, label: '6 days', hint: 'Highest frequency workload' },
];

const FOCUS_OPTIONS: Option<ProgramFocus>[] = [
  { value: 'no_focus', label: 'No specific focus', hint: 'General balanced development' },
  { value: 'upper_focus', label: 'Upper Focus', hint: 'Extra upper-body stimulus' },
  { value: 'lower_focus', label: 'Lower Focus', hint: 'Extra lower-body stimulus' },
];

const EQUIPMENT_OPTIONS: Option<EquipmentProfile>[] = [
  { value: 'full_gym', label: 'Full Gym', hint: 'Barbells, machines, cables' },
  { value: 'dumbbell_only', label: 'Dumbbell Only', hint: 'Dumbbells + bodyweight movements' },
];

const SESSION_OPTIONS: Option<SessionLength>[] = [
  { value: 'short', label: '45 min', hint: 'Time-efficient session density' },
  { value: 'moderate', label: '60 min', hint: 'Moderate session volume' },
  { value: 'long', label: '75+ min', hint: 'Higher per-session capacity' },
];

const EXPERIENCE_OPTIONS: Option<ExperienceLevel>[] = [
  { value: 'beginner', label: 'Beginner', hint: '< 1 year consistent lifting' },
  { value: 'intermediate', label: 'Intermediate', hint: '1-3 years consistent lifting' },
  { value: 'advanced', label: 'Advanced', hint: '3+ years and stable technique' },
];

const MUSCLE_GROUP_OPTIONS: Array<{ value: MuscleGroup; label: string }> = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'rear_delts', label: 'Rear Delts' },
  { value: 'side_delts', label: 'Side Delts' },
  { value: 'front_delts', label: 'Front Delts' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'quads', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'calves', label: 'Calves' },
  { value: 'core', label: 'Core' },
  { value: 'traps', label: 'Traps' },
];

type CustomExerciseDraft = {
  local_id: string;
  exercise_id: string | null;
  name: string;
  target_sets: number;
  target_sets_min: number;
  target_sets_max: number;
  target_reps_min: number;
  target_reps_max: number;
  notes: string | null;
  custom_muscle_group: MuscleGroup;
  superset_group_id: string | null;
};

type CustomDayDraft = {
  day_name: string;
  day_order: number;
  exercises: CustomExerciseDraft[];
};

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createLocalId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === 'function') {
    return randomUuid.call(globalThis.crypto);
  }

  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampSetInput(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function normalizeCustomSetRange(exercise: Pick<CustomExerciseDraft, 'target_sets_min' | 'target_sets' | 'target_sets_max'>) {
  return normalizeSetRange(exercise.target_sets_min, exercise.target_sets, exercise.target_sets_max);
}

function createSupersetGroupId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `superset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* Guided interview stages — one decision per screen */
type GuidedStageKey = 'daysPerWeek' | 'focus' | 'equipment' | 'sessionLength' | 'experience';

const GUIDED_STAGES: Array<{ key: GuidedStageKey; question: string; caption: string }> = [
  { key: 'daysPerWeek', question: 'How many days can you train?', caption: 'Be honest — consistency beats ambition.' },
  { key: 'focus', question: 'Any area you want to emphasize?', caption: 'Focus shifts volume, it never abandons the rest.' },
  { key: 'equipment', question: 'What equipment do you have?', caption: 'Movements adapt to what you can actually load.' },
  { key: 'sessionLength', question: 'How long is a typical session?', caption: 'Sets per day scale to the clock.' },
  { key: 'experience', question: 'How long have you been lifting?', caption: 'Experience calibrates starting volume.' },
];

export function SplitBuilder({ onComplete }: SplitBuilderProps) {
  const { createSplit } = useAppStore();
  const [step, setStep] = useState<Step>('choose');
  const [guidedStage, setGuidedStage] = useState(0);
  const [loading, setLoading] = useState(false);

  const [guidedAnswers, setGuidedAnswers] = useState<ProgramDesignAnswers>({
    daysPerWeek: 4,
    focus: 'no_focus',
    equipment: 'full_gym',
    sessionLength: 'moderate',
    experience: 'intermediate',
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [days, setDays] = useState<CustomDayDraft[]>([]);
  const [exerciseLibrary, setExerciseLibrary] = useState<Array<{ id: string; name: string }>>([]);
  const [activeCustomDayIndex, setActiveCustomDayIndex] = useState(0);
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [customExerciseName, setCustomExerciseName] = useState('');
  const [customExerciseMuscle, setCustomExerciseMuscle] = useState<MuscleGroup>('core');
  const [customError, setCustomError] = useState<string | null>(null);
  const [tapFeedback, setTapFeedback] = useState<{ message: string; tone: 'ok' | 'info' } | null>(null);
  const [supersetSourceLocalId, setSupersetSourceLocalId] = useState<string | null>(null);

  const recommendedTemplate = useMemo(
    () => recommendProgramTemplate(splitTemplates, guidedAnswers),
    [guidedAnswers]
  );

  const guidedTemplate = useMemo(
    () => buildGuidedTemplate(recommendedTemplate, guidedAnswers),
    [recommendedTemplate, guidedAnswers]
  );

  const getExerciseRows = async () => {
    const { data, error } = await supabase.from('exercises').select('id, name');
    if (error || !data) return [];
    return data;
  };

  const resolveExerciseId = (
    exerciseName: string,
    exerciseMap: Map<string, string>,
    normalizedMap: Map<string, string>
  ): string | undefined => {
    const direct = exerciseMap.get(exerciseName);
    if (direct) return direct;
    return normalizedMap.get(normalizeExerciseName(exerciseName));
  };

  useEffect(() => {
    if (step !== 'custom-exercises') return;

    let cancelled = false;
    const load = async () => {
      const rows = await getExerciseRows();
      if (!cancelled) {
        setExerciseLibrary(rows);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (!tapFeedback) return;

    const timer = window.setTimeout(() => {
      setTapFeedback(null);
    }, 1300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [tapFeedback]);

  useEffect(() => {
    setTapFeedback(null);
    setSupersetSourceLocalId(null);
  }, [activeCustomDayIndex, step]);

  const activeCustomDay = days[activeCustomDayIndex];

  const addSupersetExerciseToCustomDay = (sourceLocalId: string, exercise: { id: string; name: string }) => {
    if (!activeCustomDay) return;

    if (activeCustomDay.exercises.some((item) => item.exercise_id === exercise.id)) {
      setTapFeedback({ message: `${exercise.name} is already added`, tone: 'info' });
      return;
    }

    setDays((current) =>
      current.map((day, dayIndex) => {
        if (dayIndex !== activeCustomDayIndex) return day;

        const sourceIndex = day.exercises.findIndex((entry) => entry.local_id === sourceLocalId);
        if (sourceIndex < 0) return day;

        const source = day.exercises[sourceIndex];
        const supersetGroupId = source.superset_group_id || createSupersetGroupId();

        const nextExercises = day.exercises.map((entry) => (
          entry.local_id === source.local_id
            ? { ...entry, superset_group_id: supersetGroupId }
            : entry
        ));

        nextExercises.splice(sourceIndex + 1, 0, {
          local_id: createLocalId(),
          exercise_id: exercise.id,
          name: exercise.name,
          target_sets: source.target_sets,
          target_sets_min: source.target_sets_min,
          target_sets_max: source.target_sets_max,
          target_reps_min: source.target_reps_min,
          target_reps_max: source.target_reps_max,
          notes: null,
          custom_muscle_group: source.custom_muscle_group,
          superset_group_id: supersetGroupId,
        });

        return { ...day, exercises: nextExercises };
      })
    );

    setSupersetSourceLocalId(null);
    setTapFeedback({ message: `Added ${exercise.name} as superset`, tone: 'ok' });
  };

  const addExerciseToCustomDay = (exercise: { id: string; name: string }) => {
    if (!activeCustomDay) return;

    if (supersetSourceLocalId) {
      addSupersetExerciseToCustomDay(supersetSourceLocalId, exercise);
      return;
    }

    if (activeCustomDay.exercises.some((item) => item.exercise_id === exercise.id)) {
      setTapFeedback({ message: `${exercise.name} is already added`, tone: 'info' });
      return;
    }

    setDays((current) =>
      current.map((day, dayIndex) => {
        if (dayIndex !== activeCustomDayIndex) return day;

        return {
          ...day,
          exercises: [
            ...day.exercises,
            {
              local_id: createLocalId(),
              exercise_id: exercise.id,
              name: exercise.name,
              target_sets: 3,
              target_sets_min: 3,
              target_sets_max: 3,
              target_reps_min: 8,
              target_reps_max: 12,
              notes: null,
              custom_muscle_group: 'core',
              superset_group_id: null,
            },
          ],
        };
      })
    );

    setTapFeedback({ message: `Added ${exercise.name}`, tone: 'ok' });
  };

  const addCustomExerciseToDay = () => {
    const trimmedName = customExerciseName.trim();
    if (!trimmedName || !activeCustomDay) return;

    const existing = exerciseLibrary.find(
      (exercise) => normalizeExerciseName(exercise.name) === normalizeExerciseName(trimmedName)
    );

    if (existing) {
      addExerciseToCustomDay(existing);
      setCustomExerciseName('');
      setCustomError(null);
      return;
    }

    setDays((current) =>
      current.map((day, dayIndex) => {
        if (dayIndex !== activeCustomDayIndex) return day;

        return {
          ...day,
          exercises: [
            ...day.exercises,
            {
              local_id: createLocalId(),
              exercise_id: null,
              name: trimmedName,
              target_sets: 3,
              target_sets_min: 3,
              target_sets_max: 3,
              target_reps_min: 8,
              target_reps_max: 12,
              notes: null,
              custom_muscle_group: customExerciseMuscle,
              superset_group_id: null,
            },
          ],
        };
      })
    );

    setCustomExerciseName('');
    setCustomError(null);
    setTapFeedback({ message: `Added ${trimmedName}`, tone: 'ok' });
  };

  const updateCustomExercise = (
    dayIndex: number,
    localId: string,
    updater: (exercise: CustomExerciseDraft) => CustomExerciseDraft
  ) => {
    setDays((current) =>
      current.map((day, index) => {
        if (index !== dayIndex) return day;

        const source = day.exercises.find((exercise) => exercise.local_id === localId);
        if (!source) return day;

        const nextSource = updater(source);
        const setsChanged = (
          nextSource.target_sets !== source.target_sets
          || nextSource.target_sets_min !== source.target_sets_min
          || nextSource.target_sets_max !== source.target_sets_max
        );

        return {
          ...day,
          exercises: day.exercises.map((exercise) => {
            if (exercise.local_id === localId) return nextSource;

            if (
              setsChanged
              && source.superset_group_id
              && exercise.superset_group_id === source.superset_group_id
            ) {
              return {
                ...exercise,
                target_sets: nextSource.target_sets,
                target_sets_min: nextSource.target_sets_min,
                target_sets_max: nextSource.target_sets_max,
              };
            }

            return exercise;
          }),
        };
      })
    );
  };

  const removeCustomExercise = (dayIndex: number, localId: string) => {
    setDays((current) =>
      current.map((day, index) => {
        if (index !== dayIndex) return day;

        const removing = day.exercises.find((exercise) => exercise.local_id === localId);
        const groupId = removing?.superset_group_id || null;

        return {
          ...day,
          exercises: day.exercises
            .filter((exercise) => exercise.local_id !== localId)
            .map((exercise) => (
              groupId && exercise.superset_group_id === groupId
                ? { ...exercise, superset_group_id: null }
                : exercise
            )),
        };
      })
    );
  };

  const moveCustomExercise = (dayIndex: number, localId: string, direction: -1 | 1) => {
    setDays((current) =>
      current.map((day, index) => {
        if (index !== dayIndex) return day;
        const currentIndex = day.exercises.findIndex((exercise) => exercise.local_id === localId);
        if (currentIndex < 0) return day;

        const moving = day.exercises[currentIndex];
        if (moving.superset_group_id) {
          const groupIndices = day.exercises
            .map((exercise, exerciseIndex) => ({ exercise, exerciseIndex }))
            .filter(({ exercise }) => exercise.superset_group_id === moving.superset_group_id)
            .map(({ exerciseIndex }) => exerciseIndex)
            .sort((a, b) => a - b);

          if (groupIndices.length === 2) {
            const start = groupIndices[0];
            const end = groupIndices[1];
            const targetStart = direction === -1 ? start - 1 : end + 1;
            if (targetStart < 0 || targetStart >= day.exercises.length) return day;

            const nextExercises = [...day.exercises];
            const block = nextExercises.splice(start, 2);
            const insertAt = direction === -1 ? start - 1 : start + 1;
            nextExercises.splice(insertAt, 0, ...block);
            return { ...day, exercises: nextExercises };
          }
        }

        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= day.exercises.length) return day;

        const nextExercises = [...day.exercises];
        const [single] = nextExercises.splice(currentIndex, 1);
        nextExercises.splice(targetIndex, 0, single);
        return { ...day, exercises: nextExercises };
      })
    );
  };

  const createFromTemplate = async (template: SplitTemplate) => {
    setLoading(true);
    try {
      const exerciseRows = await getExerciseRows();

      const exerciseMap = new Map(exerciseRows.map((exercise) => [exercise.name, exercise.id]));
      const normalizedMap = new Map(
        exerciseRows.map((exercise) => [normalizeExerciseName(exercise.name), exercise.id])
      );

      const splitDays = template.days.map((day, index) => ({
        day_name: day.day_name,
        day_order: index,
        exercises: day.exercises
          .map((exercise, exerciseOrder) => {
            const exerciseId = resolveExerciseId(exercise.name, exerciseMap, normalizedMap);
            if (!exerciseId) return null;

            return {
              exercise_id: exerciseId,
              target_sets: exercise.sets,
              target_reps_min: exercise.reps_min,
              target_reps_max: exercise.reps_max,
              exercise_order: exerciseOrder,
              notes: serializeSetRangeNotes(null, exercise.sets, exercise.sets, exercise.sets),
            };
          })
          .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== null),
      }));

      const created = await createSplit({
        name: template.name,
        description: template.description,
        days_per_week: template.days_per_week,
        is_active: true,
        days: splitDays,
      });

      onComplete(created ? { id: created.id, name: template.name } : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCustom = async () => {
    setLoading(true);
    setCustomError(null);
    try {
      if (days.some((day) => day.exercises.length === 0)) {
        setCustomError('Each day needs at least one exercise before creating the program.');
        return;
      }

      if (
        days.some((day) =>
          day.exercises.some((exercise) => {
            const range = normalizeCustomSetRange(exercise);
            return (
              range.minSets < 1 ||
              range.maxSets > 10 ||
              range.minSets > range.targetSets ||
              range.targetSets > range.maxSets ||
              exercise.target_reps_min < 1 ||
              exercise.target_reps_max < exercise.target_reps_min
            );
          })
        )
      ) {
        setCustomError('Please fix set/reps so each exercise has valid min-target-max values.');
        return;
      }

      const exerciseRows = await getExerciseRows();
      const normalizedToId = new Map(
        exerciseRows.map((exercise) => [normalizeExerciseName(exercise.name), exercise.id])
      );

      const ensureExerciseId = async (exercise: CustomExerciseDraft): Promise<string> => {
        if (exercise.exercise_id) return exercise.exercise_id;

        const normalizedName = normalizeExerciseName(exercise.name);
        const existingId = normalizedToId.get(normalizedName);
        if (existingId) return existingId;

        const { data, error } = await supabase
          .from('exercises')
          .insert(
            {
              name: exercise.name,
              muscle_group: exercise.custom_muscle_group,
              muscle_group_secondary: null,
              equipment: null,
              is_compound: false,
            }
          )
          .select('id, name')
          .single();

        if (error) {
          if (error.code === '23505') {
            const { data: duplicateRow, error: duplicateError } = await supabase
              .from('exercises')
              .select('id, name')
              .eq('name', exercise.name)
              .single();

            if (duplicateError || !duplicateRow) {
              throw new Error(`Could not create exercise: ${exercise.name}`);
            }

            const duplicateId = duplicateRow.id as string;
            normalizedToId.set(normalizedName, duplicateId);
            return duplicateId;
          }

          throw new Error(`Could not create exercise: ${exercise.name}`);
        }

        if (!data) {
          throw new Error(`Could not create exercise: ${exercise.name}`);
        }

        const createdId = data.id as string;
        normalizedToId.set(normalizedName, createdId);
        return createdId;
      };

      const splitDays = await Promise.all(
        days.map(async (day, dayIndex) => {
          const normalizedSupersetIds = new Map<string, string>();

          return {
            day_name: day.day_name,
            day_order: dayIndex,
            exercises: await Promise.all(
              day.exercises.map(async (exercise, exerciseIndex) => {
                const normalizedRange = normalizeCustomSetRange(exercise);

                let supersetGroupId: string | null = null;
                if (exercise.superset_group_id) {
                  if (!normalizedSupersetIds.has(exercise.superset_group_id)) {
                    normalizedSupersetIds.set(exercise.superset_group_id, createSupersetGroupId());
                  }
                  supersetGroupId = normalizedSupersetIds.get(exercise.superset_group_id) || null;
                }

                return {
                  exercise_id: await ensureExerciseId(exercise),
                  target_sets: normalizedRange.targetSets,
                  target_reps_min: exercise.target_reps_min,
                  target_reps_max: exercise.target_reps_max,
                  exercise_order: exerciseIndex,
                  notes: serializeSetRangeNotes(
                    exercise.notes,
                    normalizedRange.minSets,
                    normalizedRange.targetSets,
                    normalizedRange.maxSets
                  ),
                  superset_group_id: supersetGroupId,
                };
              })
            ),
          };
        })
      );

      const created = await createSplit({
        name,
        description,
        days_per_week: daysPerWeek,
        is_active: true,
        days: splitDays,
      });
      onComplete(created ? { id: created.id, name } : undefined);
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : 'Could not create custom program.');
    } finally {
      setLoading(false);
    }
  };

  /* ── shared bits ── */

  const BackLink = ({ onClick }: { onClick: () => void }) => (
    <button
      type="button"
      className="pressable flex items-center gap-1.5 t-label-sm hover:text-[var(--color-text)] py-1.5 pr-2 -ml-1 transition-colors disabled:opacity-40"
      onClick={onClick}
      disabled={loading}
    >
      <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
      Back
    </button>
  );

  /* ═══════════ Choose path ═══════════ */

  if (step === 'choose') {
    return (
      <div className="pt-2 pb-2">
        <p className="text-editorial mb-7 max-w-[32ch]">Two ways to a program. Both end with a plan you own.</p>

        <ul>
          <li>
            <button
              type="button"
              className="pressable group w-full flex items-center gap-4 py-5 border-t-2 border-[var(--color-accent)] text-left"
              onClick={() => {
                setGuidedStage(0);
                setStep('guided');
              }}
            >
              <Wand2 className="w-5 h-5 text-[var(--color-accent)] shrink-0" strokeWidth={1.5} />
              <span className="flex-1 min-w-0">
                <span className="block t-heading">Guided builder</span>
                <span className="block t-caption mt-1">Five questions → an evidence-based split</span>
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors shrink-0" strokeWidth={1.5} />
            </button>
          </li>

          <li>
            <button
              type="button"
              className="pressable group w-full flex items-center gap-4 py-5 border-t border-[var(--color-border)] text-left"
              onClick={() => setStep('custom-name')}
            >
              <PenLine className="w-5 h-5 text-[var(--color-text-dim)] shrink-0" strokeWidth={1.5} />
              <span className="flex-1 min-w-0">
                <span className="block t-heading">Custom</span>
                <span className="block t-caption mt-1">Build every day by hand</span>
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors shrink-0" strokeWidth={1.5} />
            </button>
          </li>
        </ul>
      </div>
    );
  }

  /* ═══════════ Guided interview — one decision per stage ═══════════ */

  if (step === 'guided') {
    const stage = GUIDED_STAGES[guidedStage];
    const isLastStage = guidedStage === GUIDED_STAGES.length - 1;

    const stageOptions: Array<Option<string | number>> =
      stage.key === 'daysPerWeek' ? DAY_OPTIONS
      : stage.key === 'focus' ? FOCUS_OPTIONS
      : stage.key === 'equipment' ? EQUIPMENT_OPTIONS
      : stage.key === 'sessionLength' ? SESSION_OPTIONS
      : EXPERIENCE_OPTIONS;

    const selectedValue = guidedAnswers[stage.key];

    const selectOption = (value: string | number) => {
      setGuidedAnswers((current) => ({
        ...current,
        [stage.key]: stage.key === 'daysPerWeek' ? Number(value) : value,
      }));
    };

    return (
      <div className="pt-1 pb-2">
        <div className="flex items-center justify-between mb-7">
          <BackLink onClick={() => (guidedStage === 0 ? setStep('choose') : setGuidedStage((s) => s - 1))} />
          <div className="flex items-center gap-2.5">
            <TickStrip total={GUIDED_STAGES.length} filled={guidedStage} tone="amber" size="sm" live />
            <span className="t-data-sm text-[var(--color-muted)]">{guidedStage + 1}/{GUIDED_STAGES.length}</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={stage.key}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={springs.smooth}
          >
            <p className="t-label mb-3">Question {guidedStage + 1}</p>
            <h3 className="t-title mb-2">{stage.question}</h3>
            <p className="text-editorial mb-6 max-w-[34ch]">{stage.caption}</p>

            <ul className="mb-7">
              {stageOptions.map((option) => {
                const active = selectedValue === option.value;
                return (
                  <li key={`${option.value}`} className="border-t border-[var(--color-border)] last:border-b">
                    <button
                      type="button"
                      className="pressable w-full text-left py-4 flex items-center justify-between gap-3"
                      onClick={() => selectOption(option.value)}
                    >
                      <span className="flex-1 min-w-0">
                        <span className={`block t-heading ${active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
                          {option.label}
                        </span>
                        <span className="block t-caption mt-1">{option.hint}</span>
                      </span>
                      <span
                        className={`flex items-center justify-center w-5 h-5 rounded-full border shrink-0 ${
                          active
                            ? 'bg-[var(--color-accent)] border-[var(--color-accent)]'
                            : 'border-[var(--color-border-strong)]'
                        }`}
                      >
                        {active && <Check className="w-3 h-3 text-[var(--color-base)]" strokeWidth={2.5} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </AnimatePresence>

        {/* Live recommendation preview — updates with every answer */}
        <div className="border-l-2 border-[var(--color-accent)] pl-4 mb-7">
          <p className="t-label-sm mb-1.5 flex items-center gap-1.5">
            <Wand2 className="w-3 h-3 text-[var(--color-accent)]" strokeWidth={1.75} />
            Currently building
          </p>
          <p className="t-heading">{guidedTemplate.name}</p>
          <p className="t-data-sm text-[var(--color-muted)] mt-1">
            {guidedTemplate.days_per_week} days/week · {guidedTemplate.days.reduce((acc, day) => acc + day.exercises.length, 0)} exercises
          </p>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={() => (isLastStage ? setStep('guided-review') : setGuidedStage((s) => s + 1))}
          disabled={loading}
        >
          {isLastStage ? 'Review my program' : 'Continue'}
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }

  /* ═══════════ Guided review ═══════════ */

  if (step === 'guided-review') {
    const totalExercises = guidedTemplate.days.reduce((acc, day) => acc + day.exercises.length, 0);

    return (
      <div className="pt-1 pb-2">
        <div className="mb-6">
          <BackLink onClick={() => setStep('guided')} />
        </div>

        <div className="border-t-2 border-[var(--color-accent)] pt-5 mb-7">
          <p className="t-label text-[var(--color-accent)] mb-2">Your program</p>
          <h4 className="t-title mb-2">{guidedTemplate.name}</h4>
          <p className="text-editorial mb-4 max-w-[42ch]">{guidedTemplate.description}</p>
          <div className="flex items-center gap-3">
            <TickStrip total={guidedTemplate.days_per_week} filled={guidedTemplate.days_per_week} tone="amber" size="sm" />
            <span className="t-data-sm text-[var(--color-muted)]">
              {guidedTemplate.days_per_week} days/week · {totalExercises} exercises
            </span>
          </div>
        </div>

        <ul className="max-h-[300px] overflow-y-auto pr-1 mb-7 overscroll-contain">
          {guidedTemplate.days.map((day, dayIndex) => (
            <li key={day.day_name} className="border-t border-[var(--color-border)] py-3.5">
              <div className="flex items-baseline gap-4 mb-2.5">
                <span className="t-data-sm text-[var(--color-muted)] w-6 shrink-0">{String(dayIndex + 1).padStart(2, '0')}</span>
                <p className="flex-1 t-heading">{day.day_name}</p>
                <span className="t-data-sm text-[var(--color-muted)] shrink-0">{day.exercises.length} ex</span>
              </div>
              <div className="pl-10">
                {day.exercises.slice(0, 4).map((exercise, exerciseIndex) => (
                  <div key={`${exercise.name}-${exerciseIndex}`} className="flex items-baseline justify-between gap-2 py-1 border-t border-[var(--color-border-soft)]">
                    <span className="t-caption text-[var(--color-text-dim)] truncate">{exercise.name}</span>
                    <span className="t-data-sm text-[var(--color-muted)] shrink-0">
                      {exercise.sets}×{exercise.reps_min}–{exercise.reps_max}
                    </span>
                  </div>
                ))}
                {day.exercises.length > 4 && (
                  <p className="t-caption pt-1.5">+{day.exercises.length - 4} more</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        <Button size="lg" className="w-full" disabled={loading} loading={loading} onClick={() => createFromTemplate(guidedTemplate)}>
          {loading ? 'Creating program…' : 'Build my program'}
        </Button>
        <p className="t-caption text-center mt-3">You can edit every day and exercise after it's created.</p>
      </div>
    );
  }

  /* ═══════════ Custom: name ═══════════ */

  if (step === 'custom-name') {
    return (
      <div className="pt-1 pb-2 space-y-6">
        <BackLink onClick={() => setStep('choose')} />

        <Input
          label="Program name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g., My Upper/Lower"
        />

        <Input
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional description…"
        />

        <div>
          <span className="t-label block mb-3">Days per week</span>
          <div className="grid grid-cols-4 gap-0 border-t border-b border-[var(--color-border)]">
            {[3, 4, 5, 6].map((dayCount) => (
              <button
                key={dayCount}
                type="button"
                className={`pressable min-h-14 number-medium transition-colors border-l border-[var(--color-border)] first:border-l-0 ${
                  daysPerWeek === dayCount
                    ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                }`}
                onClick={() => setDaysPerWeek(dayCount)}
              >
                {dayCount}
              </button>
            ))}
          </div>
        </div>

        <Button
          size="lg"
          className="w-full"
          disabled={!name}
          onClick={() => {
            setDays(
              Array.from({ length: daysPerWeek }, (_, index) => ({
                day_name: `Day ${index + 1}`,
                day_order: index,
                exercises: [],
              }))
            );
            setStep('custom-days');
          }}
        >
          Continue
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }

  /* ═══════════ Custom: day names ═══════════ */

  if (step === 'custom-days') {
    return (
      <div className="pt-1 pb-2 space-y-6">
        <BackLink onClick={() => setStep('custom-name')} />

        <div>
          <h3 className="t-title mb-2">Name each training day</h3>
          <p className="text-editorial max-w-[36ch]">Push, Pull, Legs — whatever you call them on the floor.</p>
        </div>

        <div className="space-y-3">
          {days.map((day, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="number-medium text-[var(--color-text-dim)] w-9 shrink-0 leading-none">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Input
                value={day.day_name}
                onChange={(event) => {
                  const next = [...days];
                  next[index] = { ...next[index], day_name: event.target.value };
                  setDays(next);
                }}
                placeholder="e.g., Push, Pull, Legs"
                className="flex-1"
              />
            </div>
          ))}
        </div>

        <Button size="lg" className="w-full" onClick={() => setStep('custom-exercises')} disabled={loading}>
          Continue to exercises
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }

  /* ═══════════ Custom: exercises ═══════════ */

  if (step === 'custom-exercises') {
    const filteredExercises = exerciseLibrary.filter((exercise) =>
      exercise.name.toLowerCase().includes(exerciseQuery.toLowerCase())
    );

    return (
      <div className="pt-1 pb-2 space-y-4">
        <BackLink onClick={() => setStep('custom-days')} />

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5 -mx-1 px-1">
          {days.map((day, index) => (
            <Chip
              key={`${day.day_name}-${index}`}
              tone="amber"
              size="sm"
              selected={activeCustomDayIndex === index}
              onClick={() => setActiveCustomDayIndex(index)}
            >
              {day.day_name}
              <span className="t-data-sm text-[10px] opacity-70">{day.exercises.length}</span>
            </Chip>
          ))}
        </div>

        {activeCustomDay && (
          <>
            {/* Library search */}
            <div>
              <div className="well flex items-center gap-2 pl-3.5 pr-2 min-h-11 mb-1.5">
                <Search className="w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={2} />
                <input
                  value={exerciseQuery}
                  onChange={(event) => setExerciseQuery(event.target.value)}
                  placeholder="Search exercise library…"
                  className="flex-1 min-w-0 bg-transparent text-sm font-medium text-[var(--color-text)] outline-none placeholder:text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)]"
                />
              </div>
              {tapFeedback && (
                <p className={`text-[11px] font-medium mb-1 ${tapFeedback.tone === 'ok' ? 'text-[var(--color-sage)]' : 'text-[var(--color-stone)]'}`}>
                  {tapFeedback.message}
                </p>
              )}
              {supersetSourceLocalId && (
                <p className="text-[11px] font-medium text-[var(--color-accent)] mb-1">Pick a superset partner from the list</p>
              )}
              <div className="max-h-[150px] overflow-y-auto pr-1 overscroll-contain">
                {filteredExercises.slice(0, 8).map((exercise) => {
                  const alreadyAdded = activeCustomDay.exercises.some(
                    (entry) => entry.exercise_id === exercise.id
                  );

                  return (
                    <button
                      key={exercise.id}
                      type="button"
                      onClick={() => addExerciseToCustomDay(exercise)}
                      className={`pressable w-full text-left py-2.5 t-body flex items-center justify-between gap-2 border-t border-[var(--color-border)] first:border-t-0 transition-colors ${
                        alreadyAdded ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      <span className="truncate">{exercise.name}</span>
                      {alreadyAdded ? (
                        <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                      ) : (
                        <Plus className="w-3.5 h-3.5 shrink-0 text-[var(--color-muted)]" strokeWidth={1.75} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom exercise */}
            <div>
              <span className="t-label block mb-2.5">Or add your own</span>
              <div className="space-y-2">
                <Input
                  value={customExerciseName}
                  onChange={(event) => setCustomExerciseName(event.target.value)}
                  placeholder="Type a custom exercise name"
                />
                <div className="flex gap-2">
                  <SelectSheet
                    className="flex-1"
                    title="Muscle group"
                    value={customExerciseMuscle}
                    onChange={(value) => setCustomExerciseMuscle(value)}
                    options={MUSCLE_GROUP_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                  <Button variant="secondary" onClick={addCustomExerciseToDay} disabled={!customExerciseName.trim()}>
                    <Plus className="w-4 h-4" strokeWidth={2.25} />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {/* Day plan */}
            <div className="space-y-2">
              <span className="t-label block pb-2.5 border-b border-[var(--color-text)]">{activeCustomDay.day_name} · plan</span>
              {activeCustomDay.exercises.length === 0 ? (
                <p className="t-caption py-3 border-b border-dashed border-[var(--color-border-strong)]">
                  No exercises yet — add from the library above.
                </p>
              ) : (
                activeCustomDay.exercises.map((exercise, exerciseIndex) => (
                  <div
                    key={exercise.local_id}
                    className={`border-t border-[var(--color-border)] py-3 space-y-3 ${
                      exercise.superset_group_id ? 'border-l-2 border-l-[var(--color-text)] pl-3' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-baseline gap-3">
                        <span className="t-data-sm text-[var(--color-muted)] shrink-0">{String(exerciseIndex + 1).padStart(2, '0')}</span>
                        <div className="min-w-0">
                          <p className="t-body text-[var(--color-text)] truncate">
                            {exercise.name}
                          </p>
                          {exercise.superset_group_id && (
                            <p className="flex items-center gap-1 t-label-sm mt-0.5">
                              <Link2 className="w-3 h-3" strokeWidth={1.75} />
                              Superset
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          aria-label="Move up"
                          className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
                          onClick={() => moveCustomExercise(activeCustomDayIndex, exercise.local_id, -1)}
                          disabled={exerciseIndex === 0}
                        >
                          <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
                          onClick={() => moveCustomExercise(activeCustomDayIndex, exercise.local_id, 1)}
                          disabled={exerciseIndex === activeCustomDay.exercises.length - 1}
                        >
                          <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        {exercise.superset_group_id ? (
                          <button
                            type="button"
                            aria-label="Remove superset"
                            className="pressable p-2 text-[var(--color-text)] hover:text-[var(--color-text-dim)] transition-colors"
                            onClick={() => {
                              const groupId = exercise.superset_group_id;
                              setDays((current) =>
                                current.map((day, dayIndex) => {
                                  if (dayIndex !== activeCustomDayIndex) return day;
                                  return {
                                    ...day,
                                    exercises: day.exercises.map((entry) => (
                                      entry.superset_group_id === groupId
                                        ? { ...entry, superset_group_id: null }
                                        : entry
                                    )),
                                  };
                                })
                              );
                            }}
                          >
                            <Unlink2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label="Add superset"
                            className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                            onClick={() => {
                              setSupersetSourceLocalId(exercise.local_id);
                              setTapFeedback({ message: 'Select a partner exercise from library', tone: 'info' });
                            }}
                          >
                            <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label="Remove exercise"
                          className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
                          onClick={() => removeCustomExercise(activeCustomDayIndex, exercise.local_id)}
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 pl-8">
                      <RangeCell
                        label="Min"
                        value={exercise.target_sets_min}
                        onCommit={(parsed) => {
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => {
                            const nextMin = Number.isNaN(parsed)
                              ? current.target_sets_min
                              : clampSetInput(parsed, current.target_sets_min);
                            const normalized = normalizeSetRange(nextMin, current.target_sets, current.target_sets_max);
                            return {
                              ...current,
                              target_sets_min: normalized.minSets,
                              target_sets: normalized.targetSets,
                              target_sets_max: normalized.maxSets,
                            };
                          });
                        }}
                      />
                      <RangeCell
                        label="Sets"
                        value={exercise.target_sets}
                        emphasized
                        onCommit={(parsed) => {
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => {
                            const nextTarget = Number.isNaN(parsed)
                              ? current.target_sets
                              : clampSetInput(parsed, current.target_sets);
                            const normalized = normalizeSetRange(current.target_sets_min, nextTarget, current.target_sets_max);
                            return {
                              ...current,
                              target_sets_min: normalized.minSets,
                              target_sets: normalized.targetSets,
                              target_sets_max: normalized.maxSets,
                            };
                          });
                        }}
                      />
                      <RangeCell
                        label="Max"
                        value={exercise.target_sets_max}
                        onCommit={(parsed) => {
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => {
                            const nextMax = Number.isNaN(parsed)
                              ? current.target_sets_max
                              : clampSetInput(parsed, current.target_sets_max);
                            const normalized = normalizeSetRange(current.target_sets_min, current.target_sets, nextMax);
                            return {
                              ...current,
                              target_sets_min: normalized.minSets,
                              target_sets: normalized.targetSets,
                              target_sets_max: normalized.maxSets,
                            };
                          });
                        }}
                      />
                      <RangeCell
                        label="Reps↓"
                        value={exercise.target_reps_min}
                        onCommit={(parsed) => {
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => ({
                            ...current,
                            target_reps_min: Number.isNaN(parsed) ? current.target_reps_min : parsed,
                          }));
                        }}
                      />
                      <RangeCell
                        label="Reps↑"
                        value={exercise.target_reps_max}
                        onCommit={(parsed) => {
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => ({
                            ...current,
                            target_reps_max: Number.isNaN(parsed) ? current.target_reps_max : parsed,
                          }));
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {customError && <p className="border-l-2 border-[var(--color-accent)] pl-4 py-1 t-caption text-[var(--color-accent)]">{customError}</p>}

        <Button size="lg" className="w-full" onClick={handleCreateCustom} disabled={loading} loading={loading}>
          {loading ? 'Creating program…' : 'Create program'}
        </Button>
      </div>
    );
  }

  return null;
}

/** Compact numeric cell for set/rep ranges */
function RangeCell({
  label,
  value,
  onCommit,
  emphasized = false,
}: {
  label: string;
  value: number;
  onCommit: (parsed: number) => void;
  emphasized?: boolean;
}) {
  return (
    <label className="flex flex-col items-center gap-1">
      <span className="t-label-sm text-[9px]">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={String(value)}
        onChange={(event) => onCommit(Number(event.target.value || 0))}
        className={`well w-full min-h-10 text-center t-data-sm outline-none focus:ring-[1.5px] focus:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] ${
          emphasized ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'
        }`}
      />
    </label>
  );
}
