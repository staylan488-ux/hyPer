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

/**
 * Where a tab page's large title sits below the safe area: under iOS 26's
 * 54 pt collapsed bar (TabScroll's 106 pt bar less its 52 pt large-title
 * row), the title's 41 pt line 3 pt into that row.
 */
const TITLE_TOP = 57;

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

  // A partial session is never called complete: it says how much was logged. Every set logged reads as complete,
  // as does a session without sets; a skipped movement's unlogged sets already leave the marks.
  const complete = summary.sets === summary.marks.length;
  const outcome = complete ? 'Session complete' : `${summary.sets} of ${summary.marks.length} sets`;
  const day = format(summary.startedAt, 'EEEE, MMMM d');
  const time = format(summary.startedAt, 'h:mm a');

  // Label, value, and what VoiceOver says for the value when it differs. The tally and the line under the title
  // already give the sets, and the beats lead the card, so neither takes a row.
  const rows: [string, string, string?][] = [
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
  const tally = summary.marks.length > 0;
  // Only when some set beat the same set last time: no zero.
  const beats = summary.beat > 0 ? `${summary.beat} ${summary.beat === 1 ? 'set' : 'sets'} beat last time` : null;

  return (
    <>
      <ScrollView
        style={{ backgroundColor: c.ground }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + TITLE_TOP, paddingBottom: insets.bottom + 16 }}>
        {/* Top-anchored like every other screen; Done keeps the foot. */}
        <View style={{ flex: 1, paddingBottom: 32 }}>
          {/* The outcome is the first thing VoiceOver reads: the day, then how it ended and when. */}
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${summary.dayName}. ${outcome}, ${day}, ${time}`}
            style={{ paddingHorizontal: space.gutter }}>
            {/* A large title, at a tab page's title position and growing as one does. */}
            <BlancText variant="title" size={34} dynamicTypeRamp="largeTitle" style={{ lineHeight: 41 }}>
              {summary.dayName}
            </BlancText>
            {/* The one quiet line, in system type as every other screen writes a date; Menlo stays under Train's figures. */}
            <BlancText variant="secondary" tone="graphite" style={{ marginTop: 2 }}>
              {`${outcome} · ${day} · ${time}`}
            </BlancText>
          </View>

          {/* At the cards' inset, so its edges line up with Done; a faint lift over the label's own edge. */}
          <Label style={{ marginTop: 22, paddingHorizontal: 26, paddingTop: tally || beats ? 28 : 10, paddingBottom: 26, boxShadow: `0 0 0 0.5px ${c.labelEdge}, 0 1px 2px rgba(0, 0, 0, 0.03), 0 8px 24px rgba(0, 0, 0, 0.05)` }}>
            {/* A session without sets has no tally, as on Today. */}
            {tally ? (
              <Tally
                marks={summary.marks}
                current={null}
                height={22}
                drawIn
                accessibilityLabel={`${summary.sets} of ${summary.marks.length} sets logged`}
              />
            ) : null}
            {/* The reward leads the facts, in ink. */}
            {beats ? (
              <BlancText variant="body" style={{ marginTop: tally ? 20 : 0 }}>
                {beats}
              </BlancText>
            ) : null}

            {tally || beats ? <View style={{ height: 0.5, backgroundColor: c.hairline, marginTop: 20 }} /> : null}
            <View style={{ paddingVertical: 10 }}>
              {rows.map(([label, value, spoken]) => (
                // One fact for VoiceOver: "Volume, 12,400 pounds".
                <View
                  key={label}
                  accessible
                  accessibilityLabel={speak(`${label}, ${spoken ?? value}`)}
                  // At the accessibility text sizes the value moves under its label when both don't fit.
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, ...(large ? { flexWrap: 'wrap', columnGap: 12 } : { gap: 12 }) }}>
                  <BlancText variant="secondary" tone="graphite">
                    {label}
                  </BlancText>
                  <BlancText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'] }}>
                    {value}
                  </BlancText>
                </View>
              ))}
              {summary.best ? (
                // Read with the Best set row above.
                <BlancText
                  variant="footnote"
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
