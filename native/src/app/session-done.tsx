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
import { speak, useLargeText } from '~/lib/accessibility';
import { savedLine, useFinishedStore } from '~/lib/finished';
import { formatMinutes, formatSet, formatWhole } from '~/lib/format';
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
  const large = useLargeText();
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

  // Label, value, and what VoiceOver says for the value when it differs.
  const rows: [string, string, string?][] = [
    // "3 of 9" only when some sets were not logged; no row for a session without sets.
    ...(summary.marks.length > 0
      ? [['Sets', summary.sets === summary.marks.length ? String(summary.sets) : `${summary.sets} of ${summary.marks.length}`] as [string, string]]
      : []),
    // Only when some set beat the same set last time: no zero.
    ...(summary.beat > 0 ? [['Beat last time', `${summary.beat} ${summary.beat === 1 ? 'set' : 'sets'}`] as [string, string]] : []),
    // A bodyweight session moves no load: leave the zero out.
    ...(summary.volume > 0 ? [['Volume', `${formatWhole(summary.volume)} lb`] as [string, string]] : []),
    ['Time', formatMinutes(summary.minutes)],
    ...(summary.best
      ? [
          [
            'Best set',
            formatSet(summary.best.weight, summary.best.reps),
            // With the movement's name from the line under the rows.
            `${formatSet(summary.best.weight, summary.best.reps)}, ${summary.best.name}`,
          ] as [string, string, string],
        ]
      : []),
  ];

  return (
    <>
      <ScrollView
        style={{ backgroundColor: c.ground }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}>
        {/* The title and its label sit centred in the room above Done. */}
        <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 32 }}>
          <BlancText variant="secondary" tone="graphite" accessibilityRole="header" style={{ textAlign: 'center' }}>
            Session complete
          </BlancText>

          {/* At the cards' inset, so its edges line up with Done; a faint lift over the label's own edge. */}
          <Label style={{ marginTop: 34, paddingHorizontal: 26, paddingTop: 28, paddingBottom: 26, boxShadow: `0 0 0 0.5px ${c.labelEdge}, 0 1px 2px rgba(0, 0, 0, 0.03), 0 8px 24px rgba(0, 0, 0, 0.05)` }}>
            {/* A session without sets has no tally, as on Today. */}
            {summary.marks.length > 0 ? (
              <Tally
                marks={summary.marks}
                current={null}
                height={22}
                drawIn
                accessibilityLabel={`${summary.sets} of ${summary.marks.length} sets logged`}
              />
            ) : null}

            <BlancText variant="title" size={30} accessibilityRole="header" style={{ marginTop: summary.marks.length > 0 ? 22 : 0, lineHeight: 36 }}>
              {summary.dayName}
            </BlancText>
            <BlancText
              variant="meta"
              size={13}
              tone="graphite"
              accessibilityLabel={format(summary.startedAt, 'EEEE, MMMM d, h:mm a')}
              style={{ marginTop: 4 }}>
              {format(summary.startedAt, 'EEE · MMM d · h:mm a')}
            </BlancText>

            <View style={{ height: 0.5, backgroundColor: c.hairline, marginTop: 20 }} />
            <View style={{ paddingVertical: 10 }}>
              {rows.map(([label, value, spoken]) => (
                // One fact for VoiceOver: "Volume, 12,400 pounds".
                <View
                  key={label}
                  accessible
                  accessibilityLabel={speak(`${label}, ${spoken ?? value}`)}
                  // At the accessibility text sizes the value moves under its label when both don't fit.
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, ...(large ? { flexWrap: 'wrap', columnGap: 12 } : { gap: 12 }) }}>
                  <BlancText variant="meta" size={14} tone="graphite">
                    {label}
                  </BlancText>
                  <BlancText variant="meta" size={14}>
                    {value}
                  </BlancText>
                </View>
              ))}
              {summary.best ? (
                // Read with the Best set row above.
                <BlancText
                  variant="meta"
                  size={12}
                  tone="graphite"
                  numberOfLines={large ? undefined : 1}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={{ textAlign: 'right', marginTop: -2 }}>
                  {summary.best.name}
                </BlancText>
              ) : null}
            </View>
            <View style={{ height: 0.5, backgroundColor: c.hairline }} />
            <BlancText variant="footnote" tone="graphite" style={{ marginTop: 14 }}>
              {savedLine(weekCount, planned)}
            </BlancText>
          </Label>
        </View>

        <View style={{ marginHorizontal: space.inset }}>
          <Capsule title="Done" size="large" fill onPress={done} />
        </View>
      </ScrollView>
    </>
  );
}
