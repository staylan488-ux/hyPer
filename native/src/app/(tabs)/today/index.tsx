import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { pickInsight, summarizeWeekVolume } from '@/components/dashboard/todayModel';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Tally } from '~/components/Tally';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { formatLoad, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { today, useFuelStore } from '~/lib/fuel';
import { useNow, useSessionModel, type SessionModel } from '~/lib/session';
import { space, useBlanc } from '~/theme/blanc';

export default function TodayScreen() {
  const now = useNow(30_000);
  const session = useSessionModel();
  const target = useAppStore((state) => state.macroTarget);
  const weekly = useAppStore((state) => state.weeklyVolume);
  const totals = useFuelStore((state) => state.totals);
  const loadFuel = useFuelStore((state) => state.load);

  useEffect(() => {
    void loadFuel(today());
  }, [loadFuel]);
  const week = summarizeWeekVolume(weekly);
  const insight = pickInsight(weekly);
  const kcalLeft = target ? target.calories - totals.calories : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Today',
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'You',
              accessibilityLabel: 'Your profile',
              icon: { type: 'sfSymbol', name: 'person.crop.circle' },
              onPress: () => {
                haptics.tap();
                router.navigate('/you');
              },
            },
          ],
        }}
      />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {format(now, 'EEEE, MMMM d')}
        </BlancText>

        {session ? <SessionLabel session={session} now={now} /> : null}

        <Section title="Fuel" action={{ title: 'Log food', onPress: () => router.push('/log-food') }}>
          {target && kcalLeft !== null ? (
            <View style={{ paddingHorizontal: space.gutter }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <BlancText variant="figure" size={68} style={{ letterSpacing: -1.5 }}>
                  {formatWhole(Math.abs(kcalLeft))}
                </BlancText>
                <BlancText variant="secondary" tone="graphite">
                  {kcalLeft >= 0 ? 'kcal left' : 'kcal over'}
                </BlancText>
              </View>
              <View style={{ flexDirection: 'row', gap: 20, marginTop: 14 }}>
                <Meter label="Eaten" value={formatWhole(totals.calories)} of={formatWhole(target.calories)} progress={totals.calories / target.calories} />
                <Meter label="Protein" value={formatWhole(totals.protein)} of={`${formatWhole(target.protein)} g`} progress={totals.protein / target.protein} />
              </View>
            </View>
          ) : (
            <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter }}>
              Set a calorie target in You to see what's left today.
            </BlancText>
          )}
        </Section>

        {week.trained > 0 ? (
          <Section title="This week">
            <Label>
              <Row
                title={`${week.inRange} of ${week.trained} muscles in range`}
                detail={`${week.under} under · ${week.over} over`}
              />
              {insight ? (
                <>
                  <Hairline />
                  <Row title={insight.muscle} detail={sentence(insight.flag)} />
                </>
              ) : null}
            </Label>
          </Section>
        ) : null}
      </TabScroll>
    </>
  );
}

function SessionLabel({ session, now }: { session: SessionModel; now: number }) {
  const c = useBlanc();
  const minutes = Math.max(0, Math.round((now - session.startedAt.getTime()) / 60_000));
  const current = session.current;

  return (
    <Label style={{ marginTop: 18, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BlancText variant="headline">{session.dayName}</BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
          <BlancText variant="footnote" tone="graphite">
            In progress · {minutes} min
          </BlancText>
        </View>
      </View>

      <Tally
        marks={session.sets.map((set) => set.completed)}
        current={current?.index ?? null}
        height={16}
        style={{ marginTop: 14 }}
        accessibilityLabel={`${session.doneCount} of ${session.sets.length} sets done`}
      />

      <View style={{ height: 0.5, backgroundColor: c.hairline, marginTop: 14 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={1}>
            {current ? current.movement.name : 'All sets done'}
          </BlancText>
          <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
            {current
              ? `Set ${current.setNumber} of ${current.movement.sets.length} · ${formatLoad(current.set.weight)} lb × ${current.set.reps ?? '–'}`
              : 'Finish to save the session'}
          </BlancText>
        </View>
        <Capsule title={current ? 'Resume' : 'Finish'} onPress={() => router.navigate('/train')} />
      </View>
    </Label>
  );
}

function Meter({ label, value, of, progress }: { label: string; value: string; of: string; progress: number }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {value}
          </BlancText>{' '}
          / {of}
        </BlancText>
      </View>
      <View style={{ marginTop: 8 }}>
        <Track progress={progress} />
      </View>
    </View>
  );
}

const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
