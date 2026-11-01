import { useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';

import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';
import { useWhoopForegroundSync } from '@/hooks/useWhoopForegroundSync';
import { useKeepAwakeWhile } from '@/lib/keepAwake';
import { useAuthStore } from '@/stores/authStore';

import { WorkoutAccessory } from '~/components/WorkoutAccessory';
import { useAccountData, useAccountDay } from '~/lib/accountData';
import { useFinishedStore } from '~/lib/finished';
import { resetFuel } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useHealthCarryOver } from '~/lib/healthCarryOver';
import { resetHistory } from '~/lib/history';
import { useNotesStore } from '~/lib/notes';
import { useRestFinish, useRestLifecycle, useRestPreferences } from '~/lib/rest';
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
import { resetYou } from '~/lib/you';
import { dynamicInk } from '~/theme/blanc';

// Sheets that belong to the live workout; the screen stays awake under them too.
const WORKOUT_SHEETS = new Set(['movement', 'rest', 'swap', 'session-done']);

export default function TabsLayout() {
  const session = useSessionModel();
  // As on the web's Train page: a live workout never lets the screen lock mid-set.
  const segments = useSegments() as string[];
  const onTrain = segments[0] === '(tabs)' ? segments[1] === 'train' : WORKOUT_SHEETS.has(segments[0] ?? '');
  useKeepAwakeWhile(Boolean(session) && onTrain);
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
  // As in the web app's shell: WHOOP catches up when the app comes back, and
  // Apple Health weights flow in once turned on in You.
  const userId = useAuthStore((state) => state.user?.id);
  useWhoopForegroundSync(userId);
  // The released app turns Health sync back on once if the Capacitor app had it on.
  const healthReady = useHealthCarryOver(userId);
  useNativeHealthSync(healthReady ? userId : undefined);
  // The tabs unmount only on sign-out: leave nothing of this account behind.
  // (The rest, its notification and the lock-screen card are cleared by the
  // shared sign-out guard in useRestLifecycle.)
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
      labelStyle={{ selected: { color: dynamicInk } }}
      // On every tab. iOS only shrinks pages that scroll well past the screen
      // and sticks on pages just past that, so tab pages use TabScroll.
      minimizeBehavior="onScrollDown"
      // iOS's tab bar has no tap feedback of its own; the web app's tabs did.
      screenListeners={{ tabPress: () => haptics.tap() }}>
      {session ? (
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
