import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, MoreHorizontal, Trash2, ChevronDown, Pencil, Play, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Button, ConfirmDialogHost, Input, Modal, SegmentedControl } from '@/components/shared';
import {
  Chevron,
  HeroFigure,
  MetalSection,
  MetalTitle,
  TrainScope,
  useCommandCapsule,
  type CommandCapsuleSpec,
} from '@/components/metal';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore, type SavedSplit } from '@/stores/splitEditStore';
import { SplitEditorSheet } from '@/components/split/SplitEditorSheet';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { loadPlanScheduleAsync } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { requestConfirm } from '@/lib/confirmDialog';
import type { FlexDayTemplate, Split } from '@/types';
import '@/components/split/program.css';

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const exerciseTotal = (split: Split) => split.days.reduce((sum, d) => sum + (d.exercises?.length || 0), 0);

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
  const [showMenu, setShowMenu] = useState<string | null>(null);
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

  // ── Program sheet: create and edit share one editor ──
  const [editorMode, setEditorMode] = useState<'new' | 'edit' | null>(null);
  // Actions only: selecting them keeps draft edits from re-rendering this page.
  const startEdit = useSplitEditStore((s) => s.startEdit);
  const cancelEdit = useSplitEditStore((s) => s.cancelEdit);

  useEffect(() => {
    void Promise.all([
      fetchSplits(),
      fetchWorkoutMode(),
      fetchCurrentWorkout(),
      fetchFlexTemplates(),
    ]);
  }, [fetchCurrentWorkout, fetchFlexTemplates, fetchSplits, fetchWorkoutMode]);

  // The program menu closes on an outside press or Escape.
  useEffect(() => {
    if (!showMenu) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-program-menu]')) setShowMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(null);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [showMenu]);

  const handleEdit = useCallback((split: Split) => {
    startEdit(split, { userId: user?.id ?? null });
    setShowMenu(null);
    setEditorMode('edit');
  }, [startEdit, user?.id]);

  const handleNew = useCallback(() => {
    cancelEdit();
    setEditorMode('new');
  }, [cancelEdit]);

  const handleDelete = async (split: Split) => {
    setShowMenu(null);
    const confirmed = await requestConfirm({
      title: 'Delete program?',
      message: `${split.name} and its training days will be deleted. Past workouts stay in History.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    const result = await deleteSplit(split.id);
    if (!result.ok) {
      window.alert(result.reason ?? 'Could not delete the program.');
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

  const handleSaved = (saved: SavedSplit) => {
    // Creating already refreshed the list; an edit saved through the snapshot did not.
    if (saved.created) void maybePromptPlanStart(saved.id, saved.name);
    else void fetchSplits({ force: true });
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

  const flexible = workoutMode === 'flexible';
  const activeProgram = flexible ? null : splits.find((split) => split.is_active) ?? null;

  // The page's one primary action: a new program, or a flexible session.
  const capsule: CommandCapsuleSpec = flexible
    ? {
        key: 'program-flex-start',
        label: 'Start session',
        sublabel: 'Build today as you go',
        glyph: 'arrow',
        dock: 'tabbar',
        onPress: () => navigate('/train'),
      }
    : {
        key: splits.length === 0 ? 'program-create' : 'program-new',
        label: splits.length === 0 ? 'Create program' : 'New program',
        sublabel: splits.length === 0 ? 'Guided or blank · about 2 minutes' : 'Guided or blank · edit before it saves',
        glyph: 'plus',
        dock: 'tabbar',
        onPress: handleNew,
      };
  useCommandCapsule(capsule);

  return (
    <div className="metal-page pb-nav">
      <header>
        <TrainScope />
        {flexible ? (
          <MetalTitle note="Flexible · build each session as you go">Program</MetalTitle>
        ) : activeProgram ? (
          <MetalTitle note={`${activeProgram.name} · active`}>Program</MetalTitle>
        ) : splits.length === 0 ? (
          <MetalTitle note="Start here">Build your first program</MetalTitle>
        ) : (
          <MetalTitle note="None active">Program</MetalTitle>
        )}
      </header>

      {activeProgram && (
        <HeroFigure
          value={activeProgram.days.length}
          caption={`training ${activeProgram.days.length === 1 ? 'day' : 'days'} · ${plural(exerciseTotal(activeProgram), 'exercise')}`}
          segments={{ total: Math.max(1, activeProgram.days.length), on: 0, wide: true, label: plural(activeProgram.days.length, 'training day') }}
        />
      )}
      {!flexible && splits.length === 0 && (
        <>
          <HeroFigure value={5} caption="questions · about 2 minutes" segments={{ total: 5, on: 0, wide: true, label: 'Five questions' }} />
          <p className="metal-note">
            Five questions and the guided builder assembles an evidence-based split around your week — editable down to every set.
          </p>
        </>
      )}

      <MetalSection label="Training mode">
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
          className={`mt-2 ${!canSwitchMode ? 'opacity-60 pointer-events-none' : ''}`}
        />
        {!canSwitchMode && (
          <p className="metal-note">Finish the current workout to switch modes.</p>
        )}
      </MetalSection>

      {flexible ? (
        <MetalSection
          label="Quick-start templates"
          right={flexTemplates.length > 0 ? <b>{flexTemplates.length}</b> : undefined}
        >
          {flexTemplates.length === 0 ? (
            <div className="mt-1">
              <p className="metal-row-title">No quick-start templates yet</p>
              <p className="metal-note mt-1">
                Finish a flexible session and hyPer offers to save it — one tap to repeat it next time.
              </p>
            </div>
          ) : (
            <>
              <p className="metal-row-detail mb-3">Saved from your flexible sessions</p>
              <ul>
                {flexTemplates.map((template, index) => {
                  const isExpanded = expandedTemplateId === template.id;
                  const visibleItems = template.items.filter((item) => !item.hidden);

                  return (
                    <motion.li
                      key={template.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...springs.settle, delay: Math.min(index * 0.05, 0.3) }}
                    >
                      <div className="program-row items-center">
                        <button
                          type="button"
                          className="program-row-main"
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedTemplateId(isExpanded ? null : template.id)}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="metal-row-title break-words">{template.label}</span>
                            <span className="metal-row-detail">{plural(visibleItems.length, 'exercise')}</span>
                          </span>
                          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile} className="shrink-0 flex">
                            <ChevronDown className="program-chevron" strokeWidth={1.5} aria-hidden />
                          </motion.span>
                        </button>

                        <div className="flex items-center shrink-0">
                          <button
                            type="button"
                            className="metal-line-btn mr-1 disabled:opacity-40"
                            onClick={() => {
                              tapHaptic();
                              void handleStartFromTemplate(template.label);
                            }}
                            disabled={Boolean(startingTemplateLabel)}
                          >
                            <Play className="!w-2.5 !h-2.5" strokeWidth={1.75} fill="currentColor" aria-hidden />
                            {startingTemplateLabel === template.label ? 'Starting…' : 'Start'}
                          </button>
                          <button
                            type="button"
                            aria-label="Rename template"
                            className="metal-icon-btn"
                            onClick={() => handleOpenRenameTemplate(template)}
                          >
                            <Edit3 strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete template"
                            className="metal-icon-btn is-danger -mr-3"
                            onClick={() => setTemplateToDelete(template)}
                          >
                            <Trash2 strokeWidth={1.5} />
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
                            {visibleItems.length > 0 ? (
                              <ul className="program-exercises">
                                {visibleItems.map((item, itemIndex) => {
                                  const repsLabel = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
                                    ? `${item.target_reps_min}–${item.target_reps_max}`
                                    : '—';
                                  const setsLabel = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';

                                  return (
                                    <li key={`${template.id}-${item.exercise_id}-${itemIndex}`} className="program-exercise">
                                      <span className="program-exercise-index">{itemIndex + 1}</span>
                                      <p className="flex-1 min-w-0 break-words">{item.exercise_name || 'Exercise'}</p>
                                      <span className="program-exercise-value">{setsLabel}×{repsLabel}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="metal-row-detail pb-4">No visible exercises.</p>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </ul>
            </>
          )}
        </MetalSection>
      ) : splits.length > 0 && (
        <MetalSection label="Programs" right={<b>{splits.length}</b>}>
          <ul className="mt-1">
            {splits.map((split, index) => {
              const isExpanded = expandedSplit === split.id;
              const totalExercises = exerciseTotal(split);
              const menuOpen = showMenu === split.id;

              return (
                <motion.li
                  key={split.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.settle, delay: Math.min(index * 0.05, 0.3) }}
                >
                  {/* Program header */}
                  <div className="program-row">
                    <button
                      type="button"
                      className="program-row-main"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="program-name">{split.name}</span>
                        {split.description && (
                          <span className="program-detail line-clamp-2">{split.description}</span>
                        )}
                        <span className="program-detail">
                          {split.is_active && <><b>Active</b> · </>}
                          {plural(split.days.length, 'day')} · {plural(totalExercises, 'exercise')}
                        </span>
                      </span>
                      <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.tactile} className="shrink-0 flex">
                        <ChevronDown className="program-chevron" strokeWidth={1.5} aria-hidden />
                      </motion.span>
                    </button>

                    <div className="program-row-side relative -mr-3" data-program-menu>
                      <button
                        type="button"
                        className="metal-icon-btn"
                        onClick={() => setShowMenu(menuOpen ? null : split.id)}
                        aria-label="Program options"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                      >
                        <MoreHorizontal strokeWidth={1.5} />
                      </button>

                      <AnimatePresence>
                        {menuOpen && (
                          <motion.div
                            role="menu"
                            aria-label={`${split.name} options`}
                            className="metal-menu"
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.15 }}
                            style={{ transformOrigin: '100% 0%' }}
                          >
                            {!split.is_active && (
                              <button
                                type="button"
                                role="menuitem"
                                className="metal-menu-item"
                                onClick={() => {
                                  void handleSelectSplit(split.id, split.name);
                                }}
                              >
                                <Check strokeWidth={1.75} aria-hidden />
                                Set active
                              </button>
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              className="metal-menu-item"
                              onClick={() => handleEdit(split)}
                            >
                              <Pencil strokeWidth={1.75} aria-hidden />
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="metal-menu-item is-danger"
                              onClick={() => { void handleDelete(split); }}
                            >
                              <Trash2 strokeWidth={1.75} aria-hidden />
                              Delete
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Expanded program details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        className="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={springs.settle}
                      >
                        <ul className="program-days">
                          {split.days.map((day, dayIndex) => {
                            const isDayExpanded = expandedDay === day.id;
                            const exerciseCount = day.exercises?.length || 0;

                            return (
                              <motion.li
                                key={day.id}
                                className="program-day"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: dayIndex * 0.04, ...springs.settle }}
                              >
                                <button
                                  type="button"
                                  className="program-day-row"
                                  aria-expanded={isDayExpanded}
                                  onClick={() => setExpandedDay(isDayExpanded ? null : day.id)}
                                >
                                  <span className="flex-1 min-w-0">
                                    <span className="metal-row-title break-words">{day.day_name}</span>
                                    <span className="metal-row-detail">{plural(exerciseCount, 'exercise')}</span>
                                  </span>
                                  <motion.span animate={{ rotate: isDayExpanded ? 90 : 0 }} transition={springs.tactile} className="shrink-0 flex">
                                    <Chevron className="metal-row-chevron" />
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
                                        <ul className="program-exercises">
                                          {day.exercises?.map((ex, exIndex) => (
                                            <motion.li
                                              key={ex.id}
                                              className="program-exercise"
                                              initial={{ opacity: 0, y: 4 }}
                                              animate={{ opacity: 1, y: 0 }}
                                              transition={{ delay: exIndex * 0.03, ...springs.settle }}
                                            >
                                              <span className="program-exercise-index">{exIndex + 1}</span>
                                              <p className="flex-1 min-w-0 break-words">
                                                {ex.exercise?.name || 'Unknown Exercise'}
                                              </p>
                                              <span className="program-exercise-value">
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
                                        <p className="metal-row-detail pb-3 pl-4">No exercises assigned</p>
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
        </MetalSection>
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
          <p className="metal-note mt-0">This removes the template from your flexible dashboard.</p>
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
          <p className="metal-note mt-0">
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

      <SplitEditorSheet
        mode={editorMode}
        userId={user?.id ?? null}
        onClose={() => setEditorMode(null)}
        onSaved={handleSaved}
      />

      {/* Last, so its sheet sits above the editor and picker */}
      <ConfirmDialogHost />
    </div>
  );
}
