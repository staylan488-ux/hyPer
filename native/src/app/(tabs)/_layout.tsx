import { useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect, useState } from 'react';

import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';
import { useWhoopForegroundSync } from '@/hooks/useWhoopForegroundSync';
import { useKeepAwakeWhile } from '@/lib/keepAwake';
import { useAuthStore } from '@/stores/authStore';

import { WorkoutAccessory } from '~/components/WorkoutAccessory';
import { useWorkoutBarShown } from '~/lib/workoutBar';
import { useAccountData, useAccountDay } from '~/lib/accountData';
import { useFinishedStore } from '~/lib/finished';
import { resetFuel } from '~/lib/fuel';
import { useFuelReminder } from '~/lib/fuelReminder';
import { haptics } from '~/lib/haptics';
import { useHealthCarryOver } from '~/lib/healthCarryOver';
import { resetHistory } from '~/lib/history';
import { useLaunchActionRunner } from '~/lib/launch';
import { useNotesStore } from '~/lib/notes';
import { useRestFinish, useRestLifecycle, useRestPreferences, useRestStore } from '~/lib/rest';
import {
  useFocusStore,
  usePendingSkips,
  usePreviousNotesStore,
  usePreviousTargetsLookup,
  usePreviousTargetsStore,
  useSessionModel,
  useWorkoutDayPlan,
} from '~/lib/session';
import { useWidgetSnapshot } from '~/lib/widgets';
import { useWorkoutActivity } from '~/lib/workoutActivity';
import { loadWeights, resetYou, useHealthStore } from '~/lib/you';
import { dynamicGraphite, dynamicInk } from '~/theme/blanc';

// Sheets that belong to the live workout; the screen stays awake under them too.
const WORKOUT_SHEETS = new Set(['movement', 'rest', 'swap', 'session-done']);

export default function TabsLayout() {
  const session = useSessionModel();
  // The tabs and the workout bar follow only whether a workout is live, so a
  // logged set doesn't rebuild them.
  const live = session !== null;
  // As on the web's Train page: a live workout never lets the screen lock mid-set.
  const segments = useSegments() as string[];
  const onTrain = segments[0] === '(tabs)' ? segments[1] === 'train' : WORKOUT_SHEETS.has(segments[0] ?? '');
  useKeepAwakeWhile(live && onTrain);
  // The bar repeats the live workout, so it steps aside on the two screens that
  // already show it: Today's live card and Train's set card. During a rest it
  // stays on Train too, with the countdown. A sheet over a screen keeps that
  // screen's choice, so the bar never pops in behind it.
  const resting = useRestStore((state) => state.session !== null && state.session.status !== 'completed');
  const onTabRoot = segments[0] === '(tabs)' ? segments.length === 2 && (segments[1] === 'today' || segments[1] === 'train') : null;
  const [showsWorkout, setShowsWorkout] = useState(false);
  const nextShowsWorkout = onTabRoot === null ? showsWorkout : onTabRoot && !(segments[1] === 'train' && resting);
  if (nextShowsWorkout !== showsWorkout) setShowsWorkout(nextShowsWorkout);
  const accessory = live && !nextShowsWorkout;
  // Tab pages size their foot by the bar that is really there.
  useEffect(() => {
    useWorkoutBarShown.setState({ shown: accessory });
  }, [accessory]);
  useRestLifecycle();
  useRestFinish();
  useRestPreferences();
  useWorkoutDayPlan();
  // Last time's numbers, for Train, the movement sheet and Finish wherever it is tapped.
  usePreviousTargetsLookup(session);
  useWorkoutActivity(session);
  useAccountData();
  // The home-screen widgets' Fuel and Training figures.
  useWidgetSnapshot();
  // The optional fuel reminder (You) follows the same figures.
  useFuelReminder();
  // Snap a meal, Log food or Train pressed outside the app, run once the app is up.
  useLaunchActionRunner();
  // As in the web app's shell: WHOOP catches up when the app comes back, and
  // Apple Health weights flow in once turned on in You.
  const userId = useAuthStore((state) => state.user?.id);
  useWhoopForegroundSync(userId);
  // The released app turns Health sync back on once if the Capacitor app had it on.
  const healthReady = useHealthCarryOver(userId);
  // It follows the switch in You: Stop prevents further import pages (an
  // upload already sent may finish); turning it on needs no relaunch. New
  // weigh-ins reach You's body weight as they arrive.
  const healthOn = useHealthStore((state) => state.enabled);
  useNativeHealthSync(healthReady && healthOn ? userId : undefined, loadWeights);
  // The tabs unmount only on sign-out: leave nothing of this account behind.
  // (The rest, its notification and the lock-screen card are cleared by the
  // shared sign-out guard in useRestLifecycle. The fuel reminder clears itself
  // (useFuelReminder).)
  useEffect(
    () => () => {
      useFocusStore.getState().focus(null);
      usePendingSkips.setState({ workoutId: null, skips: {} });
      useNotesStore.setState({ workoutId: null, drafts: {}, base: null, status: {} });
      resetHistory();
      resetYou();
      resetFuel();
      useFinishedStore.setState({ summary: null });
      useAccountDay.setState({ loading: true });
      usePreviousNotesStore.setState({ workoutId: null, notes: {} });
      usePreviousTargetsStore.setState({ workoutId: null, targets: {} });
    },
    [],
  );

  return (
    <NativeTabs
      tintColor={dynamicInk}
      // The chosen tab in ink, the others in graphite: the selection reads without an accent colour.
      iconColor={{ default: dynamicGraphite, selected: dynamicInk }}
      labelStyle={{ default: { color: dynamicGraphite }, selected: { color: dynamicInk } }}
      // On every tab. iOS only shrinks pages that scroll well past the screen
      // and sticks on pages just past that, so tab pages use TabScroll.
      minimizeBehavior="onScrollDown"
      // iOS's tab bar has no tap feedback of its own; the web app's tabs did.
      screenListeners={{ tabPress: () => haptics.tap() }}>
      {accessory ? (
        <NativeTabs.BottomAccessory>
          <WorkoutAccessory />
        </NativeTabs.BottomAccessory>
      ) : null}

      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="train">
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} />
        <NativeTabs.Trigger.Label>Train</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="fuel">
        <NativeTabs.Trigger.Icon sf="fork.knife" />
        <NativeTabs.Trigger.Label>Fuel</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
