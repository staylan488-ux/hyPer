import { router } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Alert, Keyboard } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { useAppStore } from '@/stores/appStore';
import { prepareWorkoutFinish } from '@/lib/workoutFinish';

import { summarize, useFinishedStore } from './finished';
import { haptics } from './haptics';
import { flushNotes } from './notes';
import { stopRest } from './rest';
import { liveSessionModel, previousTargetsFor } from './session';
import { skippedLine, type SessionModel } from './sessionModel';

// One finish at a time across every Finish button (Today and Train are both
// mounted): a second tap anywhere while it saves does nothing.
let finishing = false;
const useClosing = create<{ closing: boolean }>(() => ({ closing: false }));

/**
 * Finishing the live workout, wherever Finish is tapped (Train's header, its
 * "All sets logged" card, Today's session card): ask (unless a program
 * session is fully logged with nothing skipped), save the notes, close it,
 * then show the summary. `finish` keeps its identity, so a header built
 * once can call it; a second tap while it saves does nothing.
 */
export function useFinishWorkout(session: SessionModel | null) {
  const latest = useRef(session);
  latest.current = session;
  const closing = useClosing((state) => state.closing);

  const finish = useCallback(() => {
    const current = latest.current;
    if (!current || finishing) return;
    const isCurrentAccount = captureAccountScope();
    const isCurrentWorkout = () => isCurrentAccount() && useAppStore.getState().currentWorkout?.id === current.workoutId;
    const prepare = prepareWorkoutFinish(current.workoutId, liveSessionModel);

    const closeWorkout = async (saveTemplate: boolean) => {
      if (!isCurrentWorkout()) return;
      // Notes typed during the workout land before it closes.
      const notesSaved = await flushNotes();
      if (!isCurrentWorkout()) return;
      if (!notesSaved) {
        haptics.error();
        Alert.alert('Note not saved', 'The workout is still open. Check your connection and try again.');
        return;
      }
      // A set still saving lands first and counts in the summary. One that
      // fails keeps the workout open, with Retry on its card.
      const prepared = await prepare();
      if (!isCurrentWorkout()) return;
      if (prepared.kind === 'save-failed') {
        haptics.error();
        Alert.alert('Not saved', 'The workout is still open. Check your connection and try again.');
        return;
      }
      if (prepared.kind === 'changed') return;
      const finished = prepared.session;
      const summary = summarize(finished, previousTargetsFor(finished.workoutId));
      const skipped = finished.movements.filter((movement) => movement.skipped).map((movement) => movement.exerciseId);
      const store = useAppStore.getState();
      try {
        // A flexible session can be kept as a quick start, notes included.
        if (saveTemplate) await store.saveFlexibleTemplateFromCurrentWorkout();
        // Saving the quick start can outlast an account or workout change.
        // completeWorkout reads the current store, so never hand it a new one.
        if (!isCurrentWorkout()) return;
        await store.completeWorkout();
        if (!isCurrentAccount() || useAppStore.getState().currentWorkout) return;
        if (saveTemplate) void useAppStore.getState().fetchFlexTemplates({ force: true });
        // Skipped movements leave the finished workout, so History counts what
        // was done. Their logged sets stay; if this fails they show as unlogged.
        if (skipped.length) void useAppStore.getState().removeUnloggedSets(finished.workoutId, skipped).catch(() => {});
        useFinishedStore.getState().set(summary);
        stopRest();
        haptics.success();
        router.push('/session-done');
      } catch {
        if (!isCurrentWorkout()) return;
        haptics.error();
        Alert.alert('Not saved', 'The workout is still open. Check your connection and try again.');
      }
    };
    const close = async (saveTemplate: boolean) => {
      if (finishing) return;
      finishing = true;
      useClosing.setState({ closing: true });
      Keyboard.dismiss();
      try {
        await closeWorkout(saveTemplate);
      } finally {
        finishing = false;
        useClosing.setState({ closing: false });
      }
    };

    // A program session with every set logged and nothing skipped has nothing
    // to warn about or choose: Finish finishes, without asking first.
    const skipped = skippedLine(current);
    if (!current.flexible && current.sets.length > 0 && current.doneCount >= current.sets.length && !skipped) {
      void close(false);
      return;
    }

    // Keeping it as a quick start replaces one with the same name.
    const state = useAppStore.getState();
    const label = state.currentWorkoutDayPlan?.day_label.trim() ?? '';
    const replaces = current.flexible && label !== '' && state.flexTemplates.some((template) => template.label === label);
    const counted = [`${current.doneCount} of ${current.sets.length} sets logged.`, skipped].filter(Boolean).join(' ');
    Alert.alert('Finish workout?', replaces ? `${counted} Saving as a quick start replaces your “${current.dayName}” quick start.` : counted, [
      ...(current.flexible && current.movements.length > 0
        ? [{ text: 'Finish and save as quick start', onPress: () => void close(true) }]
        : []),
      { text: 'Finish', onPress: () => void close(false) },
      { text: 'Keep going', style: 'cancel' as const },
    ]);
  }, []);

  return { finish, closing };
}
