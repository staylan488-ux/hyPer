import { useEffect, useMemo, useRef, useState, useDeferredValue, type ReactNode } from 'react';
import { Loader2, Search, Dumbbell, ArrowRight, Check, ChevronDown } from 'lucide-react';
import { Modal, Input, Chip, Button } from '@/components/shared';
import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import { exerciseCategory, searchExercises } from '@/lib/exerciseSearch';
import type { Exercise, MuscleGroup } from '@/types';
import { MUSCLE_GROUP_LABELS } from '@/types';

interface ExercisePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  /** If provided, pre-filter to this muscle group (for swapping) */
  initialMuscleGroup?: MuscleGroup;
  /** Title shown in the header */
  title?: string;
  excludeExerciseIds?: string[];
  /** Shown above the search, e.g. context or a shortcut for this choice. */
  intro?: ReactNode;
  /** Stay open after a pick so several exercises can be added in one go. */
  keepOpenOnSelect?: boolean;
}

const ALL_MUSCLE_GROUPS = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];

// The library rarely changes; cached rows show instantly and are refreshed
// in the background at most this often.
const LIBRARY_MAX_AGE_MS = 5 * 60_000;

/** Groups exercises by primary muscle, keeping their order within and across groups. */
function groupByMuscle(exercises: Exercise[]): Array<[MuscleGroup, Exercise[]]> {
  const groups = new Map<MuscleGroup, Exercise[]>();
  for (const exercise of exercises) {
    const list = groups.get(exercise.muscle_group);
    if (list) {
      list.push(exercise);
    } else {
      groups.set(exercise.muscle_group, [exercise]);
    }
  }
  return Array.from(groups.entries());
}

/**
 * Inner content component — mounts/unmounts with Modal visibility,
 * so all state resets naturally each time the picker opens.
 */
function ExercisePickerContent({
  onClose,
  onSelect,
  initialMuscleGroup,
  excludeExerciseIds = [],
  intro,
  keepOpenOnSelect = false,
}: {
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  initialMuscleGroup?: MuscleGroup;
  excludeExerciseIds?: string[];
  intro?: ReactNode;
  keepOpenOnSelect?: boolean;
}) {
  // Rows from earlier opens show immediately; a fresh copy replaces them quietly.
  const [exercises, setExercises] = useState<Exercise[]>(() => peekExerciseLibrary() ?? []);
  const [loading, setLoading] = useState(() => peekExerciseLibrary() === null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const excludedSet = useMemo(() => new Set(excludeExerciseIds), [excludeExerciseIds]);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'all'>(
    initialMuscleGroup ?? 'all'
  );
  const [showCalisthenics, setShowCalisthenics] = useState(false);
  // Picked while the picker stays open (add mode); shown as added, not hidden.
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const filterScrollRef = useRef<HTMLDivElement>(null);

  // Load (or revalidate) exercises on mount (each time picker opens) and on retry
  useEffect(() => {
    let cancelled = false;

    const fetchExercises = async () => {
      const hadCache = peekExerciseLibrary() !== null;
      try {
        const rows = await getExerciseLibrary({ maxAgeMs: hadCache ? LIBRARY_MAX_AGE_MS : Infinity });
        if (!cancelled && (rows.length > 0 || !hadCache)) {
          setExercises(rows);
        }
      } catch {
        // with cached rows on screen a failed refresh changes nothing
        if (!cancelled && !hadCache) {
          setLoadFailed(true);
        }
      }
      if (!cancelled) {
        setLoading(false);
      }
    };

    void fetchExercises();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const retryLoad = () => {
    setLoadFailed(false);
    setLoading(true);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const filteredExercises = useMemo(() => {
    let result = exercises.filter((exercise) => !excludedSet.has(exercise.id));

    // Filter by muscle group
    if (selectedMuscle !== 'all') {
      result = result.filter(
        (exercise) =>
          exercise.muscle_group === selectedMuscle ||
          exercise.muscle_group_secondary === selectedMuscle
      );
    }

    // Every word of the search has to match; best matches first
    return searchExercises(result, deferredSearchQuery);
  }, [deferredSearchQuery, excludedSet, exercises, selectedMuscle]);

  const isSearching = deferredSearchQuery.trim().length > 0;

  // Everyday gym movements first; niche calisthenics skills in their own section
  const { gymGroups, calisthenics } = useMemo(() => {
    const gym: Exercise[] = [];
    const other: Exercise[] = [];
    for (const exercise of filteredExercises) {
      (exerciseCategory(exercise) === 'calisthenics' ? other : gym).push(exercise);
    }
    return { gymGroups: groupByMuscle(gym), calisthenics: other };
  }, [filteredExercises]);

  // A search always shows its calisthenics matches
  const calisthenicsForced = isSearching || gymGroups.length === 0;
  const calisthenicsOpen = showCalisthenics || calisthenicsForced;
  const addedSet = useMemo(() => new Set(addedIds), [addedIds]);

  const handleSelect = (exercise: Exercise) => {
    if (addedSet.has(exercise.id)) return;
    onSelect(exercise);
    if (keepOpenOnSelect) {
      setAddedIds((current) => [...current, exercise.id]);
    } else {
      onClose();
    }
  };

  const renderRow = (exercise: Exercise) => {
    const added = addedSet.has(exercise.id);
    return (
      <li key={exercise.id} className="border-t border-[var(--color-border)] first:border-t-0">
        <button
          onClick={() => handleSelect(exercise)}
          disabled={added}
          aria-label={added ? `${exercise.name}, added` : undefined}
          className="pressable group w-full text-left py-3 flex items-baseline gap-3 disabled:cursor-default"
          type="button"
        >
          <span className="flex-1 min-w-0">
            <span className="flex items-baseline gap-2">
              <span className={`t-body break-words ${added ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]'}`}>
                {exercise.name}
              </span>
              {exercise.is_compound && (
                <span className="t-label-sm shrink-0 text-[var(--color-accent)]">
                  Compound
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-1">
              {exercise.muscle_group_secondary && (
                <span className="t-caption">+{MUSCLE_GROUP_LABELS[exercise.muscle_group_secondary]}</span>
              )}
              {exercise.equipment && (
                <span className="t-caption">{exercise.equipment}</span>
              )}
            </span>
          </span>
          {added ? (
            <span className="t-label-sm self-center shrink-0 flex items-center gap-1 text-[var(--color-text)]">
              <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden />
              Added
            </span>
          ) : (
            <ArrowRight className="w-4 h-4 self-center shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.5} />
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="pt-4 space-y-6">
      {intro}
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-muted)] pointer-events-none z-10" strokeWidth={1.75} />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search exercises..."
          className="pl-9"
        />
      </div>

      {/* Muscle group filter — tracked-caps chips on a hairline */}
      <div>
        <p className="t-label mb-3">Muscle group</p>
        <div
          ref={filterScrollRef}
          className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar"
        >
          {/* "All" chip */}
          <Chip
            tone="sage"
            size="sm"
            selected={selectedMuscle === 'all'}
            onClick={() => setSelectedMuscle('all')}
            className="shrink-0"
          >
            All
          </Chip>

          {ALL_MUSCLE_GROUPS.map((group) => (
            <Chip
              key={group}
              tone="sage"
              size="sm"
              selected={selectedMuscle === group}
              onClick={() => setSelectedMuscle(group)}
              className="shrink-0"
            >
              {MUSCLE_GROUP_LABELS[group]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Exercise list — hairline rows grouped by muscle */}
      <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 overscroll-contain touch-pan-y">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-muted)]" strokeWidth={1.5} />
            <p className="t-label-sm">Loading exercises...</p>
          </div>
        ) : loadFailed ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Dumbbell className="w-6 h-6 text-[var(--color-muted)]" strokeWidth={1.25} />
            <p className="t-body text-[var(--color-text)]">Couldn't load exercises</p>
            <p className="t-caption">Check your connection and try again</p>
            <Button variant="secondary" size="sm" className="mt-1" onClick={retryLoad}>
              Retry
            </Button>
          </div>
        ) : filteredExercises.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Dumbbell className="w-6 h-6 text-[var(--color-muted)]" strokeWidth={1.25} />
            <p className="t-body text-[var(--color-text)]">No exercises found</p>
            <p className="t-caption">Try a different search or muscle group</p>
          </div>
        ) : (
          <div key={selectedMuscle} className="space-y-7">
            {gymGroups.map(([group, groupExercises]) => (
              <section key={group}>
                <div className="flex items-baseline justify-between pb-2 border-b border-[var(--color-border)]">
                  <span className="t-heading">{MUSCLE_GROUP_LABELS[group]}</span>
                  <span className="t-data-sm text-[var(--color-muted)]">{groupExercises.length}</span>
                </div>
                <ul>{groupExercises.map(renderRow)}</ul>
              </section>
            ))}

            {calisthenics.length > 0 && (
              <section>
                {calisthenicsForced ? (
                  <div className="flex items-baseline justify-between pb-2 border-b border-[var(--color-border)]">
                    <span className="t-heading">Calisthenics</span>
                    <span className="t-data-sm text-[var(--color-muted)]">{calisthenics.length}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="pressable w-full min-h-11 flex items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)] text-left"
                    onClick={() => setShowCalisthenics((open) => !open)}
                    aria-expanded={calisthenicsOpen}
                  >
                    <span className="flex flex-col">
                      <span className="t-heading">Calisthenics</span>
                      {!calisthenicsOpen && (
                        <span className="t-caption">Bodyweight skills and progressions</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="t-data-sm text-[var(--color-muted)]">{calisthenics.length}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-[var(--color-muted)] transition-transform ${calisthenicsOpen ? 'rotate-180' : ''}`}
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    </span>
                  </button>
                )}
                {calisthenicsOpen && <ul>{calisthenics.map(renderRow)}</ul>}
              </section>
            )}
          </div>
        )}
      </div>

      {keepOpenOnSelect && (
        <Button variant="primary" size="md" className="w-full" onClick={onClose}>
          {addedIds.length > 0 ? `Done · ${addedIds.length} added` : 'Done'}
        </Button>
      )}
    </div>
  );
}

export function ExercisePicker({
  isOpen,
  onClose,
  onSelect,
  initialMuscleGroup,
  title,
  excludeExerciseIds,
  intro,
  keepOpenOnSelect,
}: ExercisePickerProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || 'Choose Exercise'}
      contentClassName="touch-pan-y"
    >
      <ExercisePickerContent
        onClose={onClose}
        onSelect={onSelect}
        initialMuscleGroup={initialMuscleGroup}
        excludeExerciseIds={excludeExerciseIds}
        intro={intro}
        keepOpenOnSelect={keepOpenOnSelect}
      />
    </Modal>
  );
}
