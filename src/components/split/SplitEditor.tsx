import { useCallback, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
import { normalizeSetRange } from '@/lib/setRangeNotes';
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
// HELPERS
// ═══════════════════════════════════

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (value === '' || Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

interface ExerciseInputDraft {
  minSets: string;
  targetSets: string;
  maxSets: string;
  minReps: string;
  maxReps: string;
}

function buildExerciseInputDraft(exercise: DraftExercise): ExerciseInputDraft {
  return {
    minSets: String(exercise.target_sets_min),
    targetSets: String(exercise.target_sets),
    maxSets: String(exercise.target_sets_max),
    minReps: String(exercise.target_reps_min),
    maxReps: String(exercise.target_reps_max),
  };
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
  const { reorderExercise, updateExerciseTargets, removeExercise, clearExerciseSuperset } =
    useSplitEditStore();
  const [inputDraft, setInputDraft] = useState<ExerciseInputDraft>(() => buildExerciseInputDraft(exercise));

  const commitSetRangeDraft = (patch: Partial<ExerciseInputDraft> = {}) => {
    const merged = { ...inputDraft, ...patch };

    const nextMin = clampInt(merged.minSets, 1, 10, exercise.target_sets_min);
    const nextTarget = clampInt(merged.targetSets, 1, 10, exercise.target_sets);
    const nextMax = clampInt(merged.maxSets, 1, 10, exercise.target_sets_max);

    const normalized = normalizeSetRange(nextMin, nextTarget, nextMax);

    setInputDraft((prev) => ({
      ...prev,
      minSets: String(normalized.minSets),
      targetSets: String(normalized.targetSets),
      maxSets: String(normalized.maxSets),
    }));

    updateExerciseTargets(day.id, exercise.id, {
      target_sets_min: normalized.minSets,
      target_sets: normalized.targetSets,
      target_sets_max: normalized.maxSets,
    });
  };

  const commitRepDraft = (field: 'minReps' | 'maxReps', fallback: number) => {
    const value = inputDraft[field];
    const clamped = field === 'minReps'
      ? clampInt(value, 1, 100, fallback)
      : clampInt(value, 1, 100, fallback);

    const patch = { [field]: String(clamped) } as Partial<ExerciseInputDraft>;
    setInputDraft((prev) => ({ ...prev, ...patch }));

    if (field === 'minReps') {
      updateExerciseTargets(day.id, exercise.id, { target_reps_min: clamped });
    } else {
      updateExerciseTargets(day.id, exercise.id, { target_reps_max: clamped });
    }
  };

  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
      transition={springs.smooth}
      className={`relative border-t border-[var(--color-border)] py-3 space-y-3 ${
        exercise.superset_group_id ? 'border-l-2 border-l-[var(--color-text)] pl-3' : ''
      }`}
    >
      {/* ── Top row: index + name + actions ── */}
      <div className="flex items-center gap-3">
        {/* Mono index */}
        <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>

        {/* Exercise name — tappable to swap */}
        <button
          type="button"
          className="pressable flex-1 text-left group flex items-center gap-1.5 min-w-0"
          onClick={() => onPickExercise(day.id, 'swap', exercise.id)}
        >
          <span className="flex flex-col min-w-0">
            <span className="t-body text-[var(--color-text)] truncate">
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
        <div className="flex items-center shrink-0">
          {exercise.superset_group_id ? (
            <motion.button
              type="button"
              className="p-1.5 text-[var(--color-text)] hover:text-[var(--color-text-dim)] transition-colors"
              onClick={() => clearExerciseSuperset(day.id, exercise.id)}
              whileTap={{ scale: 0.85 }}
              title="Remove Superset"
            >
              <Unlink2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => onPickExercise(day.id, 'superset', exercise.id)}
              whileTap={{ scale: 0.85 }}
              title="Add Superset"
            >
              <Link2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </motion.button>
          )}
          <motion.button
            type="button"
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isFirst}
            onClick={() => reorderExercise(day.id, exercise.id, -1)}
            whileTap={isFirst ? undefined : { scale: 0.85 }}
          >
            <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>

          <motion.button
            type="button"
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            disabled={isLast}
            onClick={() => reorderExercise(day.id, exercise.id, 1)}
            whileTap={isLast ? undefined : { scale: 0.85 }}
          >
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>

          <motion.button
            type="button"
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
            onClick={() => removeExercise(day.id, exercise.id)}
            whileTap={{ scale: 0.85 }}
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </motion.button>
        </div>
      </div>

      {/* ── Target inputs: Set Min/Target/Max + Rep Min/Max ── */}
      <div className="grid grid-cols-5 gap-2 pl-8">
        <SetRepCell label="Min sets">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={inputDraft.minSets}
            onChange={(e) => setInputDraft((prev) => ({ ...prev, minSets: e.target.value }))}
            onBlur={() => commitSetRangeDraft()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitSetRangeDraft();
              }
            }}
            className="well w-full min-h-10 text-center t-data-sm text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[var(--color-border-strong)]"
          />
        </SetRepCell>
        <SetRepCell label="Sets">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={inputDraft.targetSets}
            onChange={(e) => setInputDraft((prev) => ({ ...prev, targetSets: e.target.value }))}
            onBlur={() => commitSetRangeDraft()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitSetRangeDraft();
              }
            }}
            className="well w-full min-h-10 text-center t-data-sm text-[var(--color-accent)] outline-none focus:ring-[1.5px] focus:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
          />
        </SetRepCell>
        <SetRepCell label="Max sets">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            value={inputDraft.maxSets}
            onChange={(e) => setInputDraft((prev) => ({ ...prev, maxSets: e.target.value }))}
            onBlur={() => commitSetRangeDraft()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitSetRangeDraft();
              }
            }}
            className="well w-full min-h-10 text-center t-data-sm text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[var(--color-border-strong)]"
          />
        </SetRepCell>
        <SetRepCell label="Reps↓">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={inputDraft.minReps}
            onChange={(e) => setInputDraft((prev) => ({ ...prev, minReps: e.target.value }))}
            onBlur={() => commitRepDraft('minReps', exercise.target_reps_min)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRepDraft('minReps', exercise.target_reps_min);
              }
            }}
            className="well w-full min-h-10 text-center t-data-sm text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[var(--color-border-strong)]"
          />
        </SetRepCell>
        <SetRepCell label="Reps↑">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={inputDraft.maxReps}
            onChange={(e) => setInputDraft((prev) => ({ ...prev, maxReps: e.target.value }))}
            onBlur={() => commitRepDraft('maxReps', exercise.target_reps_max)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRepDraft('maxReps', exercise.target_reps_max);
              }
            }}
            className="well w-full min-h-10 text-center t-data-sm text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[var(--color-border-strong)]"
          />
        </SetRepCell>
      </div>
    </motion.div>
  );
}

/** Labelled numeric cell — tracked-caps label over a recessed well input */
function SetRepCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col items-center gap-1">
      <span className="t-label-sm text-[9px]">{label}</span>
      {children}
    </label>
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
      <Card variant="slab" animated={false} className="space-y-5">
        {/* ── Day header ── */}
        <div className="flex items-start gap-3 pb-4 border-b border-[var(--color-border)]">
          {/* Serif day number */}
          <span className="number-medium text-[var(--color-text-dim)] shrink-0 leading-none mt-0.5 w-9">
            {String(index + 1).padStart(2, '0')}
          </span>

          {/* Day name input */}
          <div className="flex-1 min-w-0">
            <Input
              value={day.day_name}
              onChange={(e) => renameDay(day.id, e.target.value)}
              placeholder="Day name"
            />
          </div>

          {/* Day actions: reorder + delete */}
          <div className="flex items-center shrink-0 mt-1">
            <motion.button
              type="button"
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isFirst}
              onClick={() => reorderDays(day.id, -1)}
              whileTap={isFirst ? undefined : { scale: 0.85 }}
            >
              <ChevronUp className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>

            <motion.button
              type="button"
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
              disabled={isLast}
              onClick={() => reorderDays(day.id, 1)}
              whileTap={isLast ? undefined : { scale: 0.85 }}
            >
              <ChevronDown className="w-4 h-4" strokeWidth={1.5} />
            </motion.button>

            <motion.button
              type="button"
              className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
              onClick={handleRemoveDay}
              whileTap={{ scale: 0.85 }}
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
                  key={`${exercise.id}:${exercise.target_sets_min}:${exercise.target_sets}:${exercise.target_sets_max}:${exercise.target_reps_min}:${exercise.target_reps_max}:${exercise.superset_group_id || 'none'}`}
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
          className="pressable w-full flex items-center justify-center gap-2 py-3 border-t border-[var(--color-text)] t-label hover:text-[var(--color-text)] transition-colors"
          onClick={() => onPickExercise(day.id, 'add')}
          whileTap={{ scale: 0.99 }}
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
          Add exercise
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
        <p className="t-label-sm">
          No program loaded
        </p>
      </div>
    );
  }

  return (
    <div className="pt-4 pb-24 space-y-8">
      {/* ═══════════════════════════════════ */}
      {/* PROGRAM HEADER SECTION              */}
      {/* ═══════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.05 }}
        className="space-y-4"
      >
        <p className="t-label pb-3 border-b border-[var(--color-text)]">
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
        <div className="flex items-baseline justify-between pb-3 border-b border-[var(--color-text)]">
          <p className="t-label">
            Training days
          </p>
          <span className="t-data-sm text-[var(--color-muted)]">
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
          className="pressable w-full flex items-center justify-center gap-2 py-3 border-t border-b border-[var(--color-text)] t-label hover:text-[var(--color-text)] transition-colors"
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
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-base)] border-t border-[var(--color-text)]">
        <div className="w-full max-w-lg mx-auto px-4 py-3 space-y-2">
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
