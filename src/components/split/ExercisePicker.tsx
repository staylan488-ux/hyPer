import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { Loader2, Search, Dumbbell, ArrowRight } from 'lucide-react';
import { Modal, Input, Chip } from '@/components/shared';
import { supabase } from '@/lib/supabase';
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
}

const ALL_MUSCLE_GROUPS = Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[];

/**
 * Inner content component — mounts/unmounts with Modal visibility,
 * so all state resets naturally each time the picker opens.
 */
function ExercisePickerContent({
  onClose,
  onSelect,
  initialMuscleGroup,
  excludeExerciseIds = [],
}: {
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  initialMuscleGroup?: MuscleGroup;
  excludeExerciseIds?: string[];
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const excludedSet = useMemo(() => new Set(excludeExerciseIds), [excludeExerciseIds]);
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'all'>(
    initialMuscleGroup ?? 'all'
  );

  const filterScrollRef = useRef<HTMLDivElement>(null);

  // Fetch exercises on mount (each time picker opens)
  useEffect(() => {
    let cancelled = false;

    const fetchExercises = async () => {
      setLoading(true);
      const { data } = await supabase.from('exercises').select('*').order('name');

      if (!cancelled && data) {
        setExercises(data as Exercise[]);
      }
      if (!cancelled) {
        setLoading(false);
      }
    };

    void fetchExercises();

    return () => {
      cancelled = true;
    };
  }, []);

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

    // Filter by search query
    if (deferredSearchQuery.trim()) {
      const query = deferredSearchQuery.toLowerCase().trim();
      result = result.filter(
        (exercise) =>
          exercise.name.toLowerCase().includes(query) ||
          exercise.muscle_group.toLowerCase().includes(query) ||
          (exercise.equipment && exercise.equipment.toLowerCase().includes(query))
      );
    }

    return result;
  }, [deferredSearchQuery, excludedSet, exercises, selectedMuscle]);

  const handleSelect = (exercise: Exercise) => {
    onSelect(exercise);
    onClose();
  };

  // Group the filtered list by primary muscle, preserving name order within each
  const groupedExercises = useMemo(() => {
    const groups = new Map<MuscleGroup, Exercise[]>();
    for (const exercise of filteredExercises) {
      const list = groups.get(exercise.muscle_group);
      if (list) {
        list.push(exercise);
      } else {
        groups.set(exercise.muscle_group, [exercise]);
      }
    }
    return Array.from(groups.entries());
  }, [filteredExercises]);

  return (
    <div className="pt-4 space-y-6">
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
        ) : filteredExercises.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Dumbbell className="w-6 h-6 text-[var(--color-muted)]" strokeWidth={1.25} />
            <p className="t-body text-[var(--color-text)]">No exercises found</p>
            <p className="t-caption">Try a different search or muscle group</p>
          </div>
        ) : (
          <div key={selectedMuscle} className="space-y-7">
            {groupedExercises.map(([group, groupExercises]) => (
              <section key={group}>
                <div className="flex items-baseline justify-between pb-2 border-b border-[var(--color-text)]">
                  <span className="t-heading">{MUSCLE_GROUP_LABELS[group]}</span>
                  <span className="t-data-sm text-[var(--color-muted)]">{groupExercises.length}</span>
                </div>
                <ul>
                  {groupExercises.map((exercise) => (
                    <li key={exercise.id} className="border-t border-[var(--color-border)] first:border-t-0">
                      <button
                        onClick={() => handleSelect(exercise)}
                        className="pressable group w-full text-left py-3 flex items-baseline gap-3"
                        type="button"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline gap-2">
                            <span className="t-body text-[var(--color-text)] truncate">
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
                        <ArrowRight className="w-4 h-4 self-center shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.5} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
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
      />
    </Modal>
  );
}
