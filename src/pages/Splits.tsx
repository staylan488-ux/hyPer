import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, MoreVertical, Trash2, ChevronDown, ChevronRight, Pencil, Play, Edit3, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Input, Modal, Screen, SegmentedControl, TickStrip } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { SplitBuilder } from '@/components/split/SplitBuilder';
import { SplitEditor } from '@/components/split/SplitEditor';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { springs } from '@/lib/animations';
import { loadPlanSchedule } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import type { FlexDayTemplate, Split, MuscleGroup } from '@/types';

export function Splits() {
  const {
    splits,
    workoutMode,
    currentWorkout,
    flexTemplates,
    fetchSplits,
    fetchWorkoutMode,
    fetchCurrentWorkout,
    fetchFlexTemplates,
    setWorkoutMode,
    startFlexibleWorkoutFromTemplate,
    renameFlexTemplate,
    deleteFlexTemplate,
    setActiveSplit,
    deleteSplit,
  } = useAppStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [showBuilder, setShowBuilder] = useState(false);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [expandedSplit, setExpandedSplit] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [showPlanStartPrompt, setShowPlanStartPrompt] = useState(false);
  const [promptSplit, setPromptSplit] = useState<{ id: string; name: string } | null>(null);

  const [templateToDelete, setTemplateToDelete] = useState<FlexDayTemplate | null>(null);
  const [templateToRename, setTemplateToRename] = useState<FlexDayTemplate | null>(null);
  const [renamingTemplate, setRenamingTemplate] = useState(false);
  const [startingTemplateLabel, setStartingTemplateLabel] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // ── Edit state ──
  const [showEditor, setShowEditor] = useState(false);
  const [pickerState, setPickerState] = useState<{
    isOpen: boolean;
    dayId: string;
    mode: 'add' | 'swap' | 'superset';
    exerciseId?: string;
    initialMuscleGroup?: MuscleGroup;
    excludeExerciseIds?: string[];
  }>({ isOpen: false, dayId: '', mode: 'add' });

  const { startEdit, swapExercise, addExercise, addSupersetExercise } = useSplitEditStore();

  useEffect(() => {
    void Promise.all([
      fetchSplits(),
      fetchWorkoutMode(),
      fetchCurrentWorkout(),
      fetchFlexTemplates(),
    ]);
  }, [fetchCurrentWorkout, fetchFlexTemplates, fetchSplits, fetchWorkoutMode]);

  const handleEdit = useCallback((split: Split) => {
    startEdit(split);
    setShowMenu(null);
    setShowEditor(true);
  }, [startEdit]);

  const handlePickExercise = useCallback((dayId: string, mode: 'add' | 'swap' | 'superset', exerciseId?: string) => {
    const { draft } = useSplitEditStore.getState();
    let initialMuscleGroup: MuscleGroup | undefined;
    let excludeExerciseIds: string[] = [];

    if (draft) {
      const day = draft.days.find((entry) => entry.id === dayId);
      if (day) {
        excludeExerciseIds = day.exercises.map((entry) => entry.exercise_id);
      }
    }

    if ((mode === 'swap' || mode === 'superset') && exerciseId && draft) {
      for (const day of draft.days) {
        const ex = day.exercises.find((e) => e.id === exerciseId);
        if (ex) {
          initialMuscleGroup = ex.exercise.muscle_group;
          break;
        }
      }
    }

    setPickerState({
      isOpen: true,
      dayId,
      mode,
      exerciseId,
      initialMuscleGroup,
      excludeExerciseIds,
    });
  }, []);

  const handleExerciseSelected = useCallback((exercise: { id: string; name: string; muscle_group: MuscleGroup; muscle_group_secondary: MuscleGroup | null; equipment: string | null; is_compound: boolean }) => {
    const { dayId, mode, exerciseId } = pickerState;

    if (mode === 'swap' && exerciseId) {
      swapExercise(dayId, exerciseId, exercise);
    } else if (mode === 'superset' && exerciseId) {
      addSupersetExercise(dayId, exerciseId, exercise);
    } else {
      addExercise(dayId, exercise);
    }

    setPickerState((prev) => ({ ...prev, isOpen: false }));
  }, [pickerState, swapExercise, addExercise, addSupersetExercise]);

  const handleDelete = async (splitId: string) => {
    if (confirm('Delete this program?')) {
      await deleteSplit(splitId);
      setShowMenu(null);
    }
  };

  const canSwitchMode = !currentWorkout;

  const handleSetWorkoutMode = async (mode: 'split' | 'flexible') => {
    const result = await setWorkoutMode(mode);
    if (!result.ok && result.reason) {
      window.alert(result.reason);
      return;
    }

    if (mode === 'flexible') {
      setShowBuilder(false);
      setShowMenu(null);
      setExpandedSplit(null);
      setExpandedDay(null);
      await fetchFlexTemplates();
    }
  };

  const handleStartFromTemplate = async (templateLabel: string) => {
    try {
      setStartingTemplateLabel(templateLabel);
      const started = await startFlexibleWorkoutFromTemplate(templateLabel);

      if (!started) {
        window.alert('You already have an in-progress split workout today. Finish it before starting from a flexible template.');
        return;
      }

      navigate('/train');
    } finally {
      setStartingTemplateLabel(null);
    }
  };

  const handleOpenRenameTemplate = (template: FlexDayTemplate) => {
    setTemplateToRename(template);
    setRenameValue(template.label);
  };

  const handleConfirmRenameTemplate = async () => {
    if (!templateToRename) return;

    const trimmed = renameValue.trim();
    if (!trimmed) {
      window.alert('Template label is required.');
      return;
    }

    try {
      setRenamingTemplate(true);
      const result = await renameFlexTemplate(templateToRename.id, trimmed, false);

      if (!result.ok && result.conflictLabel) {
        const confirmed = window.confirm(`A template named "${result.conflictLabel}" already exists. Overwrite it?`);
        if (!confirmed) return;

        const overwriteResult = await renameFlexTemplate(templateToRename.id, trimmed, true);
        if (!overwriteResult.ok && overwriteResult.reason) {
          window.alert(overwriteResult.reason);
          return;
        }
      } else if (!result.ok && result.reason) {
        window.alert(result.reason);
        return;
      }

      setTemplateToRename(null);
      setRenameValue('');
    } finally {
      setRenamingTemplate(false);
    }
  };

  const handleConfirmDeleteTemplate = async () => {
    if (!templateToDelete) return;

    await deleteFlexTemplate(templateToDelete.id);
    setTemplateToDelete(null);

    if (expandedTemplateId === templateToDelete.id) {
      setExpandedTemplateId(null);
    }
  };

  const maybePromptPlanStart = (splitId: string, splitName: string) => {
    if (!user) return;

    const hasSchedule = Boolean(loadPlanSchedule(user.id, splitId));
    const dismissedKey = `plan-start-prompt:dismissed:${user.id}:${splitId}`;
    const dismissed = globalThis.localStorage?.getItem(dismissedKey) === '1';

    if (!hasSchedule && !dismissed) {
      setPromptSplit({ id: splitId, name: splitName });
      setShowPlanStartPrompt(true);
    }
  };

  const handleSelectSplit = async (splitId: string, splitName: string) => {
    await setActiveSplit(splitId);
    setShowMenu(null);
    maybePromptPlanStart(splitId, splitName);
  };

  return (
    <Screen>
      {/* Header */}
      <motion.header className="mb-5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="t-label-sm mb-1">
              {workoutMode === 'flexible'
                ? `${flexTemplates.length} ${flexTemplates.length === 1 ? 'template' : 'templates'}`
                : `${splits.length} ${splits.length === 1 ? 'program' : 'programs'}`}
            </p>
            <h1 className="t-title">Program</h1>
          </div>
          {workoutMode === 'split' && (
            <Button size="sm" onClick={() => setShowBuilder(true)}>
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              New
            </Button>
          )}
        </div>

        <SegmentedControl
          size="sm"
          value={workoutMode}
          onChange={(mode) => {
            if (!canSwitchMode) return;
            void handleSetWorkoutMode(mode);
          }}
          options={[
            { value: 'split', label: 'Split' },
            { value: 'flexible', label: 'Flexible' },
          ]}
          className={`max-w-[220px] ${!canSwitchMode ? 'opacity-60 pointer-events-none' : ''}`}
        />
        {!canSwitchMode && (
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">Finish the current workout to switch modes.</p>
        )}
      </motion.header>

      {workoutMode === 'flexible' ? (
        <div className="space-y-3">
          {flexTemplates.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No quick-start templates yet"
              body="Finish a flexible session and hyPer offers to save it — one tap to repeat it next time."
              action={<Button onClick={() => navigate('/train')}>Start a flexible session</Button>}
            />
          ) : (
            <>
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-label-sm">Quick-start templates</p>
                  <p className="text-xs text-[var(--color-text-dim)] mt-0.5">Saved from your flexible sessions</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => navigate('/train')}>
                  Start session
                </Button>
              </div>

              {flexTemplates.map((template, index) => {
                const isExpanded = expandedTemplateId === template.id;
                const visibleItems = template.items.filter((item) => !item.hidden);

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...springs.smooth, delay: Math.min(index * 0.05, 0.3) }}
                  >
                    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline p-4">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => setExpandedTemplateId(isExpanded ? null : template.id)}
                        >
                          <h3 className="t-heading text-[15px] truncate">{template.label}</h3>
                          <div className="flex items-center gap-2 mt-1.5">
                            <TickStrip total={Math.min(visibleItems.length, 12)} filled={0} tone="stone" size="sm" />
                            <span className="t-data-sm text-[10px] text-[var(--color-muted)]">{visibleItems.length} exercises</span>
                          </div>
                        </button>

                        <div className="flex items-center shrink-0">
                          <Button
                            size="sm"
                            onClick={() => { void handleStartFromTemplate(template.label); }}
                            disabled={Boolean(startingTemplateLabel)}
                          >
                            <Play className="w-3 h-3" strokeWidth={2.5} />
                            {startingTemplateLabel === template.label ? 'Starting…' : 'Start'}
                          </Button>
                          <button
                            type="button"
                            aria-label="Rename template"
                            className="pressable p-2 ml-1 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
                            onClick={() => handleOpenRenameTemplate(template)}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete template"
                            className="pressable p-2 rounded-[var(--radius-xs)] text-[color-mix(in_srgb,var(--color-danger)_70%,var(--color-muted))]"
                            onClick={() => setTemplateToDelete(template)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy} className="p-1">
                            <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" />
                          </motion.span>
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            className="mt-3.5 pt-3.5 border-t border-[var(--color-border)] space-y-1.5 overflow-hidden"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={springs.smooth}
                          >
                            {visibleItems.length > 0 ? (
                              visibleItems.map((item, itemIndex) => {
                                const repsLabel = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
                                  ? `${item.target_reps_min}–${item.target_reps_max}`
                                  : '—';
                                const setsLabel = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';

                                return (
                                  <div key={`${template.id}-${item.exercise_id}-${itemIndex}`} className="flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-1)]">
                                    <span className="t-data-sm text-[10px] text-[var(--color-muted)] w-5 shrink-0">
                                      {String(itemIndex + 1).padStart(2, '0')}
                                    </span>
                                    <p className="flex-1 min-w-0 text-[13px] font-medium text-[var(--color-text)] truncate">
                                      {item.exercise_name || 'Exercise'}
                                    </p>
                                    <span className="t-data-sm text-[10px] text-[var(--color-muted)] shrink-0">{setsLabel}×{repsLabel}</span>
                                  </div>
                                );
                              })
                            ) : (
                              <p className="text-[11px] text-[var(--color-muted)] py-2">No visible exercises.</p>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </>
          )}
        </div>
      ) : splits.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <EmptyState
            icon={LayoutGrid}
            title="Build your first program"
            body="Five questions and the guided builder assembles an evidence-based split around your week — editable down to every set."
            action={
              <Button size="lg" onClick={() => setShowBuilder(true)}>
                Create program
              </Button>
            }
          />
        </motion.div>
      ) : (
        <div className="space-y-3">
          {splits.map((split, index) => {
            const isExpanded = expandedSplit === split.id;

            return (
              <motion.div
                key={split.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.smooth, delay: Math.min(index * 0.05, 0.3) }}
              >
                <div
                  className={`relative rounded-[var(--radius-lg)] p-4 border ${
                    split.is_active
                      ? 'bg-[var(--color-surface-2)] border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]'
                      : 'bg-[var(--color-surface-1)] border-[var(--color-border)]'
                  }`}
                >
                  {split.is_active && (
                    <div
                      className="absolute inset-x-0 top-0 h-[2.5px] rounded-t-[var(--radius-lg)]"
                      style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
                    />
                  )}

                  {/* Program Header */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                    >
                      <div className="flex items-center gap-2.5 mb-1">
                        <h3 className="t-heading text-[15px] truncate">{split.name}</h3>
                        {split.is_active && (
                          <span className="shrink-0 px-2 py-0.5 bg-accent-tint-strong text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--color-accent)] rounded-full">
                            Active
                          </span>
                        )}
                      </div>

                      {split.description && (
                        <p className="text-[11px] text-[var(--color-muted)] mb-2.5 line-clamp-2">{split.description}</p>
                      )}

                      <div className="flex items-center gap-2.5">
                        <TickStrip total={split.days.length} filled={split.is_active ? split.days.length : 0} tone="amber" size="sm" />
                        <span className="t-data-sm text-[10px] text-[var(--color-muted)]">
                          {split.days.length} days · {split.days.reduce((sum, d) => sum + (d.exercises?.length || 0), 0)} exercises
                        </span>
                        <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                          <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                        </motion.span>
                      </div>
                    </button>

                    <div className="relative shrink-0">
                      <motion.button
                        className="p-2.5 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] rounded-[var(--radius-sm)] transition-colors"
                        onClick={() => setShowMenu(showMenu === split.id ? null : split.id)}
                        whileTap={{ scale: 0.9 }}
                        aria-label="Program options"
                      >
                        <MoreVertical className="w-4 h-4 text-[var(--color-muted)]" />
                      </motion.button>

                      <AnimatePresence>
                        {showMenu === split.id && (
                          <motion.div
                            className="absolute right-0 top-full mt-1 bg-[var(--color-surface-3)] hairline-strong rounded-[var(--radius-md)] raised z-10 py-1 min-w-[150px] overflow-hidden"
                            initial={{ opacity: 0, y: -4, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                          >
                            {!split.is_active && (
                              <button
                                className="w-full px-4 py-3 text-left text-[12px] font-semibold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] flex items-center gap-2.5"
                                onClick={() => {
                                  void handleSelectSplit(split.id, split.name);
                                }}
                              >
                                <Check className="w-3.5 h-3.5" />
                                Set active
                              </button>
                            )}
                            <button
                              className="w-full px-4 py-3 text-left text-[12px] font-semibold text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] flex items-center gap-2.5"
                              onClick={() => handleEdit(split)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              className="w-full px-4 py-3 text-left text-[12px] font-semibold text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] flex items-center gap-2.5"
                              onClick={() => handleDelete(split.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Expanded Program Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        className="mt-4 pt-4 border-t border-[var(--color-border)] space-y-2 overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={springs.smooth}
                      >
                        {split.days.map((day, dayIndex) => {
                          const isDayExpanded = expandedDay === day.id;
                          const exerciseCount = day.exercises?.length || 0;

                          return (
                            <motion.div
                              key={day.id}
                              className="bg-[var(--color-surface-1)] hairline rounded-[var(--radius-md)] overflow-hidden"
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: dayIndex * 0.04, ...springs.smooth }}
                            >
                              <button
                                type="button"
                                className="w-full flex items-center justify-between px-3.5 py-3 text-left"
                                onClick={() => setExpandedDay(isDayExpanded ? null : day.id)}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="well flex items-center justify-center w-8 h-8 shrink-0 t-data-sm text-[10px] text-[var(--color-muted)]">
                                    {String(dayIndex + 1).padStart(2, '0')}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-[var(--color-text)] truncate">{day.day_name}</p>
                                    <p className="text-[10px] text-[var(--color-muted)]">
                                      {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                                    </p>
                                  </div>
                                </div>
                                <motion.span animate={{ rotate: isDayExpanded ? 90 : 0 }} transition={springs.snappy}>
                                  <ChevronRight className="w-4 h-4 text-[var(--color-muted)]" />
                                </motion.span>
                              </button>

                              <AnimatePresence>
                                {isDayExpanded && (
                                  <motion.div
                                    className="px-3.5 pb-3.5 overflow-hidden"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={springs.smooth}
                                  >
                                    {exerciseCount > 0 ? (
                                      <div className="space-y-1.5">
                                        {day.exercises?.map((ex, exIndex) => (
                                          <motion.div
                                            key={ex.id}
                                            className="flex items-center gap-3 px-3 py-2 bg-[var(--color-surface-2)] rounded-[var(--radius-sm)]"
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: exIndex * 0.03, ...springs.smooth }}
                                          >
                                            <span className="t-data-sm text-[10px] text-[var(--color-muted)] w-5 shrink-0">{exIndex + 1}</span>
                                            <p className="flex-1 min-w-0 text-[12px] font-medium text-[var(--color-text)] truncate">
                                              {ex.exercise?.name || 'Unknown Exercise'}
                                            </p>
                                            <span className="t-data-sm text-[10px] text-[var(--color-muted)] shrink-0">
                                              {(() => {
                                                const setRange = parseSetRangeNotes(ex.notes, ex.target_sets);
                                                const setLabel = setRange.minSets === setRange.maxSets
                                                  ? `${setRange.targetSets}`
                                                  : `${setRange.minSets}–${setRange.maxSets}`;

                                                return `${setLabel}×${ex.target_reps_min}–${ex.target_reps_max}`;
                                              })()}
                                            </span>
                                          </motion.div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-[var(--color-muted)] text-center py-3">No exercises assigned</p>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={Boolean(templateToRename)}
        onClose={() => {
          if (renamingTemplate) return;
          setTemplateToRename(null);
          setRenameValue('');
        }}
        title="Rename template"
      >
        <div className="space-y-4 pt-1">
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={40}
            placeholder="Template label"
          />
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setTemplateToRename(null);
                setRenameValue('');
              }}
              disabled={renamingTemplate}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => { void handleConfirmRenameTemplate(); }}
              disabled={renamingTemplate}
              loading={renamingTemplate}
            >
              {renamingTemplate ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(templateToDelete)}
        onClose={() => setTemplateToDelete(null)}
        title="Delete template"
      >
        <div className="space-y-4 pt-1">
          <p className="t-body text-[var(--color-text)]">
            Delete <span className="font-semibold">{templateToDelete?.label}</span>?
          </p>
          <p className="t-caption">This removes the template from your flexible dashboard.</p>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setTemplateToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => { void handleConfirmDeleteTemplate(); }}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPlanStartPrompt}
        onClose={() => setShowPlanStartPrompt(false)}
        title="Set plan start"
      >
        <div className="space-y-4 pt-1">
          <p className="t-body text-[var(--color-text)]">
            <span className="font-semibold">{promptSplit?.name || 'This program'}</span> is now active.
          </p>
          <p className="t-caption">
            Set your Day 1 and weekly rhythm now — it takes about 15 seconds and lets hyPer call your next session.
          </p>
          <div className="flex gap-3 pt-1">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                if (user && promptSplit) {
                  const dismissedKey = `plan-start-prompt:dismissed:${user.id}:${promptSplit.id}`;
                  globalThis.localStorage?.setItem(dismissedKey, '1');
                }
                setShowPlanStartPrompt(false);
              }}
            >
              Later
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setShowPlanStartPrompt(false);
                navigate('/train');
              }}
            >
              Set now
            </Button>
          </div>
        </div>
      </Modal>

      {/* Split Builder Modal */}
      <Modal
        isOpen={showBuilder}
        onClose={() => {
          setShowBuilder(false);
        }}
        title="New program"
      >
        <SplitBuilder
          onComplete={(createdSplit) => {
            setShowBuilder(false);
            void fetchSplits();

            if (createdSplit) {
              maybePromptPlanStart(createdSplit.id, createdSplit.name);
            }
          }}
        />
      </Modal>

      {/* Split Editor Modal */}
      <Modal
        isOpen={showEditor}
        onClose={() => {
          const { isDirty, cancelEdit } = useSplitEditStore.getState();
          if (isDirty) {
            if (!window.confirm('You have unsaved changes. Discard them?')) return;
          }
          cancelEdit();
          setShowEditor(false);
        }}
        title="Edit program"
      >
        <SplitEditor
          onClose={() => setShowEditor(false)}
          onSaved={() => void fetchSplits()}
          onPickExercise={handlePickExercise}
        />
      </Modal>

      {/* Exercise Picker (for editor) */}
      <ExercisePicker
        isOpen={pickerState.isOpen}
        onClose={() => setPickerState((prev) => ({ ...prev, isOpen: false }))}
        onSelect={handleExerciseSelected}
        initialMuscleGroup={pickerState.initialMuscleGroup}
        excludeExerciseIds={pickerState.excludeExerciseIds}
        title={
          pickerState.mode === 'swap'
            ? 'Swap Exercise'
            : pickerState.mode === 'superset'
              ? 'Add Superset Exercise'
              : 'Add Exercise'
        }
      />
    </Screen>
  );
}
