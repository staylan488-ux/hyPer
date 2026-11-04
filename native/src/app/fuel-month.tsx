import { addMonths, endOfMonth, format, isAfter, isSameDay, isSameMonth, startOfDay, startOfMonth } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { buildCalendarDays } from '@/lib/nutritionCalendar';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { announce, useAnnounce, useLargeText } from '~/lib/accessibility';
import { dayKey, useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The days of `month` with food logged: null when they could not be read,
 * undefined when signed out. (Kept out of the sheet so the React Compiler,
 * which skips a component with a try, still compiles it.)
 */
async function readLoggedDays(month: Date): Promise<Set<string> | null | undefined> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return undefined;
    const { data, error } = await supabase
      .from('nutrition_logs')
      .select('date')
      .eq('user_id', userId)
      .gte('date', dayKey(startOfMonth(month)))
      .lte('date', dayKey(endOfMonth(month)));
    if (error || !data) return null;
    return new Set((data as { date: string }[]).map((row) => row.date));
  } catch {
    return null;
  }
}

/**
 * The month is a fixed grid of 44-point cells, seven across: its text stops
 * growing at about iOS's largest standard size, as Calendar's does; the
 * month's name above carries the large text.
 */
const CELL_TEXT_MAX = 1.3;

/** The loaded month's days with food, when `month` is the month Fuel has loaded. */
function loadedMonthDays(month: Date): Set<string> | null {
  const store = useFuelStore.getState();
  return store.loadedMonth === format(month, 'yyyy-MM') ? new Set(store.logs.map((log) => log.date)) : null;
}

/** Keeps the dots already shown when they are the same days, so the sheet doesn't draw again for nothing. */
const sameDays = (next: Set<string>) => (shown: Set<string>) =>
  shown.size === next.size && [...next].every((key) => shown.has(key)) ? shown : next;

/** Jump to a day: a Sunday-first month with a dot on days that have food. */
export default function FuelMonthSheet() {
  const c = useBlanc();
  const large = useLargeText();
  // Read once as the sheet opens: picking a day closes it.
  const [selected] = useState(() => new Date(`${useFuelStore.getState().selected}T12:00:00`));
  const [month, setMonth] = useState(() => startOfMonth(selected));
  // The loaded month's dots are there from the first frame.
  const [logged, setLogged] = useState<Set<string>>(() => loadedMonthDays(month) ?? new Set());
  // A month whose dates could not be read says so, rather than looking empty.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The failure arrives after the sheet does.
  useAnnounce(failed && 'Couldn’t load this month.');
  const today = startOfDay(new Date());
  const days = buildCalendarDays(month);

  // The dots: the loaded month's entries when it is this month, else a light read of dates.
  useEffect(() => {
    let current = true;
    setFailed(false);
    const loadedDays = loadedMonthDays(month);
    if (loadedDays) {
      setLogged(sameDays(loadedDays));
      return;
    }
    setLogged(sameDays(new Set()));
    void readLoggedDays(month).then((read) => {
      if (!current || read === undefined) return;
      if (read) setLogged(read);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [month, attempt]);

  const canGoForward = !isAfter(startOfMonth(addMonths(month, 1)), today);
  // The chevrons tap on their own; a swipe ticks as the month changes.
  // VoiceOver stays on the chevron, so it hears the new month's name.
  const step = (months: number) => {
    setMonth((value) => addMonths(value, months));
    announce(format(addMonths(month, months), 'MMMM yyyy'));
  };
  const swipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -50 && canGoForward) {
        haptics.select();
        step(1);
      } else if (event.translationX > 50) {
        haptics.select();
        step(-1);
      }
    });

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, ...(large ? { gap: 8 } : null) }}>
        <GlassButton symbol="chevron.left" accessibilityLabel="Previous month" onPress={() => step(-1)} />
        <BlancText variant="headline" accessibilityRole="header" style={large ? { flexShrink: 1, textAlign: 'center' } : undefined}>
          {format(month, 'MMMM yyyy')}
        </BlancText>
        <GlassButton symbol="chevron.right" accessibilityLabel="Next month" disabled={!canGoForward} onPress={() => step(1)} />
      </View>

      <GestureDetector gesture={swipe}>
        <View>
          {/* Each day's own name says its weekday. */}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', paddingHorizontal: 12, marginTop: 18 }}>
            {WEEKDAYS.map((label, index) => (
              <BlancText key={index} variant="footnote" tone="graphite" maxFontSizeMultiplier={CELL_TEXT_MAX} style={{ flex: 1, textAlign: 'center' }}>
                {label}
              </BlancText>
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, marginTop: 6 }}>
            {days.map((day) => {
              const key = dayKey(day);
              const inMonth = isSameMonth(day, month);
              const future = isAfter(startOfDay(day), today);
              const isSelected = isSameDay(day, selected);
              const isToday = isSameDay(day, today);
              return (
                <View key={key} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 }}>
                  {inMonth ? (
                    <Pressable
                      disabled={future}
                      accessibilityRole="button"
                      accessibilityLabel={`${isToday ? 'Today, ' : ''}${format(day, 'EEEE, MMMM d')}${logged.has(key) ? ', food logged' : ''}`}
                      accessibilityState={{ selected: isSelected, disabled: future }}
                      onPress={() => {
                        haptics.select();
                        useFuelStore.getState().select(key);
                        router.back();
                      }}
                      style={({ pressed }) => ({
                        width: 44,
                        height: 48,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        opacity: future ? 0.3 : pressed ? 0.5 : 1,
                        backgroundColor: isSelected ? c.capsule : 'transparent',
                      })}>
                      <BlancText
                        variant="body"
                        weight={isToday || isSelected ? '600' : '400'}
                        tone={isSelected ? 'onCapsule' : 'ink'}
                        maxFontSizeMultiplier={CELL_TEXT_MAX}
                        style={{ fontVariant: ['tabular-nums'] }}>
                        {format(day, 'd')}
                      </BlancText>
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: logged.has(key) ? (isSelected ? c.onCapsule : c.graphite) : 'transparent' }} />
                    </Pressable>
                  ) : (
                    <View style={{ height: 48 }} />
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </GestureDetector>

      {failed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            haptics.tap();
            setAttempt((value) => value + 1);
          }}
          style={({ pressed }) => ({ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, marginTop: 8, opacity: pressed ? 0.5 : 1 })}>
          <BlancText variant="footnote" tone="live">
            Couldn’t load this month. Tap to try again.
          </BlancText>
        </Pressable>
      ) : null}
    </>
  );

  // The sheet fits its content; at the accessibility sizes it scrolls if the content outgrows the screen.
  return large ? (
    <ScrollView style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 28 }}>
      {content}
    </ScrollView>
  ) : (
    <View style={{ backgroundColor: c.ground, paddingBottom: 28 }}>{content}</View>
  );
}
