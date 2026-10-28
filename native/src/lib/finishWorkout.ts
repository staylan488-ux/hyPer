import { router } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { create } from 'zustand';

import { useAppStore } from '@/stores/appStore';

import { summarize, useFinishedStore } from './finished';
import { haptics } from './haptics';
import { flushNotes } from './notes';
import { stopRest } from './rest';
import type { SessionModel } from './sessionModel';

// One finish at a time across every Finish button (Today and Train are both
// mounted): a second tap anywhere while it saves does nothing.
let finishing = false;
const useClosing = create<{ closing: boolean }>(() => ({ closing: false }));

/**
 * Finishing the live workout, wherever Finish is tapped (Train's header, its
 * "All sets logged" card, Today's session card): ask, save the notes, close
 * it, then show the summary. `finish` keeps its identity, so a header built
 * once can call it; a second tap while it saves does nothing.
 */
export function useFinishWorkout(session: SessionModel | null) {
  const latest = useRef(session);
  latest.current = session;
  const closing = useClosing((state) => state.closing);

  const finish = useCallback(() => {
    const current = latest.current;
    if (!current || finishing) return;

    const closeWorkout = async (saveTemplate: boolean) => {
      // Notes typed during the workout land before it closes, as on the web.
      if (!(await flushNotes())) {
        haptics.error();
        Alert.alert('Note not saved', 'The workout is still open. Check your connection and try again.');
        return;
      }
      const summary = summarize(current);
      const store = useAppStore.getState();
      try {
        // A flexible session can be kept as a quick start, notes included.
        if (saveTemplate) await store.saveFlexibleTemplateFromCurrentWorkout();
        await store.completeWorkout();
        if (saveTemplate) void useAppStore.getState().fetchFlexTemplates({ force: true });
        useFinishedStore.getState().set(summary);
        stopRest();
        haptics.success();
        router.push('/session-done');
      } catch {
        haptics.error();
        Alert.alert('Not saved', 'The workout is still open. Check your connection and try again.');
      }
    };
    const close = async (saveTemplate: boolean) => {
      if (finishing) return;
      finishing = true;
      useClosing.setState({ closing: true });
      try {
        await closeWorkout(saveTemplate);
      } finally {
        finishing = false;
        useClosing.setState({ closing: false });
      }
    };

    // As on the web: keeping it as a quick start replaces one with the same name.
    const state = useAppStore.getState();
    const label = state.currentWorkoutDayPlan?.day_label.trim() ?? '';
    const replaces = current.flexible && label !== '' && state.flexTemplates.some((template) => template.label === label);
    const counted = `${current.doneCount} of ${current.sets.length} sets logged.`;
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
