import { memo } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronUp, Link2, X } from 'lucide-react';
import { useSplitEditStore, type DraftExercise } from '@/stores/splitEditStore';
import { SetRangeFields } from '@/components/split/SetRangeFields';
import { isPendingExerciseId } from '@/lib/customExercises';
import { RowMenu } from './RowMenu';
import type { PickExercise } from './types';

/**
 * One exercise: tap the name to swap, then its targets. Memoized on the draft
 * row, which the store only replaces when this exercise changes.
 */
export const ExerciseRow = memo(function ExerciseRow({
  dayId,
  exercise,
  index,
  inSuperset,
  canMoveUp,
  canMoveDown,
  onPickExercise,
}: {
  dayId: string;
  exercise: DraftExercise;
  index: number;
  inSuperset: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPickExercise: PickExercise;
}) {
  const reorderExercise = useSplitEditStore((s) => s.reorderExercise);
  const updateExerciseTargets = useSplitEditStore((s) => s.updateExerciseTargets);
  const removeExercise = useSplitEditStore((s) => s.removeExercise);
  const name = exercise.exercise.name;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>

        <button
          type="button"
          className="pressable flex-1 min-w-0 min-h-11 text-left group flex items-center gap-1.5"
          onClick={() => onPickExercise(dayId, 'swap', exercise.id)}
          aria-label={`Swap ${name}`}
        >
          <span className="flex flex-col min-w-0">
            <span className="t-body text-[var(--color-text)] break-words">{name}</span>
            {isPendingExerciseId(exercise.exercise_id) && (
              <span className="t-caption">Custom · added on save</span>
            )}
          </span>
          <ArrowRightLeft
            className="w-3.5 h-3.5 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors shrink-0"
            strokeWidth={1.5}
            aria-hidden
          />
        </button>

        <button
          type="button"
          className="pressable studio-row-action flex items-center justify-center w-11 h-11 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
          aria-label={`Remove ${name}`}
          onClick={() => removeExercise(dayId, exercise.id)}
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
        </button>
        <RowMenu
          label={`More for ${name}`}
          items={[
            ...(inSuperset ? [] : [{
              label: 'Add superset',
              icon: <Link2 className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
              onSelect: () => onPickExercise(dayId, 'superset', exercise.id),
            }]),
            {
              label: inSuperset ? 'Move superset earlier' : 'Move earlier',
              icon: <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
              disabled: !canMoveUp,
              onSelect: () => reorderExercise(dayId, exercise.id, -1),
            },
            {
              label: inSuperset ? 'Move superset later' : 'Move later',
              icon: <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />,
              disabled: !canMoveDown,
              onSelect: () => reorderExercise(dayId, exercise.id, 1),
            },
          ]}
        />
      </div>

      <SetRangeFields
        values={exercise}
        onCommitSets={(range) => updateExerciseTargets(dayId, exercise.id, range)}
        onCommitReps={(patch) => updateExerciseTargets(dayId, exercise.id, patch)}
      />
    </div>
  );
});
