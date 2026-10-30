import { format, startOfWeek } from 'date-fns';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Tally } from '~/components/Tally';
import { useFinishedStore } from '~/lib/finished';
import { formatLoad, formatWhole } from '~/lib/format';
import { space, useBlanc } from '~/theme/blanc';

/** Sessions completed this Monday–Sunday training week. */
function useWeekCount(): number | null {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    void supabase
      .from('workouts')
      .select('id')
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('date', weekStart)
      .then(({ data, error }) => {
        if (!error) setCount(data?.length ?? 0);
      });
  }, [userId]);
  return count;
}

export default function SessionDone() {
  const c = useBlanc();
  const summary = useFinishedStore((state) => state.summary);
  const planned = useAppStore((state) => state.activeSplit?.days_per_week ?? null);
  const weekCount = useWeekCount();

  const insets = useSafeAreaInsets();

  // One close: a quick second tap must not dismiss what is underneath.
  const closed = useRef(false);
  const done = () => {
    if (closed.current) return;
    closed.current = true;
    router.dismiss();
    router.navigate('/today');
  };

  if (!summary) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.gutter }}>
        <Capsule title="Back to Today" onPress={done} />
      </View>
    );
  }

  const slots = Math.max(planned ?? 0, weekCount ?? 0);
  const rows: [string, string][] = [
    ['Sets', String(summary.sets)],
    // Only when some set beat the same set last time: no zero.
    ...(summary.beat > 0 ? [['Beat last time', `${summary.beat} ${summary.beat === 1 ? 'set' : 'sets'}`] as [string, string]] : []),
    // A bodyweight session moves no load: leave the zero out.
    ...(summary.volume > 0 ? [['Volume', `${formatWhole(summary.volume)} lb`] as [string, string]] : []),
    ['Time', `${summary.minutes} min`],
    ...(summary.best
      ? [['Best set', summary.best.weight > 0 ? `${formatLoad(summary.best.weight)} × ${summary.best.reps}` : `${summary.best.reps} reps`] as [string, string]]
      : []),
  ];

  return (
    <>
      <ScrollView
        style={{ backgroundColor: c.ground }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 16, paddingHorizontal: space.gutter }}>
        <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center' }}>
          Session complete
        </BlancText>

        <Label bleed style={{ alignSelf: 'center', width: '88%', marginTop: 34, paddingHorizontal: 26, paddingTop: 28, paddingBottom: 26, boxShadow: `0 18px 40px rgba(0, 0, 0, 0.07), 0 0 0 0.5px ${c.labelEdge}` }}>
          <Tally
            marks={summary.marks}
            current={null}
            height={22}
            accessibilityLabel={`${summary.sets} of ${summary.marks.length} sets logged`}
          />

          <BlancText variant="title" size={30} style={{ marginTop: 22, lineHeight: 36 }}>
            {summary.dayName}
          </BlancText>
          <BlancText variant="meta" size={13} tone="graphite" style={{ marginTop: 4 }}>
            {format(summary.finishedAt, 'EEE · MMM d · h:mm a')}
          </BlancText>

          <View style={{ height: 0.5, backgroundColor: c.hairline, marginTop: 20 }} />
          <View style={{ paddingVertical: 10 }}>
            {rows.map(([label, value]) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 }}>
                <BlancText variant="meta" size={14} tone="graphite">
                  {label}
                </BlancText>
                <BlancText variant="meta" size={14}>
                  {value}
                </BlancText>
              </View>
            ))}
            {summary.best ? (
              <BlancText variant="meta" size={12} tone="graphite" numberOfLines={1} style={{ textAlign: 'right', marginTop: -2 }}>
                {summary.best.name}
              </BlancText>
            ) : null}
          </View>
          <View style={{ height: 0.5, backgroundColor: c.hairline }} />
          <BlancText variant="footnote" tone="graphite" style={{ marginTop: 14 }}>
            {weekCount !== null && slots > 0
              ? `Saved to History · session ${weekCount}${planned ? ` of ${planned}` : ''} this week`
              : 'Saved to History'}
          </BlancText>
        </Label>

        <View style={{ flex: 1, minHeight: 32 }} />
        <Capsule title="Done" size="large" fill onPress={done} />
      </ScrollView>
    </>
  );
}
