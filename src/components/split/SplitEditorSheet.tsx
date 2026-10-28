import { useCallback, useState } from 'react';
import { Modal } from '@/components/shared';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { NewSplitChooser } from '@/components/split/NewSplitChooser';
import { SplitEditor } from '@/components/split/SplitEditor';
import { cancelSplitEdit } from '@/components/split/editor/editorActions';
import { useSplitDraftAutosave } from '@/components/split/editor/useSplitDraftAutosave';
import type { PickMode } from '@/components/split/editor/types';
import { PROGRAM_PICKER_TITLES, pickerTargetFor, type DraftSplit, type ProgramPickerTarget } from '@/lib/splitDraft';
import type { StoredSplitDraft } from '@/lib/splitDraftStorage';
import { useAppStore } from '@/stores/appStore';
import { useSplitEditStore, type SavedSplit } from '@/stores/splitEditStore';
import type { Exercise } from '@/types';

type PickerTarget = ProgramPickerTarget;
const PICKER_TITLES = PROGRAM_PICKER_TITLES;

/**
 * The program sheet for creating and editing. A new program starts at the
 * chooser, which only seeds the shared editor; the exercise picker serves
 * add (several at once), swap and superset.
 */
export function SplitEditorSheet({
  mode,
  userId,
  onClose,
  onSaved,
}: {
  /** null keeps the sheet closed. */
  mode: 'new' | 'edit' | null;
  userId: string | null;
  onClose: () => void;
  onSaved: (saved: SavedSplit) => void;
}) {
  useSplitDraftAutosave();
  const createSplit = useAppStore((s) => s.createSplit);
  const hasDraft = useSplitEditStore((s) => s.draft !== null);
  const startNew = useSplitEditStore((s) => s.startNew);
  const restoreDraft = useSplitEditStore((s) => s.restoreDraft);
  const swapExercise = useSplitEditStore((s) => s.swapExercise);
  const addExercises = useSplitEditStore((s) => s.addExercises);
  const addSupersetExercise = useSplitEditStore((s) => s.addSupersetExercise);
  const [notice, setNotice] = useState<string | null>(null);
  // The last target stays while the picker animates closed.
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const close = useCallback(() => {
    setNotice(null);
    setPickerOpen(false);
    onClose();
  }, [onClose]);

  const handleSeed = useCallback((draft: DraftSplit, seedNotice?: string) => {
    startNew(draft, { userId });
    setNotice(seedNotice ?? null);
  }, [startNew, userId]);

  const handleResume = useCallback((stored: StoredSplitDraft) => {
    restoreDraft(stored, { userId });
    setNotice(null);
  }, [restoreDraft, userId]);

  const handlePickExercise = useCallback((dayId: string, pickMode: PickMode, exerciseId?: string) => {
    const { draft } = useSplitEditStore.getState();
    if (!draft) return;
    setPicker(pickerTargetFor(draft, dayId, pickMode, exerciseId));
    setPickerOpen(true);
  }, []);

  const handlePicked = useCallback((exercise: Exercise) => {
    if (!picker?.exerciseId) return;
    if (picker.mode === 'swap') swapExercise(picker.dayId, picker.exerciseId, exercise);
    else if (picker.mode === 'superset') addSupersetExercise(picker.dayId, picker.exerciseId, exercise);
  }, [picker, swapExercise, addSupersetExercise]);

  const handlePickedMany = useCallback((exercises: Exercise[]) => {
    if (picker) addExercises(picker.dayId, exercises);
  }, [picker, addExercises]);

  const showChooser = mode === 'new' && !hasDraft;

  return (
    <>
      <Modal
        isOpen={mode !== null}
        onClose={() => { void cancelSplitEdit(close); }}
        title={mode === 'new' ? 'New program' : 'Edit program'}
      >
        {showChooser ? (
          <NewSplitChooser userId={userId} onSeed={handleSeed} onResume={handleResume} />
        ) : (
          <SplitEditor
            createSplit={createSplit}
            onClose={close}
            onSaved={onSaved}
            onPickExercise={handlePickExercise}
            notice={notice}
          />
        )}
      </Modal>

      <ExercisePicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePicked}
        onSelectMany={picker?.mode === 'add' ? handlePickedMany : undefined}
        allowCustom
        extraExercises={picker?.extraExercises}
        initialMuscleGroup={picker?.initialMuscleGroup}
        excludeExerciseIds={picker?.excludeExerciseIds}
        title={picker ? PICKER_TITLES[picker.mode] : undefined}
      />
    </>
  );
}
