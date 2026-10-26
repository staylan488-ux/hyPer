import { NativeTabs } from 'expo-router/native-tabs';

import { WorkoutAccessory } from '~/components/WorkoutAccessory';
import { haptics } from '~/lib/haptics';
import { useRestFinish } from '~/lib/rest';
import { useSessionModel } from '~/lib/session';
import { dynamicInk } from '~/theme/blanc';

export default function TabsLayout() {
  const session = useSessionModel();
  useRestFinish();

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
