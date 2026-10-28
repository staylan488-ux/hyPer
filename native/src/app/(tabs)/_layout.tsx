import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect } from 'react';

import { useNativeHealthSync } from '@/hooks/useNativeHealthSync';
import { useWhoopForegroundSync } from '@/hooks/useWhoopForegroundSync';
import { useAuthStore } from '@/stores/authStore';

import { WorkoutAccessory } from '~/components/WorkoutAccessory';
import { useAccountData } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { resetHistory } from '~/lib/history';
import { useNotesStore } from '~/lib/notes';
import { useRestFinish, useRestLifecycle, useRestPreferences } from '~/lib/rest';
import { useFocusStore, usePreviousNotesStore, useSessionModel } from '~/lib/session';
import { useWorkoutActivity } from '~/lib/workoutActivity';
import { resetYou } from '~/lib/you';
import { dynamicInk } from '~/theme/blanc';

export default function TabsLayout() {
  const session = useSessionModel();
  useRestLifecycle();
  useRestFinish();
  useRestPreferences();
  useWorkoutActivity(session);
  useAccountData();
  // As in the web app's shell: WHOOP catches up when the app comes back, and
  // Apple Health weights flow in once turned on in You.
  const userId = useAuthStore((state) => state.user?.id);
  useWhoopForegroundSync(userId);
  useNativeHealthSync(userId);
  // The tabs unmount only on sign-out: leave nothing of this account behind.
  // (The rest, its notification and the lock-screen card are cleared by the
  // shared sign-out guard in useRestLifecycle.)
  useEffect(
    () => () => {
      useFocusStore.getState().focus(null);
      useNotesStore.setState({ workoutId: null, drafts: {}, base: null, status: {} });
      resetHistory();
      resetYou();
      usePreviousNotesStore.setState({ workoutId: null, notes: {} });
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
