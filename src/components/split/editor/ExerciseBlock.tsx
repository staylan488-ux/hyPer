import { memo } from 'react';
import { motion } from 'motion/react';
import { Unlink2 } from 'lucide-react';
import { useSplitEditStore, type DraftExercise } from '@/stores/splitEditStore';
import { springs } from '@/lib/animations';
import { DragHandle, SortableItem } from './SortableList';
import { ExerciseRow } from './ExerciseRow';
import type { PickExercise } from './types';

type ExerciseBlockProps = {
  dayId: string;
  members: DraftExercise[];
  firstIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onPickExercise: PickExercise;
};

// Blocks are regrouped on every change to the day, so compare members by row.
function sameBlock(previous: ExerciseBlockProps, next: ExerciseBlockProps): boolean {
  return previous.dayId === next.dayId
    && previous.firstIndex === next.firstIndex
    && previous.isFirst === next.isFirst
    && previous.isLast === next.isLast
    && previous.onPickExercise === next.onPickExercise
    && previous.members.length === next.members.length
    && previous.members.every((member, index) => member === next.members[index]);
}

/**
 * The unit that drags: one exercise, or a superset pair that always moves
 * together. Enter and exit fade; there is no layout animation, so editing one
 * row never measures the others.
 */
export const ExerciseBlock = memo(function ExerciseBlock({
  dayId,
  members,
  firstIndex,
  isFirst,
  isLast,
  onPickExercise,
}: ExerciseBlockProps) {
  const clearExerciseSuperset = useSplitEditStore((s) => s.clearExerciseSuperset);
  const superset = members.length > 1;
  const label = members.map((member) => member.exercise.name).join(' and ');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={springs.settle}
    >
      <SortableItem id={members[0].id} label={superset ? `superset ${label}` : label}>
        <div className="split-block">
          <DragHandle />
          <div className={`split-block-members ${superset ? 'split-superset' : ''}`}>
            {superset && (
              <div className="flex items-center justify-between gap-2 -mt-1 -mb-2">
                <span className="metal-eyebrow">Superset</span>
                <button
                  type="button"
                  className="metal-text-btn is-quiet text-[13px] gap-1.5"
                  onClick={() => clearExerciseSuperset(dayId, members[0].id)}
                  aria-label={`Split superset ${label}`}
                >
                  <Unlink2 className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
                  Unlink
                </button>
              </div>
            )}
            {members.map((member, offset) => (
              <ExerciseRow
                key={member.id}
                dayId={dayId}
                exercise={member}
                index={firstIndex + offset}
                inSuperset={superset}
                canMoveUp={!isFirst}
                canMoveDown={!isLast}
                onPickExercise={onPickExercise}
              />
            ))}
          </div>
        </div>
      </SortableItem>
    </motion.div>
  );
}, sameBlock);
