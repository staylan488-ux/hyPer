import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Dumbbell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Modal, Input } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { springs, staggerContainer, fadeUp } from '@/lib/animations';
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
}: {
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  initialMuscleGroup?: MuscleGroup;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
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
    let result = exercises;

    // Filter by muscle group
    if (selectedMuscle !== 'all') {
      result = result.filter(
        (exercise) =>
          exercise.muscle_group === selectedMuscle ||
          exercise.muscle_group_secondary === selectedMuscle
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (exercise) =>
          exercise.name.toLowerCase().includes(query) ||
          exercise.muscle_group.toLowerCase().includes(query) ||
          (exercise.equipment && exercise.equipment.toLowerCase().includes(query))
      );
    }

    return result;
  }, [exercises, selectedMuscle, searchQuery]);

  const handleSelect = (exercise: Exercise) => {
    onSelect(exercise);
    onClose();
  };

  return (
    <div className="pt-4 space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-muted)] pointer-events-none z-10" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search exercises..."
          className="pl-9"
        />
      </div>

      {/* Muscle group filter pills */}
      <div>
        <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">
          Muscle Group
        </p>
        <div
          ref={filterScrollRef}
          className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide"
        >
          {/* "All" pill */}
          <button
            onClick={() => setSelectedMuscle('all')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-[12px] text-[10px] tracking-[0.08em] uppercase whitespace-nowrap transition-colors ${
              selectedMuscle === 'all'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[var(--color-surface-high)] text-[var(--color-text-dim)] border border-[var(--color-border)]'
            }`}
          >
            All
          </button>

          {ALL_MUSCLE_GROUPS.map((group) => (
            <button
              key={group}
              onClick={() => setSelectedMuscle(group)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-[12px] text-[10px] tracking-[0.08em] uppercase whitespace-nowrap transition-colors ${
                selectedMuscle === group
                  ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                  : 'bg-[var(--color-surface-high)] text-[var(--color-text-dim)] border border-[var(--color-border)]'
              }`}
            >
              {MUSCLE_GROUP_LABELS[group]}
            </button>
          ))}
        </div>
      </div>

      {/* Exercise list */}
      <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-muted)]" />
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">
              Loading exercises...
            </p>
          </div>
        ) : filteredExercises.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="p-3 rounded-[16px] bg-[var(--color-surface-high)]">
              <Dumbbell className="w-5 h-5 text-[#6B6B6B]" strokeWidth={1.5} />
            </div>
            <p className="text-xs text-[var(--color-muted)]">No exercises found</p>
            <p className="text-[10px] text-[#6B6B6B]">
              Try a different search or muscle group
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedMuscle}-${searchQuery}`}
              className="space-y-1.5"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {filteredExercises.map((exercise) => (
                <motion.button
                  key={exercise.id}
                  variants={fadeUp}
                  transition={springs.smooth}
                  onClick={() => handleSelect(exercise)}
                  className="w-full text-left px-3.5 py-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)] active:bg-[var(--color-surface-high)] transition-colors group"
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[var(--color-text)] group-hover:text-[#E8E4DE] transition-colors truncate">
                      {exercise.name}
                    </p>
                    {exercise.is_compound && (
                      <span className="flex-shrink-0 px-2 py-0.5 rounded-[10px] bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[9px] tracking-[0.1em] uppercase">
                        Compound
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="px-2 py-0.5 rounded-[8px] bg-[var(--color-surface-high)] text-[10px] text-[#6B6B6B]">
                      {MUSCLE_GROUP_LABELS[exercise.muscle_group]}
                    </span>
                    {exercise.muscle_group_secondary && (
                      <span className="px-2 py-0.5 rounded-[8px] bg-[var(--color-surface-high)] text-[10px] text-[#6B6B6B]">
                        {MUSCLE_GROUP_LABELS[exercise.muscle_group_secondary]}
                      </span>
                    )}
                    {exercise.equipment && (
                      <span className="px-2 py-0.5 rounded-[8px] bg-[var(--color-surface-high)] text-[10px] text-[#6B6B6B]">
                        {exercise.equipment}
                      </span>
                    )}
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </AnimatePresence>
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
}: ExercisePickerProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Choose Exercise'}>
      <ExercisePickerContent
        onClose={onClose}
        onSelect={onSelect}
        initialMuscleGroup={initialMuscleGroup}
      />
    </Modal>
  );
}
