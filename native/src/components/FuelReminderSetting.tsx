import { useMemo } from 'react';
import { Linking } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { setFuelReminderEnabled, setFuelReminderTime, useFuelReminderStore } from '~/lib/fuelReminder';
import { fuelReminderNote, hasReminderTarget, minutesOf, REMINDER_EARLIEST, REMINDER_LATEST, reminderTimeDate } from '~/lib/fuelReminderPlan';
import { blockExit, rowEnter, rowLayout } from '~/lib/motion';
import { space } from '~/theme/blanc';

import { Capsule } from './Capsule';
import { FormNote, PickerRow, ToggleRow } from './Form';
import { Label } from './Label';
import { Hairline } from './Row';

const REMINDER_RANGE = { min: reminderTimeDate(REMINDER_EARLIEST), max: reminderTimeDate(REMINDER_LATEST) };

/**
 * You's fuel reminder: a switch and an evening time, kept on this phone. It
 * moves with the cards around it (`rowLayout`), and the note clips while it
 * grows, so the cards below never cover Open Settings on their way down.
 */
export function FuelReminderSetting() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const ready = useFuelReminderStore((state) => state.userId !== null && state.userId === userId);
  const settings = useFuelReminderStore((state) => state.settings);
  const denied = useFuelReminderStore((state) => state.permission === 'denied');
  const goal = useAppStore((state) => state.nutritionProfile?.goal ?? null);
  // Only once targets have loaded, so the note doesn't flash at launch.
  const noTarget = useAppStore((state) => Boolean(userId) && state.macroTargetLoadedForUserId === userId && !hasReminderTarget(state.macroTarget));
  const time = useMemo(() => reminderTimeDate(settings.minutes), [settings.minutes]);
  return (
    // It belongs with the food settings just above it: closer to them than the groups between areas.
    <Animated.View layout={rowLayout} style={{ marginTop: 20 }}>
      <Label layout={rowLayout} style={{ overflow: 'hidden' }}>
        {/* Among You's list rows: a list switch, as Adaptive scheduling's. */}
        <ToggleRow list label="Fuel reminder" value={settings.enabled} disabled={!ready} onChange={setFuelReminderEnabled} />
        {settings.enabled ? (
          <Animated.View entering={rowEnter} exiting={blockExit}>
            <Hairline />
            <PickerRow
              label="Time"
              mode="time"
              value={time}
              min={REMINDER_RANGE.min}
              max={REMINDER_RANGE.max}
              onChange={(next) => setFuelReminderTime(minutesOf(next))}
            />
          </Animated.View>
        ) : null}
      </Label>
      <Animated.View layout={rowLayout} style={{ overflow: 'hidden' }}>
        {settings.enabled && denied ? (
          <>
            <FormNote alert>Notifications are off for hyPer. Allow them in Settings to get this reminder.</FormNote>
            <Capsule
              title="Open Settings"
              variant="quiet"
              onPress={() => void Linking.openSettings()}
              // on the note's text edge (FormNote's margin)
              style={{ alignSelf: 'flex-start', marginLeft: space.inset + 18, marginTop: 12 }}
            />
          </>
        ) : (
          <FormNote>{fuelReminderNote(goal, !noTarget)}</FormNote>
        )}
      </Animated.View>
    </Animated.View>
  );
}
