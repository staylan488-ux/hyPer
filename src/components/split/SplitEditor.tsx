import { useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  X,
  Plus,
  ArrowRightLeft,
} from 'lucide-react';
import { Button, Input, Card } from '@/components/shared';
import { useSplitEditStore } from '@/stores/splitEditStore';
import {
  springs,
  fadeUp,
  staggerContainer,
} from '@/lib/animations';
import { normalizeSetRange } from '@/lib/setRangeNotes';
import type { DraftDay, DraftExercise } from '@/stores/splitEditStore';

// ═══════════════════════════════════
// PROPS
// ═══════════════════════════════════

interface SplitEditorProps {
  onClose: () => void;
  onSaved: () => void;
  onPickExercise: (dayId: string, mode: 'add' | 'swap', exerciseId?: string) => void;
}

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (value === '' || Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

// ═══════════════════════════════════
// EXERCISE ROW
// ═══════════════════════════════════

function ExerciseRow({
  day,
  exercise,
  index,
  total,
  onPickExercise,
}: {
  day: DraftDay;
  exercise: DraftExercise;
  index: number;
  total: number;
  onPickExercise: SplitEditorProps['onPickExercise'];
}) {
  const { reorderExercise, updateExerciseTargets, removeExercise } =
    useSplitEditStore();

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      transition={springs.smooth}
      className="relative rounded-[16px] bg-[var(--color-base)] border border-[var(--color-border)] p-3 space-y-2.5"
    >
      {/* ── Top row: badge + name + actions ── */}
      <div className="flex items-center gap-2">
        {/* Number badge */}
        <div className="w-6 h-6 rounded-[10px] bg-[var(--color-surface)] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-[#6B6B6B] tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        {/* Exercise name — tappable to swap */}
        <button
          type="button"
          className="flex-1 text-left group flex items-center gap-1.5 min-w-0"
          onClick={() => onPickExercise(day.id, 'swap', exercise.id)}
        >
          <span className="text-[11px] text-[#E8E4DE] truncate">
            {exercise.exercise.name}
          </span>
          <ArrowRightLeft className="w-3 h-3 text-[#6B6B6B] opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex-shrink-0" />
        </button>

        {/* Reorder + remove */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <motion.button
            type="button"
            className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isFirst}
            onClick={() => reorderExercise(day.id, exercise.id, -1)}
            whileTap={isFirst ? undefined : { scale: 0.85 }}
          >
            <ChevronUp className="w-3 h-3" />
          </motion.button>

          <motion.button
            type="button"
            className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isLast}
            onClick={() => reorderExercise(day.id, exercise.id, 1)}
            whileTap={isLast ? undefined : { scale: 0.85 }}
          >
            <ChevronDown className="w-3 h-3" />
          </motion.button>

          <motion.button
            type="button"
            className="p-1.5 rounded-[8px] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] transition-colors"
            onClick={() => removeExercise(day.id, exercise.id)}
            whileTap={{ scale: 0.85 }}
          >
            <X className="w-3 h-3" />
          </motion.button>
        </div>
      </div>

      {/* ── Target inputs: Set Min/Target/Max + Rep Min/Max ── */}
      <div className="grid grid-cols-5 gap-2">
        <div>
          <label className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1">
            Min Sets
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={exercise.target_sets_min}
            onChange={(e) => {
              const nextMin = clampInt(e.target.value, 1, 10, exercise.target_sets_min);
              const normalized = normalizeSetRange(nextMin, exercise.target_sets, exercise.target_sets_max);
              updateExerciseTargets(day.id, exercise.id, {
                target_sets_min: normalized.minSets,
                target_sets: normalized.targetSets,
                target_sets_max: normalized.maxSets,
              });
            }}
            className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-xs text-[#E8E4DE] text-center tabular-nums focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1">
            Target Sets
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={exercise.target_sets}
            onChange={(e) => {
              const nextTarget = clampInt(e.target.value, 1, 10, exercise.target_sets);
              const normalized = normalizeSetRange(exercise.target_sets_min, nextTarget, exercise.target_sets_max);
              updateExerciseTargets(day.id, exercise.id, {
                target_sets_min: normalized.minSets,
                target_sets: normalized.targetSets,
                target_sets_max: normalized.maxSets,
              });
            }}
            className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-xs text-[#E8E4DE] text-center tabular-nums focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1">
            Max Sets
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={exercise.target_sets_max}
            onChange={(e) => {
              const nextMax = clampInt(e.target.value, 1, 10, exercise.target_sets_max);
              const normalized = normalizeSetRange(exercise.target_sets_min, exercise.target_sets, nextMax);
              updateExerciseTargets(day.id, exercise.id, {
                target_sets_min: normalized.minSets,
                target_sets: normalized.targetSets,
                target_sets_max: normalized.maxSets,
              });
            }}
            className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-xs text-[#E8E4DE] text-center tabular-nums focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1">
            Min Reps
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={exercise.target_reps_min}
            onChange={(e) =>
              updateExerciseTargets(day.id, exercise.id, {
                target_reps_min: clampInt(e.target.value, 1, 100, exercise.target_reps_min),
              })
            }
            className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-xs text-[#E8E4DE] text-center tabular-nums focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
        <div>
          <label className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1">
            Max Reps
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={exercise.target_reps_max}
            onChange={(e) =>
              updateExerciseTargets(day.id, exercise.id, {
                target_reps_max: clampInt(e.target.value, 1, 100, exercise.target_reps_max),
              })
            }
            className="w-full px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[10px] text-xs text-[#E8E4DE] text-center tabular-nums focus:outline-none focus:border-[var(--color-border-strong)]"
          />
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════
// DAY CARD
// ═══════════════════════════════════

function DayCard({
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
  const { renameDay, reorderDays, removeDay } = useSplitEditStore();

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
      transition={springs.smooth}
    >
      <Card variant="slab" animated={false} className="space-y-4">
        {/* ── Day header ── */}
        <div className="flex items-start gap-3">
          {/* Day number badge */}
          <div className="w-8 h-8 rounded-[10px] bg-[var(--color-base)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0 mt-1">
            <span className="text-[10px] text-[#6B6B6B] tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>

          {/* Day name input */}
          <div className="flex-1 min-w-0">
            <Input
              value={day.day_name}
              onChange={(e) => renameDay(day.id, e.target.value)}
              placeholder="Day name"
              className="!rounded-[12px] !py-1.5 !px-2.5 !text-xs"
            />
          </div>

          {/* Day actions: reorder + delete */}
          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            <motion.button
              type="button"
              className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-[var(--color-surface-high)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isFirst}
              onClick={() => reorderDays(day.id, -1)}
              whileTap={isFirst ? undefined : { scale: 0.85 }}
            >
              <ChevronUp className="w-4 h-4" />
            </motion.button>

            <motion.button
              type="button"
              className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-[var(--color-surface-high)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isLast}
              onClick={() => reorderDays(day.id, 1)}
              whileTap={isLast ? undefined : { scale: 0.85 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.button>

            <motion.button
              type="button"
              className="p-1.5 rounded-[8px] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] transition-colors"
              onClick={handleRemoveDay}
              whileTap={{ scale: 0.85 }}
            >
              <Trash2 className="w-4 h-4" />
            </motion.button>
          </div>
        </div>

        {/* ── Exercises section label ── */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">
            Exercises
          </p>
          <span className="text-[10px] text-[#6B6B6B] tabular-nums">
            {day.exercises.length} total
          </span>
        </div>

        {/* ── Exercise list ── */}
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {day.exercises.length === 0 ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[10px] text-[#6B6B6B] py-3 text-center"
              >
                No exercises yet. Tap below to add.
              </motion.p>
            ) : (
              day.exercises.map((exercise, exerciseIndex) => (
                <ExerciseRow
                  key={exercise.id}
                  day={day}
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
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[12px] border border-dashed border-[var(--color-border)] text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-[var(--color-border-strong)] transition-colors"
          onClick={() => onPickExercise(day.id, 'add')}
          whileTap={{ scale: 0.97 }}
        >
          <Plus className="w-3 h-3" />
          Add Exercise
        </motion.button>
      </Card>
    </motion.div>
  );
}

// ═══════════════════════════════════
// SPLIT EDITOR
// ═══════════════════════════════════

export function SplitEditor({ onClose, onSaved, onPickExercise }: SplitEditorProps) {
  const {
    draft,
    isDirty,
    saving,
    error,
    renameSplit,
    updateDescription,
    addDay,
    saveEdit,
    cancelEdit,
  } = useSplitEditStore();

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
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">
          No program loaded
        </p>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-24 space-y-4">
      {/* ═══════════════════════════════════ */}
      {/* PROGRAM HEADER SECTION              */}
      {/* ═══════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.05 }}
        className="space-y-3"
      >
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">
          Program Details
        </p>
        <Input
          label="Program Name"
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
        className="space-y-3"
      >
        <div className="flex items-center justify-between">
          <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">
            Training Days
          </p>
          <span className="text-[10px] text-[#6B6B6B] tabular-nums">
            {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'}
          </span>
        </div>

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
      </motion.div>

      {/* ── Add Day ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <motion.button
          type="button"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-[28px] border border-dashed border-[var(--color-border)] text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-[var(--color-border-strong)] transition-colors"
          onClick={handleAddDay}
          whileTap={{ scale: 0.97 }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Day
        </motion.button>
      </motion.div>

      {/* ═══════════════════════════════════ */}
      {/* STICKY BOTTOM BAR                   */}
      {/* ═══════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-base)] border-t border-[var(--color-border)]">
        <div className="w-full max-w-lg mx-auto px-4 py-3 space-y-2">
          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-[11px] text-[var(--color-danger)] text-center"
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
