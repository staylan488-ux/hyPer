import { DatePicker, Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { datePickerStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { addDays, format, parseISO } from 'date-fns';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { buildFixedWeekdays, buildPlanSchedule, defaultWeekdays, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { Split } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { haptics } from '~/lib/haptics';
import { useScheduleRevision, useTodayPlan } from '~/lib/today';
import { space, useBlanc } from '~/theme/blanc';

type StartChoice = 'today' | 'tomorrow' | 'pick';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ymd = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * When Day 1 is and how sessions follow: the same weekdays each week, or each
 * session after the last whatever the day. The web's schedule editor, saved
 * the same way (on this device at once, then to the account).
 */
export default function ScheduleSheet() {
  const split = useAppStore((state) => state.activeSplit);
  const plan = useTodayPlan();
  if (!split) return null;
  return <ScheduleEditor split={split} saved={plan.schedule} todayDayId={plan.hero.kind === 'planned' ? plan.hero.day.id : null} />;
}

function ScheduleEditor({ split, saved, todayDayId }: { split: Split; saved: PlanSchedule | null; todayDayId: string | null }) {
  const c = useBlanc();
  const userId = useAuthStore((state) => state.user?.id);
  const bump = useScheduleRevision((state) => state.bump);
  const dayCount = split.days.length;

  // An existing schedule opens as saved (as the web's Edit schedule does);
  // a new one starts today with a fixed weekly rhythm from Monday.
  const [choice, setChoice] = useState<StartChoice>(saved ? 'pick' : 'today');
  const [picked, setPicked] = useState(() => (saved ? parseISO(`${saved.startDate}T00:00:00`) : new Date()));
  const [mode, setMode] = useState<PlanMode>(saved?.mode ?? 'fixed');
  const [anchorDay, setAnchorDay] = useState(
    () => saved?.anchorDay ?? saved?.weekdays?.[0] ?? defaultWeekdays(split.days_per_week)[0] ?? 1,
  );
  const [flexDayIndex, setFlexDayIndex] = useState(() => {
    const today = split.days.findIndex((day) => day.id === todayDayId);
    if (today >= 0) return today;
    const fallback = saved?.flexAnchorIndex ?? saved?.anchorDay ?? 0;
    return dayCount > 0 ? ((fallback % dayCount) + dayCount) % dayCount : 0;
  });

  const startDate = choice === 'today' ? ymd(new Date()) : choice === 'tomorrow' ? ymd(addDays(new Date(), 1)) : ymd(picked);
  const rhythm = buildFixedWeekdays(anchorDay, split.days_per_week).map((day) => WEEKDAYS[day]).join(' / ');

  const save = () => {
    if (!userId) return;
    savePlanSchedule(userId, buildPlanSchedule(split, { startDate, mode, anchorDay, flexDayIndex }));
    bump();
    haptics.success();
    router.back();
  };

  const select = <T,>(setter: (value: T) => void) => (value: T) => {
    haptics.select();
    setter(value);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Schedule
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
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
                onDateChange={setPicked}
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
            <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: space.inset, marginTop: 14 }}>
              {LETTERS.map((letter, weekday) => {
                const selected = anchorDay === weekday;
                return (
                  <Pressable
                    key={WEEKDAYS[weekday]}
                    accessibilityRole="button"
                    accessibilityLabel={`First training day ${WEEKDAYS[weekday]}`}
                    accessibilityState={{ selected }}
                    onPress={() => select(setAnchorDay)(weekday)}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? c.capsule : pressed ? c.pressed : c.label,
                    })}>
                    <BlancText variant="secondary" weight="600" tone={selected ? 'onCapsule' : 'ink'}>
                      {letter}
                    </BlancText>
                  </Pressable>
                );
              })}
            </View>
            <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 10 }}>
              {rhythm}
            </BlancText>
          </>
        ) : (
          <>
            <Label style={{ marginTop: 14 }}>
              {split.days.map((day, index) => (
                <View key={day.id}>
                  {index > 0 ? <Hairline /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: index === flexDayIndex }}
                    onPress={() => select(setFlexDayIndex)(index)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: 52,
                      paddingLeft: 18,
                      paddingRight: 16,
                      backgroundColor: pressed ? c.pressed : 'transparent',
                    })}>
                    <BlancText variant="body" style={{ flex: 1 }}>
                      {day.day_name}
                    </BlancText>
                    {index === flexDayIndex ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={c.ink} /> : null}
                  </Pressable>
                </View>
              ))}
            </Label>
            <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 10 }}>
              The checked day is up next. Each session follows the last, whatever the day.
            </BlancText>
          </>
        )}
      </Section>

      <Capsule title="Save" size="large" fill onPress={save} style={{ marginHorizontal: space.inset, marginTop: space.section }} />
    </ScrollView>
  );
}
