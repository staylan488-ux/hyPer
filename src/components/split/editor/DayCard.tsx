import { memo, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/shared';
import { useSplitEditStore, type DraftDay } from '@/stores/splitEditStore';
import { exerciseBlocks } from '@/lib/splitDraft';
import { springs } from '@/lib/animations';
import { CommitInput } from './CommitInput';
import { DragHandle, SortableItem, SortableList } from './SortableList';
import { ExerciseBlock } from './ExerciseBlock';
import { RowMenu } from './RowMenu';
import type { PickExercise } from './types';

function blockStartIndexes(blocks: ReadonlyArray<readonly unknown[]>): number[] {
  const starts: number[] = [];
  let start = 0;
  for (const block of blocks) {
    starts.push(start);
    start += block.length;
  }
  return starts;
}

/**
 * A training day: a one-line overview until opened, then its name and
 * exercises. Memoized on the draft day, which the store only replaces when
 * this day changes.
 */
export const DayCard = memo(function DayCard({
  day,
  index,
  total,
  expanded,
  onToggle,
  onPickExercise,
}: {
  day: DraftDay;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: (dayId: string) => void;
  onPickExercise: PickExercise;
}) {
  const renameDay = useSplitEditStore((s) => s.renameDay);
  const reorderDays = useSplitEditStore((s) => s.reorderDays);
  const removeDay = useSplitEditStore((s) => s.removeDay);
  const moveExerciseTo = useSplitEditStore((s) => s.moveExerciseTo);

  const fallbackName = `Day ${index + 1}`;
  const dayLabel = day.day_name.trim() || fallbackName;
  const exerciseSummary = day.exercises.map((exercise) => exercise.exercise.name).join(' · ');
  const blocks = useMemo(() => exerciseBlocks(day.exercises), [day.exercises]);
  const blockIds = useMemo(() => blocks.map((block) => block[0].id), [blocks]);
  // Where each block's first exercise sits in the day, for its number.
  const blockStarts = useMemo(() => blockStartIndexes(blocks), [blocks]);

  const commitName = useCallback((name: string) => renameDay(day.id, name), [renameDay, day.id]);
  const moveBlock = useCallback(
    (activeId: string, overId: string) => moveExerciseTo(day.id, activeId, overId),
    [moveExerciseTo, day.id],
  );
  const describeBlock = useCallback((id: string) => {
    const block = blocks.find((entry) => entry[0].id === id);
    return block ? block.map((member) => member.exercise.name).join(' and ') : 'exercise';
  }, [blocks]);

  return (
    <SortableItem id={day.id} label={dayLabel}>
      <Card variant="slab" animated={false} className="material-surface space-y-5">
        <div className={`flex items-center gap-1 ${expanded ? 'pb-4 border-b border-[var(--color-border)]' : ''}`}>
          <DragHandle />
          <span className="t-data-sm text-[var(--color-text-dim)] shrink-0 w-6">
            {String(index + 1).padStart(2, '0')}
          </span>

          {expanded ? (
            <div className="flex-1 min-w-0">
              <CommitInput
                aria-label={`${fallbackName} name`}
                value={day.day_name}
                onCommit={commitName}
                placeholder="Day name"
                maxLength={40}
              />
            </div>
          ) : (
            <button
              type="button"
              className="pressable flex-1 min-w-0 min-h-11 text-left flex flex-col justify-center"
              onClick={() => onToggle(day.id)}
              aria-expanded={false}
              aria-label={`Edit ${dayLabel}, ${day.exercises.length} exercises`}
            >
              <span className="t-heading break-words">{dayLabel}</span>
              <span className="t-caption line-clamp-2 mt-0.5">{exerciseSummary || 'No exercises yet'}</span>
            </button>
          )}

          <RowMenu
            label={`More for ${dayLabel}`}
            items={[
              {
                label: 'Move day earlier',
                icon: <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
                disabled: index === 0,
                onSelect: () => reorderDays(day.id, -1),
              },
              {
                label: 'Move day later',
                icon: <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
                disabled: index === total - 1,
                onSelect: () => reorderDays(day.id, 1),
              },
              {
                label: 'Remove day',
                icon: <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
                destructive: true,
                onSelect: () => removeDay(day.id),
              },
            ]}
          />
          <button
            type="button"
            className="pressable studio-row-action flex items-center justify-center w-11 h-11 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${dayLabel}` : `Expand ${dayLabel}`}
            onClick={() => onToggle(day.id)}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        {expanded && (
          <>
            <div className="flex items-baseline justify-between">
              <span className="t-label">Exercises</span>
              <span className="t-data-sm text-[var(--color-muted)]">{day.exercises.length} total</span>
            </div>

            {day.exercises.length === 0 ? (
              <p className="t-caption py-3 border-t border-[var(--color-border)]">No exercises yet. Tap below to add.</p>
            ) : (
              <SortableList ids={blockIds} onMove={moveBlock} describe={describeBlock}>
                {/* Existing rows appear at once; only later additions fade in. */}
                <AnimatePresence initial={false}>
                  {blocks.map((members, blockIndex) => (
                    <ExerciseBlock
                      key={members[0].id}
                      dayId={day.id}
                      members={members}
                      firstIndex={blockStarts[blockIndex]}
                      isFirst={blockIndex === 0}
                      isLast={blockIndex === blocks.length - 1}
                      onPickExercise={onPickExercise}
                    />
                  ))}
                </AnimatePresence>
              </SortableList>
            )}

            <motion.button
              type="button"
              className="pressable studio-row-action w-full min-h-11 flex items-center justify-center gap-2 py-3 t-label hover:text-[var(--color-text)] transition-colors"
              onClick={() => onPickExercise(day.id, 'add')}
              whileTap={{ scale: 0.99 }}
              transition={springs.tactile}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
              Add exercises
            </motion.button>
          </>
        )}
      </Card>
    </SortableItem>
  );
});
