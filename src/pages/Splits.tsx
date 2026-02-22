import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, MoreVertical, Trash2, ChevronDown, ChevronRight, Pencil, Play, Edit3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Modal } from '@/components/shared';
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

      navigate('/workout');
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
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      {/* Header */}
      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
              {workoutMode === 'flexible'
                ? `${flexTemplates.length} ${flexTemplates.length === 1 ? 'Template' : 'Templates'}`
                : `${splits.length} ${splits.length === 1 ? 'Program' : 'Programs'}`}
            </p>
            <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Training</h1>
          </div>
          {workoutMode === 'split' && (
            <Button size="sm" onClick={() => setShowBuilder(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New
            </Button>
          )}
        </div>

        <div className="mt-4 inline-flex items-center gap-1 rounded-[14px] border border-white/10 bg-[#1F1F1F] p-1">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-[10px] text-[10px] tracking-[0.1em] uppercase transition-colors ${
              workoutMode === 'split'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'text-[#9A9A9A] hover:text-[#E8E4DE]'
            } ${!canSwitchMode ? 'opacity-60 cursor-not-allowed' : ''}`}
            disabled={!canSwitchMode}
            onClick={() => { void handleSetWorkoutMode('split'); }}
          >
            Split
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-[10px] text-[10px] tracking-[0.1em] uppercase transition-colors ${
              workoutMode === 'flexible'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'text-[#9A9A9A] hover:text-[#E8E4DE]'
            } ${!canSwitchMode ? 'opacity-60 cursor-not-allowed' : ''}`}
            disabled={!canSwitchMode}
            onClick={() => { void handleSetWorkoutMode('flexible'); }}
          >
            Flexible
          </button>
        </div>
        {!canSwitchMode && (
          <p className="mt-2 text-[10px] text-[#8F8A83]">Finish current workout to switch mode.</p>
        )}
      </motion.header>

      {workoutMode === 'flexible' ? (
        <div className="space-y-3">
          <Card variant="slab" className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Flexible Templates</p>
              <p className="text-xs text-[#9A9A9A] mt-1">
                {flexTemplates.length} saved {flexTemplates.length === 1 ? 'template' : 'templates'}
              </p>
            </div>
            <Button onClick={() => navigate('/workout')}>Start Flexible Workout</Button>
          </Card>

          {flexTemplates.length === 0 ? (
            <Card variant="slab" className="text-center py-16">
              <p className="text-xs text-[#6B6B6B] mb-6">No flexible templates yet. Complete a flexible workout to auto-save one.</p>
              <Button onClick={() => navigate('/workout')}>
                Start Flexible Workout
              </Button>
            </Card>
          ) : (
            flexTemplates.map((template, index) => {
              const isExpanded = expandedTemplateId === template.id;
              const visibleItems = template.items.filter((item) => !item.hidden);

              return (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.smooth, delay: index * 0.06 }}
                >
                  <Card variant="slab">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => setExpandedTemplateId(isExpanded ? null : template.id)}
                      >
                        <h3 className="text-sm text-[#E8E4DE]">{template.label}</h3>
                        <p className="text-[10px] text-[#6B6B6B] mt-1">{visibleItems.length} exercises</p>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => { void handleStartFromTemplate(template.label); }}
                          disabled={Boolean(startingTemplateLabel)}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          {startingTemplateLabel === template.label ? 'Starting...' : 'Start'}
                        </Button>
                        <button
                          type="button"
                          className="p-2 rounded-[10px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 transition-colors"
                          onClick={() => handleOpenRenameTemplate(template)}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="p-2 rounded-[10px] text-[#8B6B6B] hover:text-[#D39B9B] hover:bg-white/5 transition-colors"
                          onClick={() => setTemplateToDelete(template)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                          <ChevronDown className="w-4 h-4 text-[#6B6B6B]" />
                        </motion.div>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="mt-4 pt-4 border-t border-white/5 space-y-2"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={springs.smooth}
                        >
                          {visibleItems.length > 0 ? (
                            visibleItems.map((item, itemIndex) => {
                              const repsLabel = typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number'
                                ? `${item.target_reps_min}-${item.target_reps_max}`
                                : '—';
                              const setsLabel = typeof item.target_sets === 'number' ? `${item.target_sets}` : '—';

                              return (
                                <div key={`${template.id}-${item.exercise_id}-${itemIndex}`} className="flex items-center gap-3 px-3 py-2 rounded-[12px] bg-[#242424]">
                                  <div className="w-6 h-6 rounded-[8px] bg-[#2E2E2E] flex items-center justify-center text-[9px] text-[#6B6B6B] tabular-nums">
                                    {itemIndex + 1}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-[#E8E4DE] truncate">{item.exercise_name || 'Exercise'}</p>
                                  </div>
                                  <p className="text-[10px] text-[#6B6B6B] tabular-nums">{setsLabel}x{repsLabel}</p>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[10px] text-[#6B6B6B] py-2">No visible exercises.</p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      ) : splits.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <Card variant="slab" className="text-center py-16">
            <p className="text-xs text-[#6B6B6B] mb-6">No programs created</p>
            <Button onClick={() => setShowBuilder(true)}>
              Create Program
            </Button>
          </Card>
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
                transition={{ ...springs.smooth, delay: index * 0.06 }}
              >
                <Card
                  variant="slab"
                  className={`relative ${split.is_active ? 'bg-accent-tint border-[#C4A484]/30' : ''}`}
                >
                  {split.is_active && (
                    <motion.div
                      className="absolute inset-0 rounded-[28px] pointer-events-none"
                      animate={{ boxShadow: ['0 0 0px rgba(196,164,132,0)', '0 0 15px rgba(196,164,132,0.06)', '0 0 0px rgba(196,164,132,0)'] }}
                      transition={{ duration: 3, repeat: Infinity }}
                    />
                  )}
                  {/* Program Header */}
                  <div className="flex items-start justify-between">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setExpandedSplit(isExpanded ? null : split.id)}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-sm text-[#E8E4DE]">{split.name}</h3>
                        {split.is_active && (
                          <motion.span
                            className="px-2 py-0.5 bg-[#C4A484]/10 text-[9px] tracking-[0.1em] uppercase text-[#C4A484] rounded-[8px]"
                            animate={{ opacity: [0.7, 1, 0.7] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          >
                            Active
                          </motion.span>
                        )}
                      </div>

                      {split.description && (
                        <p className="text-[10px] text-[#6B6B6B] mb-4">{split.description}</p>
                      )}

                      <div className="flex flex-wrap gap-2 items-center">
                        {split.days.map((day, dayIdx) => (
                          <motion.span
                            key={day.id}
                            className="px-3 py-1.5 bg-[#2E2E2E] text-[9px] tracking-[0.1em] uppercase rounded-[12px] text-[#9A9A9A]"
                            whileHover={{ scale: 1.05 }}
                            transition={springs.snappy}
                          >
                            {String(dayIdx + 1).padStart(2, '0')} — {day.day_name}
                          </motion.span>
                        ))}
                        <div className="flex items-center gap-1 text-[#6B6B6B] ml-2">
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={springs.snappy}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </motion.div>
                        </div>
                      </div>
                    </div>

                    <div className="relative ml-4">
                      <motion.button
                        className="p-2 hover:bg-white/5 active:bg-white/10 rounded-[12px] transition-colors"
                        onClick={() => setShowMenu(showMenu === split.id ? null : split.id)}
                        whileTap={{ scale: 0.9 }}
                      >
                        <MoreVertical className="w-4 h-4 text-[#6B6B6B]" />
                      </motion.button>

                      <AnimatePresence>
                        {showMenu === split.id && (
                          <motion.div
                            className="absolute right-0 top-full mt-1 bg-[#2E2E2E] border border-white/10 rounded-[16px] shadow-lg z-10 py-1 min-w-[140px] overflow-hidden"
                            initial={{ opacity: 0, y: -4, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                          >
                            {!split.is_active && (
                                <button
                                  className="w-full px-4 py-3 text-left text-[10px] tracking-[0.1em] uppercase text-[#E8E4DE] hover:bg-white/5 active:bg-white/10 flex items-center gap-3"
                                  onClick={() => {
                                  void handleSelectSplit(split.id, split.name);
                                  }}
                                >
                                <Check className="w-3 h-3" />
                                Set Active
                              </button>
                            )}
                            <button
                              className="w-full px-4 py-3 text-left text-[10px] tracking-[0.1em] uppercase text-[#E8E4DE] hover:bg-white/5 active:bg-white/10 flex items-center gap-3"
                              onClick={() => handleEdit(split)}
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              className="w-full px-4 py-3 text-left text-[10px] tracking-[0.1em] uppercase text-[#8B6B6B] hover:bg-white/5 active:bg-white/10 flex items-center gap-3"
                              onClick={() => handleDelete(split.id)}
                            >
                              <Trash2 className="w-3 h-3" />
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
                        className="mt-6 pt-6 border-t border-white/5 space-y-3"
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
                              className="bg-[#1A1A1A] rounded-[16px] overflow-hidden"
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: dayIndex * 0.04, ...springs.smooth }}
                            >
                              {/* Day Header */}
                              <div
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                                onClick={() => setExpandedDay(isDayExpanded ? null : day.id)}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-[10px] bg-[#2E2E2E] flex items-center justify-center">
                                    <span className="text-[10px] text-[#6B6B6B] tabular-nums">{String(dayIndex + 1).padStart(2, '0')}</span>
                                  </div>
                                  <div>
                                    <p className="text-xs text-[#E8E4DE]">{day.day_name}</p>
                                    <p className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]">
                                      {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
                                    </p>
                                  </div>
                                </div>
                                <motion.div
                                  animate={{ rotate: isDayExpanded ? 90 : 0 }}
                                  transition={springs.snappy}
                                >
                                  <ChevronRight className="w-4 h-4 text-[#6B6B6B]" />
                                </motion.div>
                              </div>

                              {/* Exercise List */}
                              <AnimatePresence>
                                {isDayExpanded && (
                                  <motion.div
                                    className="px-4 pb-4"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={springs.smooth}
                                  >
                                    {exerciseCount > 0 ? (
                                      <div className="space-y-2">
                                        {day.exercises?.map((ex, exIndex) => (
                                          <motion.div
                                            key={ex.id}
                                            className="flex items-center gap-3 p-3 bg-[#242424] rounded-[12px]"
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: exIndex * 0.03, ...springs.smooth }}
                                          >
                                            <div className="w-6 h-6 rounded-[8px] bg-[#2E2E2E] flex items-center justify-center">
                                              <span className="text-[9px] text-[#6B6B6B]">{exIndex + 1}</span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <p className="text-[11px] text-[#E8E4DE] truncate">{ex.exercise?.name || 'Unknown Exercise'}</p>
                                            </div>
                                            <div className="text-[10px] text-[#6B6B6B] tabular-nums">
                                              {(() => {
                                                const setRange = parseSetRangeNotes(ex.notes, ex.target_sets);
                                                const setLabel = setRange.minSets === setRange.maxSets
                                                  ? `${setRange.targetSets}`
                                                  : `${setRange.minSets}-${setRange.maxSets}`;

                                                return `${setLabel}x${ex.target_reps_min}-${ex.target_reps_max}`;
                                              })()}
                                            </div>
                                          </motion.div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-[#6B6B6B] text-center py-4">
                                        No exercises assigned
                                      </p>
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
                </Card>
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
        title="Rename Template"
      >
        <div className="space-y-4">
          <input
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={40}
            placeholder="Template label"
            className="w-full rounded-[14px] border border-white/10 bg-[#1A1A1A] px-4 py-3 text-sm text-[#E8E4DE] placeholder:text-[#6B6B6B] outline-none focus:border-[#C4A484]"
          />
          <div className="flex gap-3 pt-2">
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
            >
              {renamingTemplate ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(templateToDelete)}
        onClose={() => setTemplateToDelete(null)}
        title="Delete Template"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#E8E4DE]">
            Delete <span className="font-semibold">{templateToDelete?.label}</span>?
          </p>
          <p className="text-xs text-[#6B6B6B] leading-relaxed">
            This removes the template from your flexible dashboard.
          </p>
          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setTemplateToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => { void handleConfirmDeleteTemplate(); }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showPlanStartPrompt}
        onClose={() => setShowPlanStartPrompt(false)}
        title="Set Plan Start"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#E8E4DE]">
            {promptSplit?.name || 'This program'} is now active.
          </p>
          <p className="text-xs text-[#6B6B6B] leading-relaxed">
            Want to set your Day 1 and schedule now? It takes about 15 seconds and makes your training dashboard much clearer.
          </p>
          <div className="flex gap-3 pt-2">
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
                navigate('/workout');
              }}
            >
              Set Now
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
        title="New Program"
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
        title="Edit Program"
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
    </motion.div>
  );
}
