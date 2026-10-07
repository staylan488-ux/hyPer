import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import { Plus, Check, MoreHorizontal, Trash2, ChevronDown, ChevronRight, Pencil, Play, Edit3, type LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Input, Modal, Screen, SegmentedControl, PageHeader } from '@/components/shared';
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

interface MenuItem {
  label: string;
  icon: LucideIcon;
  tone?: 'danger';
  onSelect: () => void;
}

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

  const activeProgram = splits.find((split) => split.is_active) ?? null;
  const otherPrograms = splits.filter((split) => split !== activeProgram);

  const programCounts = (split: Split) => {
    const exercises = split.days.reduce((sum, day) => sum + (day.exercises?.length || 0), 0);
    return `${split.days.length} ${split.days.length === 1 ? 'day' : 'days'} · ${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}`;
  };

  const programMenuItems = (split: Split): MenuItem[] => [
    ...(!split.is_active
      ? [{ label: 'Set active', icon: Check, onSelect: () => { void handleSelectSplit(split.id, split.name); } }]
      : []),
    { label: 'Edit', icon: Pencil, onSelect: () => handleEdit(split) },
    { label: 'Delete', icon: Trash2, tone: 'danger' as const, onSelect: () => { void handleDelete(split.id); } },
  ];

  /** A row's options: a horizontal ••• that opens a small glass menu. */
  const renderMenu = (id: string, label: string, items: MenuItem[]) => {
    const open = showMenu === id;
    return (
      <div className={`relative shrink-0 ${open ? 'z-20' : ''}`}>
        <button
          type="button"
          className="pressable w-11 h-11 inline-flex items-center justify-center rounded-full text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
          onClick={() => setShowMenu(open ? null : id)}
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <MoreHorizontal className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              ref={litMenuRef}
              role="menu"
              className="absolute right-0 top-full mt-1 material-glass glass-edge rounded-[var(--radius-control)] z-10 min-w-[184px] overflow-hidden py-1"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`relative z-[1] w-full min-h-11 px-4 py-3 text-left t-body flex items-center gap-3 transition-colors ${
                    index > 0 ? 'border-t border-[var(--color-border-soft)]' : ''
                  } ${item.tone === 'danger'
                    ? 'text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]'
                    : 'text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)]'}`}
                  onClick={item.onSelect}
                >
                  <item.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  /** A program's days, each opening its exercises in place. */
  const renderDays = (split: Split) => (
    <ul className="platter platter-flush">
      {split.days.map((day, dayIndex) => {
        const isDayExpanded = expandedDay === day.id;
        const exerciseCount = day.exercises?.length || 0;

        return (
          <li key={day.id} className="platter-row" style={{ '--row-inset': '56px' } as CSSProperties}>
            <button
              type="button"
              className="pressable w-full min-h-[60px] flex items-center gap-4 px-5 py-3 text-left"
              aria-expanded={isDayExpanded}
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

            <AnimatePresence initial={false}>
              {isDayExpanded && (
                <motion.div
                  className="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={springs.settle}
                >
                  {exerciseCount > 0 ? (
                    <ul className="pl-[56px] pr-5 pb-3">
                      {day.exercises?.map((ex) => (
                        <li
                          key={ex.id}
                          className="flex items-baseline gap-3 py-2.5 shadow-[inset_0_1px_0_var(--platter-divider)]"
                        >
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
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="t-caption pl-[56px] pr-5 pb-4">No exercises assigned</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Screen>
      <PageHeader
        back={{ label: 'Today', to: '/' }}
        eyebrow="Training plan"
        title="Program"
        actions={workoutMode === 'split' ? (
          <button type="button" className="text-action" onClick={() => setShowBuilder(true)}>
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            New program
          </button>
        ) : undefined}
      />

      <div className="mt-5 mb-8">
        <SegmentedControl
          size="sm"
          value={workoutMode}
          disabled={!canSwitchMode}
          onChange={(mode) => {
            if (!canSwitchMode) return;
            void handleSetWorkoutMode(mode);
          }}
          options={[
            { value: 'split', label: 'Split' },
            { value: 'flexible', label: 'Flexible' },
          ]}
        />
        {!canSwitchMode && (
          <p className="mt-3 t-caption">Finish the current workout to switch modes.</p>
        )}
      </div>

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

              <div className="mt-7 mb-3">
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
                      <div className="flex items-center gap-1 py-2 pl-5 pr-2">
                        <button
                          type="button"
                          className="pressable flex-1 min-w-0 min-h-11 text-left flex items-center gap-4"
                          aria-expanded={isExpanded}
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
                          <button
                            type="button"
                            className="text-action"
                            onClick={() => { void handleStartFromTemplate(template.label); }}
                            disabled={Boolean(startingTemplateLabel)}
                          >
                            {startingTemplateLabel === template.label ? 'Starting…' : 'Start'}
                          </button>
                          {renderMenu(`template:${template.id}`, `Options for ${template.label}`, [
                            { label: 'Rename', icon: Edit3, onSelect: () => { setShowMenu(null); handleOpenRenameTemplate(template); } },
                            { label: 'Delete', icon: Trash2, tone: 'danger', onSelect: () => { setShowMenu(null); setTemplateToDelete(template); } },
                          ])}
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
                            <div className="pl-[56px] pr-5 pb-3">
                              {visibleItems.length > 0 ? (
                                <ul>
                                  {visibleItems.map((item, itemIndex) => {
                                    const repsLabel = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
                                      ? `${item.target_reps_min}–${item.target_reps_max}`
                                      : '—';
                                    const setsLabel = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';

                                    return (
                                      <li key={`${template.id}-${item.exercise_id}-${itemIndex}`} className="flex items-baseline gap-3 py-2.5 shadow-[inset_0_1px_0_var(--platter-divider)]">
                                        <p className="flex-1 min-w-0 t-body text-[var(--color-text)] break-words">
                                          {item.exercise_name || 'Exercise'}
                                        </p>
                                        <span className="t-data-sm text-[var(--color-muted)] shrink-0">{setsLabel}×{repsLabel}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <p className="t-caption py-2">No visible exercises.</p>
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
        <>
          {activeProgram && (
            <motion.section
              aria-label="Active program"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={springs.settle}
            >
              <span className="flex items-center gap-2 mb-2">
                <span className="w-[5px] h-[5px] bg-[var(--color-accent)]" aria-hidden />
                <span className="t-label text-[var(--color-accent)]">Active</span>
              </span>
              {/* The ••• centres on the title's first line (44px target, 32px line). */}
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="t-title text-[30px]! break-words">{activeProgram.name}</h2>
                  {activeProgram.description && (
                    <p className="t-caption mt-2">{activeProgram.description}</p>
                  )}
                  <p className="t-data-sm text-[var(--color-muted)] mt-1.5">{programCounts(activeProgram)}</p>
                </div>
                <div className="-mr-2.5 -mt-1.5">
                  {renderMenu(activeProgram.id, `Options for ${activeProgram.name}`, programMenuItems(activeProgram))}
                </div>
              </div>
              <div className="mt-4">{renderDays(activeProgram)}</div>
            </motion.section>
          )}

          {otherPrograms.length > 0 && (
            <section className={activeProgram ? 'mt-10' : ''} aria-labelledby="other-programs-label">
              <h2 id="other-programs-label" className="t-label mb-1">{activeProgram ? 'Other programs' : 'Programs'}</h2>
              <ul className="platter platter-flush">
                {otherPrograms.map((split, index) => {
                  const isExpanded = expandedSplit === split.id;
                  return (
                    <motion.li
                      key={split.id}
                      className="platter-row"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...springs.settle, delay: Math.min(index * 0.05, 0.3) }}
                    >
                      <div className="flex items-center gap-1 py-2 pl-5 pr-2">
                        <button
                          type="button"
                          className="pressable flex-1 min-w-0 min-h-11 text-left flex items-center gap-3"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="t-heading block break-words">{split.name}</span>
                            <span className="t-caption">{programCounts(split)}</span>
                          </span>
                          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile} className="shrink-0">
                            <ChevronDown className="w-4 h-4 text-[var(--color-muted)]" strokeWidth={1.5} />
                          </motion.span>
                        </button>
                        {renderMenu(split.id, `Options for ${split.name}`, programMenuItems(split))}
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
                            <div className="pb-2">{renderDays(split)}</div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
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
