import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { pickInsight, summarizeWeekVolume } from '@/lib/todayModel';
import { overTargetWord, warnsOverTarget } from '@/lib/fuelSummary';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { BrandMark, HEADER_MARK_SIZE, headerMarkSlot } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { PlanCard } from '~/components/PlanCard';
import { Tally } from '~/components/Tally';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { useAccountRefresh } from '~/lib/accountData';
import { useIntroRise } from '~/lib/brand';
import { useFinishWorkout } from '~/lib/finishWorkout';
import { formatLoad, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { today, useFuelStore } from '~/lib/fuel';
import { useNow, useSessionModel, type SessionModel } from '~/lib/session';
import { useTodayPlan } from '~/lib/today';
import { space, useBlanc } from '~/theme/blanc';

export default function TodayScreen() {
  const now = useNow(30_000);
  const session = useSessionModel();
  const plan = useTodayPlan();
  const target = useAppStore((state) => state.macroTarget);
  const weekly = useAppStore((state) => state.weeklyVolume);
  const totals = useFuelStore((state) => state.todayTotals);
  const week = summarizeWeekVolume(weekly);
  const insight = pickInsight(weekly);
  const kcalLeft = target ? target.calories - totals.calories : null;
  // Bulking, calories past target read as extra, never red.
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const over = overTargetWord(goal);
  const rise = useIntroRise();
  const { refreshing, refresh } = useAccountRefresh();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Today',
          // The mark the launch intro lands on.
          unstable_headerLeftItems: () => [
            {
              type: 'custom',
              element: <BrandMark size={HEADER_MARK_SIZE} anchor style={headerMarkSlot} />,
              hidesSharedBackground: true,
            },
          ],
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
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Animated.View style={rise}>
          <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
            {format(now, 'EEEE, MMMM d')}
          </BlancText>

          {session ? <SessionLabel session={session} now={now} /> : <PlanCard hero={plan.hero} next={plan.next} place="today" />}

          <Section title="Fuel" action={{ title: 'Log food', onPress: () => router.push({ pathname: '/log-food', params: { day: today() } }) }}>
            {target && kcalLeft !== null ? (
              // The day's figures open Fuel, where they come from.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${formatWhole(Math.abs(kcalLeft))} kcal ${kcalLeft >= 0 ? 'left' : over}. Eaten ${formatWhole(totals.calories)} of ${formatWhole(target.calories)}, protein ${formatWhole(totals.protein)} of ${formatWhole(target.protein)} grams`}
                accessibilityHint="Opens Fuel"
                onPress={() => {
                  haptics.tap();
                  router.navigate('/fuel');
                }}
                style={({ pressed }) => ({ paddingHorizontal: space.gutter, opacity: pressed ? 0.55 : 1 })}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <BlancText variant="figure" size={68} style={{ letterSpacing: -1.5 }}>
                    {formatWhole(Math.abs(kcalLeft))}
                  </BlancText>
                  <BlancText variant="secondary" tone="graphite">
                    {kcalLeft >= 0 ? 'kcal left' : `kcal ${over}`}
                  </BlancText>
                </View>
                <View style={{ flexDirection: 'row', gap: 20, marginTop: 14 }}>
                  <Meter label="Eaten" value={formatWhole(totals.calories)} of={formatWhole(target.calories)} progress={totals.calories / target.calories} warnOver={warnsOverTarget('calories', goal)} />
                  <Meter label="Protein" value={formatWhole(totals.protein)} of={`${formatWhole(target.protein)} g`} progress={totals.protein / target.protein} warnOver={warnsOverTarget('protein', goal)} />
                </View>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens your targets"
                onPress={() => {
                  haptics.tap();
                  router.push('/you/targets');
                }}
                style={({ pressed }) => ({ marginHorizontal: space.gutter, opacity: pressed ? 0.55 : 1 })}>
                <BlancText variant="secondary" tone="graphite">
                  Set a calorie target in You to see what's left today.
                </BlancText>
              </Pressable>
            )}
          </Section>

          <Section title="This week" action={{ title: 'Progress', onPress: () => router.push('/today/progress') }}>
            <Label>
              <Row
                title="Sessions"
                value={
                  plan.weekDone === null
                    ? undefined
                    : plan.weekTarget
                      ? `${plan.weekDone} of ${plan.weekTarget}`
                      : String(plan.weekDone)
                }
              />
              {week.trained > 0 ? (
                <>
                  <Hairline />
                  <Row
                    title={`${week.inRange} of ${week.trained} muscles in range`}
                    detail={insight ? `${insight.muscle} ${insight.flag}` : muscleCounts(week.under, week.over)}
                    chevron
                    onPress={() => router.push('/today/progress')}
                  />
                </>
              ) : null}
            </Label>
          </Section>
        </Animated.View>
      </TabScroll>
    </>
  );
}

function SessionLabel({ session, now }: { session: SessionModel; now: number }) {
  const c = useBlanc();
  const minutes = Math.max(0, Math.round((now - session.startedAt.getTime()) / 60_000));
  const current = session.current;
  const { finish, closing } = useFinishWorkout(session);
  const openWorkout = () => router.navigate('/train');

  return (
    // The whole card returns to the workout; its button resumes or finishes.
    <Label style={{ marginTop: 18, overflow: 'hidden' }}>
    <Pressable
      // VoiceOver reads the card's parts and reaches its button on its own.
      accessible={false}
      accessibilityRole="button"
      accessibilityLabel={`${session.dayName}, in progress, ${minutes} min, ${session.doneCount} of ${session.sets.length} sets done`}
      accessibilityHint="Opens the workout"
      onPress={() => {
        haptics.tap();
        openWorkout();
      }}
      style={({ pressed }) => ({ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
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
            {current ? setLine(current.setNumber, current.movement.sets.length, current.set.weight, current.set.reps) : 'Finish to save the session'}
          </BlancText>
        </View>
        {current ? (
          <Capsule title="Resume" onPress={openWorkout} />
        ) : (
          // Every set is logged: Finish finishes here, as it does on Train.
          <Capsule title="Finish" busy={closing} onPress={finish} />
        )}
      </View>
    </Pressable>
    </Label>
  );
}

function Meter({ label, value, of, progress, warnOver }: { label: string; value: string; of: string; progress: number; warnOver: boolean }) {
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
        <Track progress={progress} warnOver={warnOver} />
      </View>
    </View>
  );
}

/** "Set 2 of 3", with the load only once it is known. */
function setLine(setNumber: number, sets: number, weight: number | null, reps: number | null): string {
  const base = `Set ${setNumber} of ${sets}`;
  return weight !== null && reps !== null ? `${base} · ${formatLoad(weight)} lb × ${reps}` : base;
}

/** "2 under · 1 over", leaving out zeros. */
function muscleCounts(under: number, over: number): string | undefined {
  return [under ? `${under} under` : null, over ? `${over} over` : null].filter(Boolean).join(' · ') || undefined;
}
