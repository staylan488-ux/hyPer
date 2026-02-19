import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Wand2 } from 'lucide-react';
import { Button, Input, Card } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { splitTemplates } from '@/lib/splitTemplates';
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

export function SplitBuilder({ onComplete }: SplitBuilderProps) {
  const { createSplit } = useAppStore();
  const [step, setStep] = useState<Step>('choose');
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
  }, [activeCustomDayIndex, step]);

  const activeCustomDay = days[activeCustomDayIndex];

  const addExerciseToCustomDay = (exercise: { id: string; name: string }) => {
    if (!activeCustomDay) return;

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
        return {
          ...day,
          exercises: day.exercises.map((exercise) =>
            exercise.local_id === localId ? updater(exercise) : exercise
          ),
        };
      })
    );
  };

  const removeCustomExercise = (dayIndex: number, localId: string) => {
    setDays((current) =>
      current.map((day, index) => {
        if (index !== dayIndex) return day;
        return {
          ...day,
          exercises: day.exercises.filter((exercise) => exercise.local_id !== localId),
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
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= day.exercises.length) return day;

        const nextExercises = [...day.exercises];
        const [moving] = nextExercises.splice(currentIndex, 1);
        nextExercises.splice(targetIndex, 0, moving);
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
          .upsert(
            {
              name: exercise.name,
              muscle_group: exercise.custom_muscle_group,
              muscle_group_secondary: null,
              equipment: null,
              is_compound: false,
            },
            { onConflict: 'name' }
          )
          .select('id, name')
          .single();

        if (error || !data) {
          throw new Error(`Could not create exercise: ${exercise.name}`);
        }

        const createdId = data.id as string;
        normalizedToId.set(normalizedName, createdId);
        return createdId;
      };

      const splitDays = await Promise.all(
        days.map(async (day, dayIndex) => ({
          day_name: day.day_name,
          day_order: dayIndex,
          exercises: await Promise.all(
            day.exercises.map(async (exercise, exerciseIndex) => {
              const normalizedRange = normalizeCustomSetRange(exercise);

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
              };
            })
          ),
        }))
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

  if (step === 'choose') {
    return (
      <div className="space-y-4">
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] text-center mb-8">
          Build a program your way
        </p>

        <button
          className="w-full flex items-center justify-between p-5 bg-[#242424] border border-white/5 rounded-[24px] hover:border-white/10 transition-colors group"
          onClick={() => setStep('guided')}
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-[16px] bg-[#2E2E2E]">
              <Wand2 className="w-5 h-5 text-[#E8E4DE]" strokeWidth={1.5} />
            </div>
            <div className="text-left">
              <p className="text-sm text-[#E8E4DE]">Guided Builder</p>
              <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">
                Answer a few questions and auto-generate
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#6B6B6B] group-hover:text-[#9A9A9A] transition-colors" />
        </button>

        <button
          className="w-full flex items-center justify-between p-5 bg-[#242424] border border-white/5 rounded-[24px] hover:border-white/10 transition-colors group"
          onClick={() => setStep('custom-name')}
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-[16px] bg-[#2E2E2E]">
              <span className="text-lg">✏️</span>
            </div>
            <div className="text-left">
              <p className="text-sm text-[#E8E4DE]">Custom</p>
              <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">Build manually</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#6B6B6B] group-hover:text-[#9A9A9A] transition-colors" />
        </button>
      </div>
    );
  }

  if (step === 'guided') {
    const renderOptionRow = (
      options: Array<Option<string | number>>,
      selected: string | number,
      onSelect: (value: string | number) => void
    ) => (
      <div className="grid grid-cols-1 gap-2">
        {options.map((option) => {
          const active = selected === option.value;
          return (
            <button
              key={`${option.value}`}
              className={`w-full text-left p-3 rounded-[14px] border transition-colors ${
                active
                  ? 'bg-[#E8E4DE] text-[#1A1A1A] border-[#E8E4DE]'
                  : 'bg-[#242424] text-[#9A9A9A] border-white/5 hover:border-white/10'
              }`}
              onClick={() => onSelect(option.value)}
            >
              <p className="text-xs font-medium">{option.label}</p>
              <p className={`text-[10px] mt-1 ${active ? 'text-[#3D3D3D]' : 'text-[#6B6B6B]'}`}>
                {option.hint}
              </p>
            </button>
          );
        })}
      </div>
    );

    return (
      <div className="space-y-5">
        <button
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] transition-colors"
          onClick={() => setStep('choose')}
          disabled={loading}
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>

        <Card variant="slab" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] mb-1">Program Interview</p>
            <h4 className="text-sm text-[#E8E4DE]">Tell us how you train</h4>
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Days per week</p>
            {renderOptionRow(DAY_OPTIONS, guidedAnswers.daysPerWeek, (value) =>
              setGuidedAnswers((current) => ({ ...current, daysPerWeek: Number(value) }))
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Focus</p>
            {renderOptionRow(FOCUS_OPTIONS, guidedAnswers.focus, (value) =>
              setGuidedAnswers((current) => ({ ...current, focus: value as ProgramFocus }))
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Equipment</p>
            {renderOptionRow(EQUIPMENT_OPTIONS, guidedAnswers.equipment, (value) =>
              setGuidedAnswers((current) => ({ ...current, equipment: value as EquipmentProfile }))
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Session length</p>
            {renderOptionRow(SESSION_OPTIONS, guidedAnswers.sessionLength, (value) =>
              setGuidedAnswers((current) => ({ ...current, sessionLength: value as SessionLength }))
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Training experience</p>
            {renderOptionRow(EXPERIENCE_OPTIONS, guidedAnswers.experience, (value) =>
              setGuidedAnswers((current) => ({ ...current, experience: value as ExperienceLevel }))
            )}
          </div>
        </Card>

        <Card variant="slab">
          <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Recommended</p>
          <h4 className="text-sm text-[#E8E4DE] mb-2">{guidedTemplate.name}</h4>
          <p className="text-[10px] text-[#6B6B6B] leading-relaxed">{guidedTemplate.description}</p>
        </Card>

        <Button className="w-full" onClick={() => setStep('guided-review')} disabled={loading}>
          Review Program
        </Button>
      </div>
    );
  }

  if (step === 'guided-review') {
    return (
      <div className="space-y-5">
        <button
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] transition-colors disabled:opacity-40"
          onClick={() => setStep('guided')}
          disabled={loading}
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>

        <Card variant="slab" className="space-y-3">
          <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Guided Recommendation</p>
          <h4 className="text-sm text-[#E8E4DE]">{guidedTemplate.name}</h4>
          <p className="text-[10px] text-[#6B6B6B] leading-relaxed">{guidedTemplate.description}</p>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 bg-[#1A1A1A] text-[9px] tracking-[0.1em] uppercase rounded-[10px] text-[#9A9A9A]">
              {guidedTemplate.days_per_week} days/week
            </span>
            <span className="px-3 py-1 bg-[#1A1A1A] text-[9px] tracking-[0.1em] uppercase rounded-[10px] text-[#9A9A9A]">
              {guidedTemplate.days.reduce((acc, day) => acc + day.exercises.length, 0)} exercises
            </span>
          </div>
        </Card>

        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          {guidedTemplate.days.map((day, dayIndex) => (
            <Card key={day.day_name} variant="slab" className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#E8E4DE]">{day.day_name}</p>
                <span className="text-[10px] text-[#6B6B6B] tabular-nums">{day.exercises.length} exercises</span>
              </div>
              <div className="space-y-1">
                {day.exercises.slice(0, 4).map((exercise, exerciseIndex) => (
                  <div key={`${exercise.name}-${exerciseIndex}`} className="flex items-center justify-between text-[10px]">
                    <span className="text-[#9A9A9A]">{exerciseIndex + 1}. {exercise.name}</span>
                    <span className="text-[#6B6B6B] tabular-nums">
                      {exercise.sets}x{exercise.reps_min}-{exercise.reps_max}
                    </span>
                  </div>
                ))}
                {day.exercises.length > 4 && (
                  <p className="text-[10px] text-[#6B6B6B]">+{day.exercises.length - 4} more exercises</p>
                )}
              </div>
              {dayIndex < guidedTemplate.days.length - 1 && <div className="h-px bg-white/5" />}
            </Card>
          ))}
        </div>

        <Button className="w-full" disabled={loading} onClick={() => createFromTemplate(guidedTemplate)}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Program...
            </>
          ) : (
            'Build My Program'
          )}
        </Button>
      </div>
    );
  }

  if (step === 'custom-name') {
    return (
      <div className="space-y-5">
        <button
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] mb-4 transition-colors"
          onClick={() => setStep('choose')}
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>

        <Input
          label="Program Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g., My Upper/Lower"
        />

        <Input
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional description..."
        />

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-[#6B6B6B] mb-3">Days per Week</label>
          <div className="flex gap-2">
            {[3, 4, 5, 6].map((dayCount) => (
              <button
                key={dayCount}
                className={`flex-1 py-3 rounded-[16px] text-sm transition-all ${
                  daysPerWeek === dayCount
                    ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                    : 'bg-[#2E2E2E] text-[#9A9A9A] border border-white/5 hover:border-white/10'
                }`}
                onClick={() => setDaysPerWeek(dayCount)}
              >
                {dayCount}
              </button>
            ))}
          </div>
        </div>

        <Button
          className="w-full mt-6"
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
        </Button>
      </div>
    );
  }

  if (step === 'custom-days') {
    return (
      <div className="space-y-5">
        <button
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] mb-4 transition-colors"
          onClick={() => setStep('custom-name')}
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>

        <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B] mb-4">Name each training day</p>

        {days.map((day, index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[10px] bg-[#2E2E2E] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] text-[#6B6B6B] tabular-nums">{String(index + 1).padStart(2, '0')}</span>
            </div>
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

        <Button className="w-full mt-6" onClick={() => setStep('custom-exercises')} disabled={loading}>
          Continue to Exercise Setup
        </Button>
      </div>
    );
  }

  if (step === 'custom-exercises') {
    const filteredExercises = exerciseLibrary.filter((exercise) =>
      exercise.name.toLowerCase().includes(exerciseQuery.toLowerCase())
    );

    return (
      <div className="space-y-5">
        <button
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] mb-2 transition-colors"
          onClick={() => setStep('custom-days')}
        >
          <ChevronLeft className="w-3 h-3" />
          Back
        </button>

        <Card variant="slab" className="space-y-3">
          <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">Custom Program Builder</p>
          <h4 className="text-sm text-[#E8E4DE]">Add exercises for each training day</h4>
          <p className="text-[10px] text-[#6B6B6B]">Choose or type exercises, then set target sets and rep ranges.</p>
        </Card>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((day, index) => (
            <button
              key={`${day.day_name}-${index}`}
              onClick={() => setActiveCustomDayIndex(index)}
              className={`px-3 py-2 rounded-[12px] text-[10px] tracking-[0.08em] uppercase whitespace-nowrap transition-colors ${
                activeCustomDayIndex === index
                  ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                  : 'bg-[#2E2E2E] text-[#9A9A9A] border border-white/5'
              }`}
            >
              {day.day_name}
            </button>
          ))}
        </div>

        {activeCustomDay && (
          <Card variant="slab" className="space-y-4">
            <div>
              <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Editing</p>
              <h4 className="text-sm text-[#E8E4DE]">{activeCustomDay.day_name}</h4>
            </div>

            <div className="space-y-2">
              <Input
                value={exerciseQuery}
                onChange={(event) => setExerciseQuery(event.target.value)}
                placeholder="Search exercise library..."
              />
              {tapFeedback && (
                <p
                  className={`text-[10px] ${
                    tapFeedback.tone === 'ok' ? 'text-[#9AC39A]' : 'text-[#9FA6B0]'
                  }`}
                >
                  {tapFeedback.message}
                </p>
              )}
              <div className="max-h-[140px] overflow-y-auto space-y-1 pr-1">
                {filteredExercises.slice(0, 8).map((exercise) => {
                  const alreadyAdded = activeCustomDay.exercises.some(
                    (entry) => entry.exercise_id === exercise.id
                  );

                  return (
                    <button
                      key={exercise.id}
                      onClick={() => addExerciseToCustomDay(exercise)}
                      className={`w-full text-left px-3 py-2 rounded-[10px] border text-[11px] transition-colors flex items-center justify-between ${
                        alreadyAdded
                          ? 'bg-[#243124] border-[#355235] text-[#A6C6A6]'
                          : 'bg-[#2A2A2A] border-white/5 text-[#C9C5BD] hover:border-white/10'
                      }`}
                    >
                      <span>{exercise.name}</span>
                      {alreadyAdded && (
                        <span className="text-[9px] tracking-[0.1em] uppercase">Added</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Or add custom exercise</p>
              <Input
                value={customExerciseName}
                onChange={(event) => setCustomExerciseName(event.target.value)}
                placeholder="Type custom exercise name"
              />
              <div className="flex gap-2 items-center">
                <select
                  value={customExerciseMuscle}
                  onChange={(event) => setCustomExerciseMuscle(event.target.value as MuscleGroup)}
                  className="flex-1 px-3 py-2 rounded-[10px] bg-[#2A2A2A] border border-white/5 text-[#C9C5BD] text-xs"
                >
                  {MUSCLE_GROUP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button onClick={addCustomExerciseToDay} disabled={!customExerciseName.trim()}>
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {activeCustomDay.exercises.length === 0 ? (
                <p className="text-[10px] text-[#6B6B6B]">No exercises added yet.</p>
              ) : (
                activeCustomDay.exercises.map((exercise, exerciseIndex) => (
                  <Card key={exercise.local_id} variant="slab" className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[#E8E4DE]">{exerciseIndex + 1}. {exercise.name}</p>
                      <button
                        onClick={() => removeCustomExercise(activeCustomDayIndex, exercise.local_id)}
                        className="text-[10px] text-[#B07A7A] hover:text-[#D69393]"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <Input
                        label="Min Sets"
                        value={String(exercise.target_sets_min)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value || 0);
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
                      <Input
                        label="Target Sets"
                        value={String(exercise.target_sets)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value || 0);
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
                      <Input
                        label="Max Sets"
                        value={String(exercise.target_sets_max)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value || 0);
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
                      <Input
                        label="Min Reps"
                        value={String(exercise.target_reps_min)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value || 0);
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => ({
                            ...current,
                            target_reps_min: Number.isNaN(parsed) ? current.target_reps_min : parsed,
                          }));
                        }}
                      />
                      <Input
                        label="Max Reps"
                        value={String(exercise.target_reps_max)}
                        onChange={(event) => {
                          const parsed = Number(event.target.value || 0);
                          updateCustomExercise(activeCustomDayIndex, exercise.local_id, (current) => ({
                            ...current,
                            target_reps_max: Number.isNaN(parsed) ? current.target_reps_max : parsed,
                          }));
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="text-[10px] px-2 py-1 rounded-[8px] bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]"
                        onClick={() => moveCustomExercise(activeCustomDayIndex, exercise.local_id, -1)}
                        disabled={exerciseIndex === 0}
                      >
                        Move Up
                      </button>
                      <button
                        className="text-[10px] px-2 py-1 rounded-[8px] bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]"
                        onClick={() => moveCustomExercise(activeCustomDayIndex, exercise.local_id, 1)}
                        disabled={exerciseIndex === activeCustomDay.exercises.length - 1}
                      >
                        Move Down
                      </button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </Card>
        )}

        {customError && <p className="text-[11px] text-[#D69393]">{customError}</p>}

        <Button className="w-full" onClick={handleCreateCustom} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Program...
            </>
          ) : (
            'Create Program'
          )}
        </Button>
      </div>
    );
  }

  return null;
}
