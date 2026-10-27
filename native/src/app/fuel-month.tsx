import { addMonths, endOfMonth, format, isAfter, isSameDay, isSameMonth, startOfDay, startOfMonth } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { buildCalendarDays } from '@/lib/nutritionCalendar';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { dayKey, useFuelStore } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Jump to a day: a Sunday-first month with a dot on days that have food. */
export default function FuelMonthSheet() {
  const c = useBlanc();
  const selected = new Date(`${useFuelStore.getState().selected}T12:00:00`);
  const [month, setMonth] = useState(() => startOfMonth(selected));
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const today = startOfDay(new Date());
  const days = buildCalendarDays(month);

  // The dots: the loaded month's entries when it is this month, else a light read of dates.
  useEffect(() => {
    let current = true;
    const store = useFuelStore.getState();
    const key = format(month, 'yyyy-MM');
    if (store.loadedMonth === key) {
      setLogged(new Set(store.logs.map((log) => log.date)));
      return;
    }
    setLogged(new Set());
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

  const step = (months: number) => {
    haptics.select();
    setMonth((value) => addMonths(value, months));
  };
  const canGoForward = !isAfter(startOfMonth(addMonths(month, 1)), today);

  return (
    <View style={{ backgroundColor: c.ground, paddingBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="chevron.left" accessibilityLabel="Previous month" onPress={() => step(-1)} />
        <BlancText variant="headline" accessibilityRole="header">
          {format(month, 'MMMM yyyy')}
        </BlancText>
        <View style={{ opacity: canGoForward ? 1 : 0.3 }} pointerEvents={canGoForward ? 'auto' : 'none'}>
          <GlassButton symbol="chevron.right" accessibilityLabel="Next month" onPress={() => step(1)} />
        </View>
      </View>

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
          return (
            <View key={key} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 }}>
              {inMonth ? (
                <Pressable
                  disabled={future}
                  accessibilityRole="button"
                  accessibilityLabel={`${format(day, 'EEEE, MMMM d')}${logged.has(key) ? ', has entries' : ''}`}
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
                    weight={isSameDay(day, today) || isSelected ? '600' : '400'}
                    tone={isSelected ? 'onCapsule' : 'ink'}
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
  );
}
