import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Check, MoreVertical, Trash2, ChevronDown, ChevronRight, Pencil, Play, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Input, Modal, Screen, SegmentedControl, PageTitle } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { SplitBuilder } from '@/components/split/SplitBuilder';
import { SplitEditor } from '@/components/split/SplitEditor';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { springs } from '@/lib/animations';
import { useLitSurface } from '@/hooks/useLitSurface';
import { loadPlanScheduleAsync } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { discardSplitEdit } from '@/lib/discardSplitEdit';
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
  const litMenuRef = useLitSurface<HTMLDivElement>();
  const [expandedSplit, setExpandedSplit] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [showPlanStartPrompt, setShowPlanStartPrompt] = useState(false);
  const [promptSplit, setPromptSplit] = useState<{ id: string; name: string } | null>(null);
  // The split most recently activated here; a slower schedule check for an
  // earlier choice must not open its prompt.
  const promptRequestRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // Actions only: selecting them keeps draft edits from re-rendering this page.
  const startEdit = useSplitEditStore((s) => s.startEdit);
  const swapExercise = useSplitEditStore((s) => s.swapExercise);
  const addExercise = useSplitEditStore((s) => s.addExercise);
  const addSupersetExercise = useSplitEditStore((s) => s.addSupersetExercise);

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
      const result = await deleteSplit(splitId);
      if (!result.ok) {
        window.alert(result.reason ?? 'Could not delete the program.');
        return;
      }
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
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't start the workout. Try again.");
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

  const maybePromptPlanStart = async (splitId: string, splitName: string) => {
    if (!user) return;
    promptRequestRef.current = splitId;

    // Checks the cloud copy when this device has none (e.g. a fresh install).
    const hasSchedule = Boolean(await loadPlanScheduleAsync(user.id, splitId));
    if (!mountedRef.current || promptRequestRef.current !== splitId) return;
    const dismissedKey = `plan-start-prompt:dismissed:${user.id}:${splitId}`;
    const dismissed = globalThis.localStorage?.getItem(dismissedKey) === '1';

    if (!hasSchedule && !dismissed) {
      setPromptSplit({ id: splitId, name: splitName });
      setShowPlanStartPrompt(true);
    }
  };

  const handleSelectSplit = async (splitId: string, splitName: string) => {
    const result = await setActiveSplit(splitId);
    if (!result.ok) {
      window.alert(result.reason ?? 'Could not set the active program.');
      return;
    }
    setShowMenu(null);
    await maybePromptPlanStart(splitId, splitName);
  };

  return (
    <Screen>
      {/* Masthead */}
      <header className="mb-7">
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Training plan</span>
          <span className="t-label-sm">
            {workoutMode === 'flexible'
              ? `${flexTemplates.length} ${flexTemplates.length === 1 ? 'template' : 'templates'}`
              : `${splits.length} ${splits.length === 1 ? 'program' : 'programs'}`}
          </span>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <PageTitle>Program</PageTitle>
          {workoutMode === 'split' && (
            <Button size="sm" onClick={() => setShowBuilder(true)}>
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              New
            </Button>
          )}
        </div>

        <div className="mt-6">
          <SegmentedControl
            size="sm"
            distribution="equal"
            value={workoutMode}
            onChange={(mode) => {
              if (!canSwitchMode) return;
              void handleSetWorkoutMode(mode);
            }}
            options={[
              { value: 'split', label: 'Split' },
              { value: 'flexible', label: 'Flexible' },
            ]}
            className={`${!canSwitchMode ? 'opacity-60 pointer-events-none' : ''}`}
          />
          {!canSwitchMode && (
            <p className="mt-3 t-caption">Finish the current workout to switch modes.</p>
          )}
        </div>
      </header>

      {workoutMode === 'flexible' ? (
        <div>
          {flexTemplates.length === 0 ? (
            <EmptyState
              art="program"
              title="No quick-start templates yet"
              body="Finish a flexible session and hyPer offers to save it — one tap to repeat it next time."
              action={<Button onClick={() => navigate('/train')}>Start a flexible session</Button>}
            />
          ) : (
            <>
              <section className="platter">
                <p className="t-label">Flexible mode</p>
                <p className="t-title mt-3 mb-6">Build today as you go.</p>
                <Button size="lg" metal className="w-full" onClick={() => navigate('/train')}>
                  <Play className="w-3.5 h-3.5" strokeWidth={1.75} fill="currentColor" />
                  Start session
                </Button>
              </section>

              <div className="mt-7 mb-3 px-1">
                <span className="t-label">Quick-start templates</span>
                <p className="t-caption mt-1">Saved from your flexible sessions</p>
              </div>
              <ul className="platter platter-flush">
                {flexTemplates.map((template, index) => {
                  const isExpanded = expandedTemplateId === template.id;
                  const visibleItems = template.items.filter((item) => !item.hidden);

                  return (
                    <motion.li
                      key={template.id}
                      className="platter-row"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...springs.settle, delay: Math.min(index * 0.05, 0.3) }}
                    >
                      <div className="flex items-center gap-2 py-3 pl-5 pr-2">
                        <button
                          type="button"
                          className="pressable flex-1 min-w-0 min-h-11 text-left flex items-center gap-4"
                          onClick={() => setExpandedTemplateId(isExpanded ? null : template.id)}
                        >
                          <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="t-heading block break-words">{template.label}</span>
                            <span className="t-caption">{visibleItems.length} {visibleItems.length === 1 ? 'exercise' : 'exercises'}</span>
                          </span>
                          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile} className="self-center shrink-0">
                            <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                          </motion.span>
                        </button>

                        <div className="flex items-center shrink-0">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => { void handleStartFromTemplate(template.label); }}
                            disabled={Boolean(startingTemplateLabel)}
                          >
                            <Play className="w-3 h-3" strokeWidth={1.75} fill="currentColor" />
                            {startingTemplateLabel === template.label ? 'Starting…' : 'Start'}
                          </Button>
                          <button
                            type="button"
                            aria-label="Rename template"
                            className="pressable studio-row-action px-0! ml-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                            onClick={() => handleOpenRenameTemplate(template)}
                          >
                            <Edit3 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete template"
                            className="pressable studio-row-action px-0! text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
                            onClick={() => setTemplateToDelete(template)}
                          >
                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            className="overflow-hidden"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={springs.settle}
                          >
                            <div className="px-4 pb-4">
                              {visibleItems.length > 0 ? (
                                <ul className="material-inset px-4 py-1">
                                  {visibleItems.map((item, itemIndex) => {
                                    const repsLabel = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
                                      ? `${item.target_reps_min}–${item.target_reps_max}`
                                      : '—';
                                    const setsLabel = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';

                                    return (
                                      <li key={`${template.id}-${item.exercise_id}-${itemIndex}`} className="flex items-baseline gap-3 py-2.5 border-t border-[var(--color-border-soft)] first:border-t-0">
                                        <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
                                          {String(itemIndex + 1).padStart(2, '0')}
                                        </span>
                                        <p className="flex-1 min-w-0 t-body text-[var(--color-text)] break-words">
                                          {item.exercise_name || 'Exercise'}
                                        </p>
                                        <span className="t-data-sm text-[var(--color-muted)] shrink-0">{setsLabel}×{repsLabel}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <p className="t-caption py-2 px-1">No visible exercises.</p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : splits.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle}>
          <EmptyState
            art="program"
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
        <ul className="space-y-4">
          {splits.map((split, index) => {
            const isExpanded = expandedSplit === split.id;
            const totalExercises = split.days.reduce((sum, d) => sum + (d.exercises?.length || 0), 0);

            return (
              <motion.li
                key={split.id}
                className={`platter platter-flush overflow-visible! ${showMenu === split.id ? 'relative z-20' : ''}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.settle, delay: Math.min(index * 0.05, 0.3) }}
              >
                {/* Program Header */}
                <div className="flex items-start gap-1 pl-5 pr-2 pt-4 pb-4">
                  <button
                    type="button"
                    className="pressable flex-1 min-w-0 text-left flex items-start gap-4 pt-1"
                    onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 mb-2">
                        {split.is_active && <span className="w-[5px] h-[5px] bg-[var(--color-accent)]" aria-hidden />}
                        <span className={`t-label ${split.is_active ? 'text-[var(--color-accent)]' : ''}`}>
                          {split.is_active ? 'Active' : `Program ${String(index + 1).padStart(2, '0')}`}
                        </span>
                      </span>
                      <span className={`block break-words ${split.is_active ? 't-title text-[30px]!' : 't-heading text-[17px]!'}`}>{split.name}</span>
                      {split.description && (
                        <span className="t-caption block mt-2 line-clamp-2">{split.description}</span>
                      )}
                      <span className="t-data-sm text-[var(--color-muted)] flex items-center gap-2 mt-2">
                        {split.days.length} {split.days.length === 1 ? 'day' : 'days'} · {totalExercises} {totalExercises === 1 ? 'exercise' : 'exercises'}
                        <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile} className="inline-flex shrink-0">
                          <ChevronDown className="w-3.5 h-3.5 text-[var(--color-muted)]" strokeWidth={1.75} />
                        </motion.span>
                      </span>
                    </span>
                  </button>

                  <div className="relative shrink-0">
                    <motion.button
                      className="pressable studio-row-action px-0! rounded-full! text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                      onClick={() => setShowMenu(showMenu === split.id ? null : split.id)}
                      whileTap={{ scale: 0.985 }}
                      aria-label="Program options"
                    >
                      <MoreVertical className="w-4 h-4" strokeWidth={1.5} />
                    </motion.button>

                    <AnimatePresence>
                      {showMenu === split.id && (
                        <motion.div
                          ref={litMenuRef}
                          className="absolute right-0 top-full mt-1 material-glass glass-edge rounded-[var(--radius-control)] z-10 min-w-[184px] overflow-hidden py-1"
                          initial={{ opacity: 0, y: -4, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.15 }}
                        >
                          {!split.is_active && (
                            <button
                              className="relative z-[1] w-full min-h-11 px-4 py-3 text-left t-body text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] flex items-center gap-3 transition-colors"
                              onClick={() => {
                                void handleSelectSplit(split.id, split.name);
                              }}
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Set active
                            </button>
                          )}
                          <button
                            className="relative z-[1] w-full min-h-11 px-4 py-3 text-left t-body text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] flex items-center gap-3 border-t border-[var(--color-border-soft)] first:border-t-0 transition-colors"
                            onClick={() => handleEdit(split)}
                          >
                            <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Edit
                          </button>
                          <button
                            className="relative z-[1] w-full min-h-11 px-4 py-3 text-left t-body text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] flex items-center gap-3 border-t border-[var(--color-border-soft)] transition-colors"
                            onClick={() => handleDelete(split.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
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
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springs.settle}
                    >
                      <ul className="shadow-[inset_0_1px_0_var(--platter-divider)]">
                        {split.days.map((day, dayIndex) => {
                          const isDayExpanded = expandedDay === day.id;
                          const exerciseCount = day.exercises?.length || 0;

                          return (
                            <motion.li
                              key={day.id}
                              className="platter-row"
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: dayIndex * 0.04, ...springs.settle }}
                            >
                              <button
                                type="button"
                                className="pressable w-full min-h-[60px] flex items-center gap-4 px-5 py-3 text-left"
                                onClick={() => setExpandedDay(isDayExpanded ? null : day.id)}
                              >
                                <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">
                                  {String(dayIndex + 1).padStart(2, '0')}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="t-heading block break-words">{day.day_name}</span>
                                  <span className="t-caption">
                                    {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                                  </span>
                                </span>
                                <motion.span animate={{ rotate: isDayExpanded ? 90 : 0 }} transition={springs.tactile} className="shrink-0">
                                  <ChevronRight className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                                </motion.span>
                              </button>

                              <AnimatePresence>
                                {isDayExpanded && (
                                  <motion.div
                                    className="overflow-hidden"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={springs.settle}
                                  >
                                    {exerciseCount > 0 ? (
                                      <ul className="material-inset mx-4 mb-4 px-4 py-1">
                                        {day.exercises?.map((ex, exIndex) => (
                                          <motion.li
                                            key={ex.id}
                                            className="flex items-baseline gap-3 py-2.5 border-t border-[var(--color-border-soft)] first:border-t-0"
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: exIndex * 0.03, ...springs.settle }}
                                          >
                                            <span className="t-data-sm text-[var(--color-muted)] w-5 shrink-0">{exIndex + 1}</span>
                                            <p className="flex-1 min-w-0 t-body text-[var(--color-text)] break-words">
                                              {ex.exercise?.name || 'Unknown Exercise'}
                                            </p>
                                            <span className="t-data-sm text-[var(--color-muted)] shrink-0">
                                              {(() => {
                                                const setRange = parseSetRangeNotes(ex.notes, ex.target_sets);
                                                const setLabel = setRange.minSets === setRange.maxSets
                                                  ? `${setRange.targetSets}`
                                                  : `${setRange.minSets}–${setRange.maxSets}`;

                                                return `${setLabel}×${ex.target_reps_min}–${ex.target_reps_max}`;
                                              })()}
                                            </span>
                                          </motion.li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="t-caption px-5 pb-4">No exercises assigned</p>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.li>
                          );
                        })}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ul>
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
            Delete <span className="font-medium">{templateToDelete?.label}</span>?
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
            <span className="font-medium">{promptSplit?.name || 'This program'}</span> is now active.
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

            if (createdSplit) {
              void maybePromptPlanStart(createdSplit.id, createdSplit.name);
            }
          }}
        />
      </Modal>

      {/* Split Editor Modal */}
      <Modal
        isOpen={showEditor}
        onClose={() => {
          if (discardSplitEdit()) setShowEditor(false);
        }}
        title="Edit program"
      >
        <SplitEditor
          onClose={() => setShowEditor(false)}
          onSaved={() => void fetchSplits({ force: true })}
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
