import { memo, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  X,
  Plus,
  ArrowRightLeft,
  Link2,
  Unlink2,
} from 'lucide-react';
import { Button, Input, Card } from '@/components/shared';
import { useSplitEditStore } from '@/stores/splitEditStore';
import {
  springs,
  fadeUp,
  staggerContainer,
} from '@/lib/animations';
import { SetRangeFields } from '@/components/split/SetRangeFields';
import type { DraftDay, DraftExercise } from '@/stores/splitEditStore';

// ═══════════════════════════════════
// PROPS
// ═══════════════════════════════════

interface SplitEditorProps {
  onClose: () => void;
  onSaved: () => void;
  onPickExercise: (dayId: string, mode: 'add' | 'swap' | 'superset', exerciseId?: string) => void;
}

// ═══════════════════════════════════
// EXERCISE ROW
// ═══════════════════════════════════

// Memoized: typing a day or program name leaves untouched rows alone.
const ExerciseRow = memo(function ExerciseRow({
  dayId,
  exercise,
  index,
  total,
  onPickExercise,
}: {
  dayId: string;
  exercise: DraftExercise;
  index: number;
  total: number;
  onPickExercise: SplitEditorProps['onPickExercise'];
}) {
  const reorderExercise = useSplitEditStore((s) => s.reorderExercise);
  const updateExerciseTargets = useSplitEditStore((s) => s.updateExerciseTargets);
  const removeExercise = useSplitEditStore((s) => s.removeExercise);
  const clearExerciseSuperset = useSplitEditStore((s) => s.clearExerciseSuperset);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      transition={springs.settle}
      className={`relative border-t border-[var(--color-border)] py-3 space-y-3 ${
        exercise.superset_group_id ? 'material-surface px-3' : ''
      }`}
    >
      {/* ── Top row: index + name + actions ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Record index */}
        <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* Exercise name — tappable to swap */}
        <button
          type="button"
          className="pressable flex-1 text-left group flex items-center gap-1.5 min-w-0"
          onClick={() => onPickExercise(dayId, 'swap', exercise.id)}
        >
          <span className="flex flex-col min-w-0">
            <span className="t-body text-[var(--color-text)] break-words">
              {exercise.exercise.name}
            </span>
            {exercise.superset_group_id && (
              <span className="t-label-sm flex items-center gap-1 mt-0.5">
                <Link2 className="w-3 h-3" strokeWidth={1.75} />
                Superset
              </span>
            )}
          </span>
          <ArrowRightLeft className="w-3.5 h-3.5 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity shrink-0" strokeWidth={1.5} />
        </button>

        {/* Reorder + remove */}
        <div className="flex items-center justify-end shrink-0 basis-full ml-auto">
          {exercise.superset_group_id ? (
            <motion.button
              type="button"
              className="studio-row-action p-1.5 text-[var(--color-text)] hover:text-[var(--color-text-dim)] transition-colors"
              onClick={() => clearExerciseSuperset(dayId, exercise.id)}
              whileTap={{ scale: 0.985 }}
              title="Remove Superset"
              aria-label={`Remove superset for ${exercise.exercise.name}`}
            >
              <Unlink2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => onPickExercise(dayId, 'superset', exercise.id)}
              whileTap={{ scale: 0.985 }}
              title="Add Superset"
              aria-label={`Add superset for ${exercise.exercise.name}`}
            >
              <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </motion.button>
          )}
          <motion.button
            type="button"
            className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isFirst}
            aria-label={`Move ${exercise.exercise.name} earlier`}
            onClick={() => reorderExercise(dayId, exercise.id, -1)}
            whileTap={isFirst ? undefined : { scale: 0.985 }}
          >
            <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>

          <motion.button
            type="button"
            className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isLast}
            aria-label={`Move ${exercise.exercise.name} later`}
            onClick={() => reorderExercise(dayId, exercise.id, 1)}
            whileTap={isLast ? undefined : { scale: 0.985 }}
          >
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>

          <motion.button
            type="button"
            className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
            aria-label={`Remove ${exercise.exercise.name}`}
            onClick={() => removeExercise(dayId, exercise.id)}
            whileTap={{ scale: 0.985 }}
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>
        </div>
      </div>

      {/* ── Target inputs: Set Min/Target/Max + Rep Min/Max ── */}
      <SetRangeFields
        values={exercise}
        onCommitSets={(range) => updateExerciseTargets(dayId, exercise.id, range)}
        onCommitReps={(patch) => updateExerciseTargets(dayId, exercise.id, patch)}
      />
    </motion.div>
  );
});

// ═══════════════════════════════════
// DAY CARD
// ═══════════════════════════════════

// Memoized: store actions that leave a day untouched keep its object, so
// only the edited day re-renders.
const DayCard = memo(function DayCard({
  day,
  index,
  total,
  onPickExercise,
}: {
  day: DraftDay;
  index: number;
  total: number;
  onPickExercise: SplitEditorProps['onPickExercise'];
}) {
  const renameDay = useSplitEditStore((s) => s.renameDay);
  const reorderDays = useSplitEditStore((s) => s.reorderDays);
  const removeDay = useSplitEditStore((s) => s.removeDay);

  const isFirst = index === 0;
  const isLast = index === total - 1;

  const handleRemoveDay = useCallback(() => {
    const confirmed = window.confirm(
      `Remove "${day.day_name}"? This will delete all exercises in this day.`
    );
    if (confirmed) removeDay(day.id);
  }, [day.id, day.day_name, removeDay]);

  return (
    <motion.div
      layout
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={springs.settle}
    >
      <Card variant="slab" animated={false} className="material-surface space-y-5">
        {/* ── Day header ── */}
        <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-[var(--color-border)]">
          {/* Day index */}
          <span className="t-data-sm text-[var(--color-text-dim)] shrink-0 w-5">
            {String(index + 1).padStart(2, '0')}
          </span>

          {/* Day name input */}
          <div className="flex-1 min-w-0">
            <Input
              aria-label={`Day ${index + 1} name`}
              value={day.day_name}
              onChange={(e) => renameDay(day.id, e.target.value)}
              placeholder="Day name"
            />
          </div>

          {/* Day actions: reorder + delete */}
          <div className="flex items-center justify-end shrink-0 basis-full">
            <motion.button
              type="button"
              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isFirst}
              aria-label={`Move ${day.day_name || `day ${index + 1}`} earlier`}
              onClick={() => reorderDays(day.id, -1)}
              whileTap={isFirst ? undefined : { scale: 0.985 }}
            >
              <ChevronUp className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>

            <motion.button
              type="button"
              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isLast}
              aria-label={`Move ${day.day_name || `day ${index + 1}`} later`}
              onClick={() => reorderDays(day.id, 1)}
              whileTap={isLast ? undefined : { scale: 0.985 }}
            >
              <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>

            <motion.button
              type="button"
              className="studio-row-action p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
              aria-label={`Remove ${day.day_name || `day ${index + 1}`}`}
              onClick={handleRemoveDay}
              whileTap={{ scale: 0.985 }}
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>
          </div>
        </div>

        {/* ── Exercises section label ── */}
        <div className="flex items-baseline justify-between">
          <span className="t-label">Exercises</span>
          <span className="t-data-sm text-[var(--color-muted)]">
            {day.exercises.length} total
          </span>
        </div>

        {/* ── Exercise list ── */}
        <div>
          <AnimatePresence mode="popLayout">
            {day.exercises.length === 0 ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="t-caption py-3 border-t border-[var(--color-border)]"
              >
                No exercises yet. Tap below to add.
              </motion.p>
            ) : (
              day.exercises.map((exercise, exerciseIndex) => (
                <ExerciseRow
                  key={exercise.id}
                  dayId={day.id}
                  exercise={exercise}
                  index={exerciseIndex}
                  total={day.exercises.length}
                  onPickExercise={onPickExercise}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* ── Add exercise button ── */}
        <motion.button
          type="button"
          className="pressable studio-row-action w-full flex items-center justify-center gap-2 py-3 t-label hover:text-[var(--color-text)] transition-colors"
          onClick={() => onPickExercise(day.id, 'add')}
          whileTap={{ scale: 0.99 }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
          Add exercise
        </motion.button>
      </Card>
    </motion.div>
  );
});

// ═══════════════════════════════════
// SPLIT EDITOR
// ═══════════════════════════════════

export function SplitEditor({ onClose, onSaved, onPickExercise }: SplitEditorProps) {
  const draft = useSplitEditStore((s) => s.draft);
  const isDirty = useSplitEditStore((s) => s.isDirty);
  const saving = useSplitEditStore((s) => s.saving);
  const error = useSplitEditStore((s) => s.error);
  const renameSplit = useSplitEditStore((s) => s.renameSplit);
  const updateDescription = useSplitEditStore((s) => s.updateDescription);
  const addDay = useSplitEditStore((s) => s.addDay);
  const saveEdit = useSplitEditStore((s) => s.saveEdit);
  const cancelEdit = useSplitEditStore((s) => s.cancelEdit);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Discard them?'
      );
      if (!confirmed) return;
    }
    cancelEdit();
    onClose();
  }, [isDirty, cancelEdit, onClose]);

  const handleSave = useCallback(async () => {
    const success = await saveEdit();
    if (success) {
      onSaved();
      onClose();
    }
  }, [saveEdit, onSaved, onClose]);

  const handleAddDay = useCallback(() => {
    if (!draft) return;
    addDay(`Day ${draft.days.length + 1}`);
  }, [draft, addDay]);

  // Guard: draft must be loaded
  if (!draft) {
    return (
      <div className="pt-4 flex items-center justify-center py-20">
        <p className="t-label-sm">
          No program loaded
        </p>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-2 space-y-6">
      {/* ═══════════════════════════════════ */}
      {/* PROGRAM HEADER SECTION              */}
      {/* ═══════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.settle, delay: 0.05 }}
        className="space-y-4"
      >
        <p className="t-label pb-3 border-b border-[var(--color-border)]">
          Program details
        </p>
        <Input
          label="Program name"
          value={draft.name}
          onChange={(e) => renameSplit(e.target.value)}
          placeholder="e.g., Push Pull Legs"
        />
        <Input
          label="Description"
          value={draft.description ?? ''}
          onChange={(e) => updateDescription(e.target.value)}
          placeholder="Optional description…"
        />
      </motion.div>

      {/* ═══════════════════════════════════ */}
      {/* DAYS SECTION                        */}
      {/* ═══════════════════════════════════ */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <div className="flex items-baseline justify-between pb-3 border-b border-[var(--color-border)]">
          <p className="t-label">
            Training days
          </p>
          <span className="t-data-sm text-[var(--color-muted)]">
            {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'}
          </span>
        </div>

        {/* The group re-measures every layout node when any one updates, so
            memoized cards below a day that grew or shrank still glide. */}
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            {draft.days.map((day, index) => (
              <DayCard
                key={day.id}
                day={day}
                index={index}
                total={draft.days.length}
                onPickExercise={onPickExercise}
              />
            ))}
          </AnimatePresence>
        </LayoutGroup>
      </motion.div>

      {/* ── Add Day ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.button
          type="button"
          className="pressable studio-secondary-action w-full flex items-center justify-center gap-2 py-3 t-label hover:text-[var(--color-text)] transition-colors"
          onClick={handleAddDay}
          whileTap={{ scale: 0.99 }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
          Add day
        </motion.button>
      </motion.div>

      {/* ═══════════════════════════════════ */}
      {/* STICKY BOTTOM BAR                   */}
      {/* ═══════════════════════════════════ */}
      <div
        className="material-toolbar sticky z-20 -mx-6 rounded-t-[20px] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        style={{ bottom: 'calc(0px - max(1.25rem, env(safe-area-inset-bottom)))' }}
      >
        <div className="w-full max-w-lg mx-auto px-6 py-4 space-y-2">
          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="t-caption text-[var(--color-accent)] text-center"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              className="flex-1"
              onClick={handleSave}
              loading={saving}
              disabled={saving || !isDirty}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
