// Program on native: open the shared editor, act on programs and quick starts
// through the shared store actions, and ask with iOS's own alerts where the
// web uses its confirm sheet or window prompts.
import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { ConfirmOptions } from '@/lib/confirmDialog';
import { dismissPlanStartPrompt, shouldPromptPlanStart } from '@/lib/planSchedule';
import { renameTemplateWithConfirm } from '@/lib/programSummary';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore, type SavedSplit } from '@/stores/splitEditStore';
import type { DraftExercise } from '@/lib/splitDraft';
import type { FlexDayTemplate, Split } from '@/types';

import { haptics } from './haptics';

/** The web's confirm question as an iOS alert. */
export function confirmAlert({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const userId = () => useAuthStore.getState().user?.id ?? null;

/** Opens the editor on a saved program. */
export function editProgram(split: Split) {
  haptics.tap();
  useSplitEditStore.getState().startEdit(split, { userId: userId() });
  router.push({ pathname: '/program-edit', params: { mode: 'edit' } });
}

/** Opens the new-program chooser. */
export function newProgram() {
  haptics.tap();
  useSplitEditStore.getState().cancelEdit();
  router.push({ pathname: '/program-edit', params: { mode: 'new' } });
}

/**
 * After a program is created or set active: offers to set Day 1 and the
 * rhythm when it has no schedule yet, unless Later was chosen for it.
 */
export async function offerPlanStart(splitId: string, name: string) {
  const user = userId();
  if (!user || !(await shouldPromptPlanStart(user, splitId))) return;
  // Only for the program that is still the active one.
  if (useAppStore.getState().activeSplit?.id !== splitId) return;
  Alert.alert(`${name} is active`, 'Set your Day 1 and weekly rhythm now. It takes about 15 seconds and lets hyPer call your next session.', [
    { text: 'Later', style: 'cancel', onPress: () => dismissPlanStartPrompt(user, splitId) },
    { text: 'Set now', onPress: () => router.push('/schedule') },
  ]);
}

/** After the editor saves: a new program may need a schedule; an edit needs a fresh list. */
export function afterProgramSaved(saved: SavedSplit) {
  if (saved.created) void offerPlanStart(saved.id, saved.name);
  else void useAppStore.getState().fetchSplits({ force: true });
}

export async function setActiveProgram(split: Split) {
  const result = await useAppStore.getState().setActiveSplit(split.id);
  if (!result.ok) {
    haptics.error();
    Alert.alert('Not changed', result.reason ?? 'Could not set the active program.');
    return;
  }
  haptics.success();
  await offerPlanStart(split.id, split.name);
}

/** The program a workout in progress came from, which must not be deleted under it. */
function programInUse(split: Split): boolean {
  const workout = useAppStore.getState().currentWorkout;
  if (!workout || workout.completed || !workout.split_day_id) return false;
  return split.days.some((day) => day.id === workout.split_day_id);
}

/** Asks first, as on the web. Resolves true once deleted. */
export async function deleteProgram(split: Split): Promise<boolean> {
  if (programInUse(split)) {
    haptics.error();
    Alert.alert('Finish your workout first', `Today's workout is from ${split.name}.`);
    return false;
  }
  const confirmed = await confirmAlert({
    title: 'Delete program?',
    message: `${split.name} and its training days will be deleted. Past workouts stay in History.`,
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return false;
  const result = await useAppStore.getState().deleteSplit(split.id);
  if (!result.ok) {
    haptics.error();
    Alert.alert('Not deleted', result.reason ?? 'Could not delete the program.');
    return false;
  }
  haptics.success();
  return true;
}

export function renameQuickStart(template: FlexDayTemplate) {
  Alert.prompt(
    'Rename quick start',
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (text?: string) => {
          const label = (text ?? '').slice(0, 40);
          if (label.trim() === template.label) return;
          void renameTemplateWithConfirm({
            rename: useAppStore.getState().renameFlexTemplate,
            confirmOverwrite: (conflict) =>
              confirmAlert({ title: `Replace “${conflict}”?`, message: 'A quick start with that name already exists.', confirmLabel: 'Replace', destructive: true }),
            templateId: template.id,
            label,
          }).then((failure) => {
            if (failure) {
              haptics.error();
              Alert.alert('Not renamed', failure);
            } else haptics.success();
          });
        },
      },
    ],
    'plain-text',
    template.label,
  );
}

/** Starts a flexible session from a quick start, then shows it on Train. */
export async function startQuickStart(template: FlexDayTemplate): Promise<void> {
  try {
    const started = await useAppStore.getState().startFlexibleWorkoutFromTemplate(template.label);
    if (!started) {
      haptics.error();
      Alert.alert('Finish your other workout first', 'A program session from today is still open.');
      return;
    }
    haptics.success();
    router.dismissTo('/train');
  } catch (error) {
    haptics.error();
    Alert.alert('Could not start', error instanceof Error ? error.message : 'Check your connection and try again.');
  }
}

/** "3 × 8–12", or "2–4 sets × 8–12" with a set range. */
export function targetsLine(exercise: DraftExercise): string {
  const sets = exercise.target_sets_min === exercise.target_sets_max
    ? `${exercise.target_sets}`
    : `${exercise.target_sets_min}–${exercise.target_sets_max} sets`;
  return `${sets} × ${exercise.target_reps_min}–${exercise.target_reps_max}`;
}

