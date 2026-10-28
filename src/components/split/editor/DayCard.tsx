import { memo, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { LineButton } from '@/components/metal';
import { useSplitEditStore, type DraftDay } from '@/stores/splitEditStore';
import { blockStartIndexes, dayLabel as labelForDay, daySummary, exerciseBlocks } from '@/lib/splitDraft';
import { CommitInput } from './CommitInput';
import { DragHandle, SortableItem, SortableList } from './SortableList';
import { ExerciseBlock } from './ExerciseBlock';
import { RowMenu } from './RowMenu';
import type { PickExercise } from './types';

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
  const dayLabel = labelForDay(day, index);
  const exerciseSummary = daySummary(day);
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
      <div className="split-day">
        <div className="split-day-head">
          <DragHandle />
          <span className="split-index">
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
              className="flex-1 min-w-0 min-h-11 text-left flex flex-col justify-center"
              onClick={() => onToggle(day.id)}
              aria-expanded={false}
              aria-label={`Edit ${dayLabel}, ${day.exercises.length} exercises`}
            >
              <span className="split-day-name">{dayLabel}</span>
              <span className="split-day-summary">{exerciseSummary}</span>
            </button>
          )}

          <RowMenu
            label={`More for ${dayLabel}`}
            items={[
              {
                label: 'Move day earlier',
                icon: <ChevronUp strokeWidth={1.75} aria-hidden />,
                disabled: index === 0,
                onSelect: () => reorderDays(day.id, -1),
              },
              {
                label: 'Move day later',
                icon: <ChevronDown strokeWidth={1.75} aria-hidden />,
                disabled: index === total - 1,
                onSelect: () => reorderDays(day.id, 1),
              },
              {
                label: 'Remove day',
                icon: <Trash2 strokeWidth={1.75} aria-hidden />,
                destructive: true,
                onSelect: () => removeDay(day.id),
              },
            ]}
          />
          <button
            type="button"
            className="metal-icon-btn -mr-3"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${dayLabel}` : `Expand ${dayLabel}`}
            onClick={() => onToggle(day.id)}
          >
            <ChevronDown className={`transition-transform ${expanded ? 'rotate-180' : ''}`} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        {expanded && (
          <div className="split-day-body">
            <div className="split-sheet-head">
              <span className="metal-eyebrow">Exercises</span>
              <span className="metal-section-head-right">
                <span><b>{day.exercises.length}</b> total</span>
              </span>
            </div>

            {day.exercises.length === 0 ? (
              <p className="metal-row-detail py-3 border-t border-[var(--color-border-soft)]">No exercises yet. Tap below to add.</p>
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

            <LineButton plus className="mt-3" onClick={() => onPickExercise(day.id, 'add')}>Add exercises</LineButton>
          </div>
        )}
      </div>
    </SortableItem>
  );
});
