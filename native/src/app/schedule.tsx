import { DatePicker, Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { datePickerStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { addDays, format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { buildFixedWeekdays, buildPlanSchedule, orderTrainingWeekdays, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { Split, SplitDay } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { ChoiceRow, FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { announce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { useScheduleRevision, useTodayPlan } from '~/lib/today';
import { space, useBlanc } from '~/theme/blanc';

type StartChoice = 'today' | 'tomorrow' | 'pick';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The days in the order every week in the app is drawn (Monday first, as the training week runs); values stay JavaScript's 0 = Sunday. */
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const ymd = (date: Date) => format(date, 'yyyy-MM-dd');
/** Day 1 for the choice, by the clock as this runs. */
const startDateFor = (choice: StartChoice, picked: Date) =>
  choice === 'today' ? ymd(new Date()) : choice === 'tomorrow' ? ymd(addDays(new Date(), 1)) : ymd(picked);

/**
 * When Day 1 is and how sessions follow: on the weekdays picked, the same each
 * week (the others are rest days), or each session after the last whatever the day. Saved on this device at once,
 * then to the account.
 */
export default function ScheduleSheet() {
  const split = useAppStore((state) => state.activeSplit);
  const plan = useTodayPlan();
  if (!split) return null;
  // A plan shown from the phone's copy (launchCache) never picks what Save
  // writes: the session up next stays unknown, so Save waits for the reads.
  return <ScheduleEditor split={split} saved={plan.schedule} upNext={plan.seeded ? undefined : plan.upNext} />;
}

function ScheduleEditor({ split, saved, upNext }: { split: Split; saved: PlanSchedule | null; upNext: SplitDay | null | undefined }) {
  const c = useBlanc();
  const large = useLargeText();
  const userId = useAuthStore((state) => state.user?.id);
  const bump = useScheduleRevision((state) => state.bump);
  const dayCount = split.days.length;

  // An existing schedule opens as saved; a new one starts today on the
  // usual days for the program's length (Mon, Wed, Fri for three).
  const [choice, setChoice] = useState<StartChoice>(saved ? 'pick' : 'today');
  const [picked, setPicked] = useState(() => (saved ? parseISO(`${saved.startDate}T00:00:00`) : new Date()));
  const [mode, setMode] = useState<PlanMode>(saved?.mode ?? 'fixed');
  const savedWeekdays = saved?.mode === 'fixed' && saved.weekdays.length > 0 ? saved.weekdays : null;
  // Monday-first, as the circles are drawn; the saved first day keeps the program's first day.
  const [weekdays, setWeekdays] = useState(
    () => orderTrainingWeekdays(savedWeekdays ?? buildFixedWeekdays(1, split.days_per_week)),
  );
  // In order: the session up next is checked (the saved day can be behind the
  // sessions done since), the saved day when there is no plan to go by.
  const savedFlexIndex = saved?.flexAnchorIndex ?? saved?.anchorDay ?? 0;
  const upNextIndex = upNext ? split.days.findIndex((day) => day.id === upNext.id) : -1;
  const defaultFlexIndex =
    upNextIndex >= 0 ? upNextIndex : dayCount > 0 ? ((savedFlexIndex % dayCount) + dayCount) % dayCount : 0;
  const [pickedFlexIndex, setFlexDayIndex] = useState<number | null>(null);
  const flexDayIndex = pickedFlexIndex ?? defaultFlexIndex;
  // Until the plan loads, nothing is checked and Save waits.
  const flexWaiting = mode === 'flex' && pickedFlexIndex === null && upNext === undefined;

  const startDate = startDateFor(choice, picked);
  const noTrainingDays = mode === 'fixed' && weekdays.length === 0;

  // Closing with changes asks first; Save closes once, after the guard steps aside.
  const [opened] = useState(() => ({ choice, startDate, mode, weekdays: weekdays.join() }));
  const changed =
    choice !== opened.choice ||
    startDate !== opened.startDate ||
    mode !== opened.mode ||
    (mode === 'fixed' && weekdays.join() !== opened.weekdays) ||
    flexDayIndex !== defaultFlexIndex;
  const [done, setDone] = useState(false);
  useLeaveGuard(changed && !done, { title: 'Discard schedule changes?' });
  useEffect(() => {
    if (done) router.back();
  }, [done]);

  const save = () => {
    if (!userId || done || flexWaiting || noTrainingDays) return;
    // Read again here: the one above is kept with the choice, so a sheet left
    // open past midnight would start the plan on yesterday.
    savePlanSchedule(userId, buildPlanSchedule(split, {
      startDate: startDateFor(choice, picked), mode, weekdays, firstWeekday: savedWeekdays?.[0], flexDayIndex,
    }));
    bump();
    haptics.success();
    announce('Schedule saved');
    setDone(true);
  };

  const select = <T,>(setter: (value: T) => void) => (value: T) => {
    haptics.select();
    setter(value);
  };

  /** A tap turns a day into a training day or back into a rest day. */
  const toggle = (weekday: number) => {
    haptics.select();
    setWeekdays((current) => orderTrainingWeekdays(
      current.includes(weekday) ? current.filter((day) => day !== weekday) : [...current, weekday],
    ));
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Schedule
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
            {split.name}
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Section title="Day 1" style={{ marginTop: 18 }}>
        <Host matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset }}>
          <Picker selection={choice} onSelectionChange={select(setChoice)} modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('today')]}>Today</SwiftText>
            <SwiftText modifiers={[tag('tomorrow')]}>Tomorrow</SwiftText>
            <SwiftText modifiers={[tag('pick')]}>Pick a date</SwiftText>
          </Picker>
        </Host>
        {choice === 'pick' ? (
          <Label style={{ marginTop: 10, paddingHorizontal: 18, paddingVertical: 10 }}>
            <Host matchContents={{ vertical: true }}>
              <DatePicker
                title="Starts"
                selection={picked}
                displayedComponents={['date']}
                onDateChange={select(setPicked)}
                modifiers={[datePickerStyle('compact')]}
              />
            </Host>
          </Label>
        ) : null}
      </Section>

      <Section title="Sessions follow">
        <Host matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset }}>
          <Picker selection={mode} onSelectionChange={select(setMode)} modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('fixed')]}>Set weekdays</SwiftText>
            <SwiftText modifiers={[tag('flex')]}>In order</SwiftText>
          </Picker>
        </Host>

        {mode === 'fixed' ? (
          <>
            {/* The week, Monday first: training days in ink, rest days bare. A tap switches one day. */}
            <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: space.inset, marginTop: 14 }}>
              {MONDAY_FIRST.map((weekday) => {
                const training = weekdays.includes(weekday);
                return (
                  <Pressable
                    key={WEEKDAYS[weekday]}
                    accessibilityRole="button"
                    accessibilityLabel={`${WEEKDAY_NAMES[weekday]}, ${training ? 'training day' : 'rest day'}`}
                    accessibilityHint={training ? 'Makes it a rest day' : 'Makes it a training day'}
                    accessibilityState={{ selected: training }}
                    onPress={() => toggle(weekday)}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: training ? c.capsule : pressed ? c.pressed : 'transparent',
                      opacity: training && pressed ? 0.8 : 1,
                    })}>
                    {/* Seven 44-point circles share the width; the letter grows no further than they hold. */}
                    <BlancText variant="secondary" weight="600" tone={training ? 'onCapsule' : 'graphite'} maxFontSizeMultiplier={2}>
                      {LETTERS[weekday]}
                    </BlancText>
                  </Pressable>
                );
              })}
            </View>
            <FormNote>{weekdaysNote(weekdays.length, dayCount)}</FormNote>
          </>
        ) : (
          <>
            <Label style={{ marginTop: 14 }}>
              {split.days.map((day, index) => (
                <View key={day.id}>
                  {index > 0 ? <Hairline /> : null}
                  {/* Until the plan loads, nothing is checked. */}
                  <ChoiceRow title={day.day_name} checked={index === flexDayIndex && !flexWaiting} onPress={() => setFlexDayIndex(index)} />
                </View>
              ))}
            </Label>
            <FormNote>The checked day is up next. Each session follows the last, whatever the day.</FormNote>
          </>
        )}
      </Section>

      <Capsule title="Save" size="large" fill disabled={flexWaiting || noTrainingDays} onPress={save} style={{ marginHorizontal: space.inset, marginTop: space.section }} />
    </ScrollView>
  );
}

/** Under the week: what a tap does, and how the program's days fit the days picked. */
function weekdaysNote(trainingDays: number, programDays: number): string {
  if (trainingDays === 0) return 'Pick at least one training day to save.';
  const tap = 'Tap a day to make it a training or rest day.';
  if (programDays === 0 || trainingDays === programDays) return `${tap} Program days follow in order, the same each week.`;
  const sessions = `${trainingDays} ${trainingDays === 1 ? 'session' : 'sessions'}`;
  return `${tap} ${programDays} program days at ${sessions} a week: each week picks up where the last left off.`;
}
