import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { pickInsight, summarizeWeekVolume } from '@/lib/todayModel';
import { overTargetWord, warnsOverTarget } from '@/lib/fuelSummary';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleVolume } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { BrandMark, HEADER_MARK_SIZE, headerMarkSlot } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { PlanCard } from '~/components/PlanCard';
import { RollingText } from '~/components/RollingText';
import { Tally } from '~/components/Tally';
import { Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { scrolledFromRest, TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { speak, useLargeText } from '~/lib/accessibility';
import { useAccountRefresh } from '~/lib/accountData';
import { markAtRest, useIntroRise } from '~/lib/brand';
import { useFinishWorkout } from '~/lib/finishWorkout';
import { formatMinutes, formatSet, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { today, todayTotalsShown, useFuelStore } from '~/lib/fuel';
import { figureLayout } from '~/lib/motion';
import { useNow, useSessionModel, type SessionModel } from '~/lib/session';
import { useTodayPlan } from '~/lib/today';
import { figureLead, restingFigure, space, useBlanc } from '~/theme/blanc';

export default function TodayScreen() {
  const now = useNow(30_000);
  const session = useSessionModel();
  const plan = useTodayPlan();
  const target = useAppStore((state) => state.macroTarget);
  // Until the saved target is read, no target is not yet "set one in You".
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const targetRead = useAppStore((state) => userId !== null && state.macroTargetLoadedForUserId === userId);
  const weekly = useAppStore((state) => state.weeklyVolume);
  // Yesterday's totals never show as today's after a failed new-day read.
  const totals = useFuelStore(todayTotalsShown);
  const week = summarizeWeekVolume(weekly);
  const insight = pickInsight(weekly);
  const kcalLeft = target ? target.calories - totals.calories : null;
  // Bulking, calories past target read as extra, never red.
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const over = overTargetWord(goal);
  const rise = useIntroRise();
  const { refreshing, refresh } = useAccountRefresh();
  const large = useLargeText();

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
        }}
      />
      <TabScroll
        onScroll={(event) => {
          // Scrolled past the large title, the corner P steps back with it.
          const scrolled = scrolledFromRest(event.nativeEvent.contentOffset.y);
          markAtRest.value = Math.max(0, Math.min(1, 1 - (scrolled - 8) / 36));
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Animated.View style={rise}>
          <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
            {format(now, 'EEEE, MMMM d')}
          </BlancText>

          {session ? <SessionLabel session={session} now={now} /> : <PlanCard hero={plan.hero} next={plan.next} place="today" seeded={plan.seeded} />}

          <Section title="Fuel" action={{ title: 'Log food', symbol: 'plus', onPress: () => router.push({ pathname: '/log-food', params: { day: today() } }) }}>
            {target && kcalLeft !== null ? (
              // The day's figures open Fuel, where they come from.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={speak(
                  `${formatWhole(totals.calories)} / ${formatWhole(target.calories)} kcal eaten, ${formatWhole(Math.abs(kcalLeft))} kcal ${kcalLeft >= 0 ? 'left' : over}. Protein ${formatWhole(totals.protein)} / ${formatWhole(target.protein)} g`,
                )}
                accessibilityHint="Opens Fuel"
                onPress={() => {
                  haptics.tap();
                  router.navigate('/fuel');
                }}
                style={({ pressed }) => ({ paddingHorizontal: space.gutter, opacity: pressed ? 0.55 : 1 })}>
                {/* At the accessibility text sizes the figure stops growing and the words wrap below it. */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                  <RollingText variant="figure" size={56} style={{ ...restingFigure, letterSpacing: -1.25, marginLeft: figureLead(formatWhole(totals.calories), 56, { tabular: false }) }}>
                    {formatWhole(totals.calories)}
                  </RollingText>
                  <Animated.View layout={figureLayout}>
                    <BlancText variant="secondary" tone="graphite">
                      of {formatWhole(target.calories)} kcal
                    </BlancText>
                  </Animated.View>
                </View>
                {/* The day's food as Fuel shows it: the figure eaten, the line filling toward the target. */}
                <View style={{ marginTop: 10 }}>
                  <Track progress={totals.calories / target.calories} warnOver={warnsOverTarget('calories', goal)} />
                </View>
                <View style={{ marginTop: 18 }}>
                  <Meter label="Protein" value={formatWhole(totals.protein)} of={`${formatWhole(target.protein)} g`} progress={totals.protein / target.protein} warnOver={warnsOverTarget('protein', goal)} />
                </View>
              </Pressable>
            ) : !targetRead ? (
              // Holds the figures' place (68 pt figure and the meters) until the target is read.
              <View style={{ height: 140 }} />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Opens your targets"
                // One line of text: the slop makes it 44 points tall, short of the sections around it.
                hitSlop={{ top: 2, bottom: 22 }}
                onPress={() => {
                  haptics.tap();
                  router.push('/you/targets');
                }}
                style={({ pressed }) => ({ marginHorizontal: space.gutter, opacity: pressed ? 0.55 : 1 })}>
                <BlancText variant="secondary" tone="graphite">
                  Set a calorie target
                </BlancText>
              </Pressable>
            )}
          </Section>

          {/* The muscles row opens Progress; before a set is logged this week, the header does. */}
          {/* The week's sessions ride on the heading; the card holds the one row that leads somewhere. */}
          <Section
            title="This week"
            note={plan.weekDone === null ? undefined : plan.weekTarget ? `${plan.weekDone} of ${plan.weekTarget} sessions` : `${plan.weekDone} ${plan.weekDone === 1 ? 'session' : 'sessions'}`}
            action={week.trained > 0 ? undefined : { title: 'Progress', onPress: () => router.push('/today/progress') }}>
            {week.trained > 0 ? (
              <Label>
                <Row
                  title={`${week.inRange} of ${week.trained} trained muscles in range`}
                  // Every exception the week has, by name: what Progress opens on.
                  detail={weekExceptions(weekly) ?? (insight ? `${insight.muscle}: ${insight.flag}` : muscleCounts(week.under, week.over))}
                  chevron
                  onPress={() => router.push('/today/progress')}
                />
              </Label>
            ) : null}
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
  // A flexible session starts empty: nothing to finish yet, as on Train,
  // which asks for its first movement.
  const empty = session.movements.length === 0;
  const { finish, closing } = useFinishWorkout(session);
  const openWorkout = () => router.navigate('/train');
  const large = useLargeText();
  const title = current ? current.movement.name : empty ? 'No movements yet' : session.sets.length > 0 ? 'All sets logged' : 'Nothing left to log';
  const line = current
    ? setLine(current.setNumber, current.movement.sets.length, current.set.weight, current.set.reps)
    : empty
      ? 'Add your first movement in Train'
      : 'Finish to save the session';

  return (
    // The whole card returns to the workout; its button resumes or finishes.
    <Label style={{ marginTop: 18, overflow: 'hidden' }}>
    <Pressable
      // VoiceOver reads the card's parts and reaches its button on its own.
      accessible={false}
      accessibilityRole="button"
      onPress={() => {
        haptics.tap();
        openWorkout();
      }}
      style={({ pressed }) => ({ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      <View
        accessible
        accessibilityLabel={speak(`${session.dayName} · In progress · ${formatMinutes(minutes)}`)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, ...(large ? { flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 } : null) }}>
        {/* A long day name gives way; the live state always shows. At the
            accessibility text sizes the name wraps and the live state moves under it. */}
        <BlancText variant="headline" numberOfLines={large ? undefined : 1} style={large ? undefined : { flex: 1, minWidth: 0 }}>
          {session.dayName}
        </BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
          {/* The live dot says in progress; the words would repeat it. */}
          <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {formatMinutes(minutes)}
          </BlancText>
        </View>
      </View>

      {empty ? null : (
        <Tally
          marks={session.sets.map((set) => set.completed)}
          current={current?.index ?? null}
          height={16}
          style={{ marginTop: 14 }}
          accessibilityLabel={`${session.doneCount} of ${session.sets.length} sets done`}
        />
      )}

      {/* At the accessibility text sizes the button moves under the words. */}
      <View style={large ? { gap: 12, marginTop: 16 } : { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <View accessible accessibilityLabel={speak(`${title} · ${line}`)} style={large ? undefined : { flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={large ? undefined : 1}>
            {title}
          </BlancText>
          <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
            {line}
          </BlancText>
        </View>
        {current || empty ? (
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
  // At the accessibility text sizes the meters stack (see the caller) and the value wraps under its label.
  const large = useLargeText();
  return (
    <View style={large ? undefined : { flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', ...(large ? { flexWrap: 'wrap', columnGap: 8 } : null) }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', ...(large ? { flexWrap: 'wrap' } : null) }}>
          <RollingText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'], textAlign: 'right' }}>
            {value}
          </RollingText>
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {` / ${of}`}
          </BlancText>
        </View>
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
  const load = formatSet(weight, reps);
  return load ? `${base} · ${load}` : base;
}

/** "2 under · 1 over", leaving out zeros. */
function muscleCounts(under: number, over: number): string | undefined {
  return [under ? `${under} under` : null, over ? `${over} over` : null].filter(Boolean).join(' · ') || undefined;
}

/** "Hamstrings below · Side delts over": the trained muscles outside their range this week, by name. */
function weekExceptions(weekly: MuscleVolume[] | null | undefined): string | undefined {
  const trained = (weekly ?? []).filter((volume) => volume.weekly_sets > 0);
  const name = (volume: MuscleVolume) => MUSCLE_GROUP_LABELS[volume.muscle_group] ?? volume.muscle_group;
  const below = trained.filter((volume) => volume.status === 'below_mev').map(name);
  const over = trained.filter((volume) => volume.status === 'above_mrv').map(name);
  const parts = [below.length ? `${below.join(', ')} below` : null, over.length ? `${over.join(', ')} over` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}
