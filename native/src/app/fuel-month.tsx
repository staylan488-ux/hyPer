import { addMonths, endOfMonth, format, isAfter, isSameDay, isSameMonth, startOfDay, startOfMonth } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { buildCalendarDays } from '@/lib/nutritionCalendar';
import { logMacro } from '@/lib/nutritionMacros';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { DayMark } from '~/fuel/DayMark';
import { formatWhole } from '~/lib/format';
import { dayKey, useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The loaded month's days with food, when `month` is the month Fuel has loaded. */
function loadedMonthDays(month: Date): Set<string> | null {
  const store = useFuelStore.getState();
  return store.loadedMonth === format(month, 'yyyy-MM') ? new Set(store.logs.map((log) => log.date)) : null;
}

/** The loaded month's kcal by day, for the marks, when `month` is the month Fuel has loaded. */
function loadedMonthKcal(month: Date): Map<string, number> | null {
  const store = useFuelStore.getState();
  if (store.loadedMonth !== format(month, 'yyyy-MM')) return null;
  const byDay = new Map<string, number>();
  for (const log of store.logs) byDay.set(log.date, (byDay.get(log.date) ?? 0) + (logMacro(log, 'calories') ?? 0));
  return byDay;
}

/** Keeps the dots already shown when they are the same days, so the sheet doesn't draw again for nothing. */
const sameDays = (next: Set<string>) => (shown: Set<string>) =>
  shown.size === next.size && [...next].every((key) => shown.has(key)) ? shown : next;

/** Keeps the marks already shown when every day's kcal is the same. */
const sameKcal = (next: Map<string, number> | null) => (shown: Map<string, number> | null) =>
  shown && next && shown.size === next.size && [...next].every(([key, kcal]) => shown.get(key) === kcal) ? shown : next;

/**
 * Jump to a day: a Sunday-first month with a mark on days that have food (the
 * week strip's: how far toward the target in the month Fuel holds, a dot in
 * another month, whose dates alone are read).
 */
export default function FuelMonthSheet() {
  const c = useBlanc();
  // Read once as the sheet opens: picking a day closes it.
  const [selected] = useState(() => new Date(`${useFuelStore.getState().selected}T12:00:00`));
  const [month, setMonth] = useState(() => startOfMonth(selected));
  // The loaded month's dots and marks are there from the first frame.
  const [logged, setLogged] = useState<Set<string>>(() => loadedMonthDays(month) ?? new Set());
  const [dayKcal, setDayKcal] = useState<Map<string, number> | null>(() => loadedMonthKcal(month));
  const target = useAppStore((state) => state.macroTarget);
  const kcalTarget = target && target.calories > 0 ? target.calories : null;
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const today = startOfDay(new Date());
  const days = buildCalendarDays(month);

  // The dots: the loaded month's entries when it is this month, else a light read of dates.
  useEffect(() => {
    let current = true;
    const loadedDays = loadedMonthDays(month);
    if (loadedDays) {
      setLogged(sameDays(loadedDays));
      setDayKcal(sameKcal(loadedMonthKcal(month)));
      return;
    }
    setLogged(sameDays(new Set()));
    setDayKcal(null);
    void (async () => {
      const userId = await getSessionUserId();
      if (!userId) return;
      const { data } = await supabase
        .from('nutrition_logs')
        .select('date')
        .eq('user_id', userId)
        .gte('date', dayKey(startOfMonth(month)))
        .lte('date', dayKey(endOfMonth(month)));
      if (current && data) setLogged(new Set((data as { date: string }[]).map((row) => row.date)));
    })();
    return () => {
      current = false;
    };
  }, [month]);

  const canGoForward = !isAfter(startOfMonth(addMonths(month, 1)), today);
  // The chevrons tap on their own; a swipe ticks as the month changes.
  const step = (months: number) => setMonth((value) => addMonths(value, months));
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

  return (
    <View style={{ backgroundColor: c.ground, paddingBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="chevron.left" accessibilityLabel="Previous month" onPress={() => step(-1)} />
        <BlancText variant="headline" accessibilityRole="header">
          {format(month, 'MMMM yyyy')}
        </BlancText>
        <GlassButton symbol="chevron.right" accessibilityLabel="Next month" disabled={!canGoForward} onPress={() => step(1)} />
      </View>

      <GestureDetector gesture={swipe}>
        <View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, marginTop: 18 }}>
            {WEEKDAYS.map((label, index) => (
              <BlancText key={index} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
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
              const kcal = dayKcal?.get(key);
              return (
                <View key={key} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 }}>
                  {inMonth ? (
                    <Pressable
                      disabled={future}
                      accessibilityRole="button"
                      accessibilityLabel={`${format(day, 'EEEE, MMMM d')}${kcal !== undefined ? `, ${formatWhole(kcal)} kcal` : logged.has(key) ? ', has entries' : ''}`}
                      accessibilityState={{ selected: isSelected, disabled: future }}
                      onPress={() => {
                        haptics.select();
                        useFuelStore.getState().select(key);
                        router.back();
                      }}
                      style={({ pressed }) => ({
                        width: 44,
                        height: 48,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        opacity: future ? 0.3 : pressed ? 0.5 : 1,
                      })}>
                      {/* the week strip's day: a 36-point circle, its mark below */}
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: isSelected ? c.capsule : 'transparent',
                        }}>
                        <BlancText
                          variant="body"
                          weight={isSameDay(day, today) || isSelected ? '600' : '400'}
                          tone={isSelected ? 'onCapsule' : 'ink'}
                          style={{ fontVariant: ['tabular-nums'] }}>
                          {format(day, 'd')}
                        </BlancText>
                      </View>
                      <DayMark logged={logged.has(key)} kcal={kcal} target={kcalTarget} goal={goal} />
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
    </View>
  );
}
