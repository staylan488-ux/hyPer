import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { summarizeWeekVolume } from '@/lib/todayModel';
import { overTargetWord, warnsOverTarget } from '@/lib/fuelSummary';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { BlancText } from '~/components/BlancText';
import { BrandMark, HEADER_MARK_SIZE, headerMarkSlot } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { DragList } from '~/components/DragList';
import { Label } from '~/components/Label';
import { LiveClock } from '~/components/LiveClock';
import { PlanCard, SessionCard } from '~/components/PlanCard';
import { RollingText } from '~/components/RollingText';
import { Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { closeOpenSwipeRow } from '~/components/SwipeRow';
import { scrolledFromRest, TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { WeekCheckInRow } from '~/components/WeekCheckInRow';
import { speak, useLargeText } from '~/lib/accessibility';
import { useAccountRefresh, useCurrentDayKey, useWorkoutsRevision } from '~/lib/accountData';
import { markAtRest, useIntroRise } from '~/lib/brand';
import { useFinishWorkout } from '~/lib/finishWorkout';
import { formatSet, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { today, todayTotalsShown, useFuelStore } from '~/lib/fuel';
import { figureLayout } from '~/lib/motion';
import { useNow, usePreviousHistory, useSessionModel, type SessionModel } from '~/lib/session';
import { sessionTargets, setTargetFor } from '~/lib/setTargets';
import { useTodayPlan } from '~/lib/today';
import { moveTodaySection, useTodayOrder, type TodaySection } from '~/lib/todayOrder';
import { figureLead, restingFigure, space, useBlanc } from '~/theme/blanc';
import { openTrain } from '~/lib/openTrain';
import { loadWeekCheckIn, useWeekCheckIn } from '~/lib/weekCheckIn';
import { isCheckInToday } from '~/lib/weekCheckInDay';

/**
 * The Fuel block's height at the standard text size, held while the saved
 * target is read: 2 above the 56 pt figure's 60 pt line, 8 and the 3 pt
 * line, 16 and the protein meter (a 20 pt line, 8 and its 3 pt line), 16 below.
 */
const FUEL_BLOCK_HEIGHT = 136;

/** A group inside the list, which sets the space between groups itself. */
const FLUSH = { marginTop: 0 };

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
  const kcalLeft = target ? target.calories - totals.calories : null;
  // Bulking, calories past target read as extra, never red.
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const over = overTargetWord(goal);
  const rise = useIntroRise();
  // Mondays look back at the week before; past midnight into Monday it reads then.
  const todayKey = useCurrentDayKey();
  const monday = isCheckInToday(todayKey);
  const workoutsRevision = useWorkoutsRevision((state) => state.revision);
  const lastWeek = useWeekCheckIn(todayKey);
  useEffect(() => {
    if (monday && userId) void loadWeekCheckIn(todayKey);
  }, [monday, todayKey, userId, workoutsRevision]);
  const { refreshing, refresh } = useAccountRefresh();
  const large = useLargeText();
  const c = useBlanc();
  // The groups in the order the person arranged them: hold one and drag it.
  const order = useTodayOrder(userId);
  const [dragging, setDragging] = useState(false);
  // VoiceOver moves a group from its heading, as a drag does by sight.
  const moves = (key: TodaySection) => {
    const at = order.indexOf(key);
    return [
      ...(at > 0 ? [{ label: 'Move up', run: () => moveTodaySection(userId, key, at - 1) }] : []),
      ...(at < order.length - 1 ? [{ label: 'Move down', run: () => moveTodaySection(userId, key, at + 1) }] : []),
    ];
  };

  // Today opens again at rest (after a sign-out and back in): its corner P with it.
  useEffect(
    () => () => {
      markAtRest.value = 1;
    },
    [],
  );

  // Each group's heading sits close over its content; the list sets the groups apart.
  const groups: Record<TodaySection, ReactNode> = {
    training: session ? <SessionLabel session={session} /> : <PlanCard hero={plan.hero} next={plan.next} place="today" seeded={plan.seeded} top={0} />,
    fuel: (
      <>
      {/* The day's food under its heading; the block opens Fuel, its chevron says so. */}
      <Section page title="Fuel" style={FLUSH} actions={moves('fuel')} action={{ title: 'Log food', symbol: 'plus', onPress: () => router.push({ pathname: '/log-food', params: { day: today() } }) }}>
        {target && kcalLeft !== null ? (
          <Label style={{ overflow: 'hidden' }}>
            {/* The day's figures open Fuel, where they come from. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speak(
                `${formatWhole(totals.calories)} / ${formatWhole(target.calories)} kcal eaten, ${formatWhole(Math.abs(kcalLeft))} kcal ${kcalLeft >= 0 ? 'left' : over}. Protein ${formatWhole(totals.protein)} / ${formatWhole(target.protein)} g`,
              )}
              accessibilityHint="Opens Fuel"
              onPress={() => {
                // The touch that lifted the group is not a tap on it.
                if (closeOpenSwipeRow()) return;
                haptics.tap();
                router.navigate('/fuel');
              }}
              // Text on the gutter; the right edge is the gutter too, as a row's chevron and a rule's end.
              // The figure's line box carries its own room above the digits, so the top is small.
              style={({ pressed }) => ({ paddingLeft: space.labelPad, paddingRight: space.gutter, paddingTop: 2, paddingBottom: 16, backgroundColor: pressed ? c.pressed : 'transparent' })}>
              {/* The chevron on the figure's line, as You's weight has it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {/* At the accessibility text sizes the figure stops growing and the words wrap below it. */}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                  <RollingText variant="figure" size={56} style={{ ...restingFigure, letterSpacing: -1.25, marginLeft: figureLead(formatWhole(totals.calories), 56, { tabular: false }) }}>
                    {formatWhole(totals.calories)}
                  </RollingText>
                  <Animated.View layout={figureLayout}>
                    <BlancText variant="secondary" tone="graphite">
                      of {formatWhole(target.calories)} kcal
                    </BlancText>
                  </Animated.View>
                </View>
                <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} />
              </View>
              {/* The day's food as Fuel shows it: the figure eaten, the line filling toward the target. */}
              <View style={{ marginTop: 8 }}>
                <Track progress={totals.calories / target.calories} warnOver={warnsOverTarget('calories', goal)} />
              </View>
              <View style={{ marginTop: 16 }}>
                <Meter label="Protein" value={formatWhole(totals.protein)} of={`${formatWhole(target.protein)} g`} progress={totals.protein / target.protein} warnOver={warnsOverTarget('protein', goal)} />
              </View>
            </Pressable>
          </Label>
        ) : !targetRead ? (
          // Holds the block's place (the 56 pt figure, its line and the protein meter) until the target is read.
          <Label style={{ height: FUEL_BLOCK_HEIGHT }} />
        ) : (
          // No target yet: one row that asks for one. Row plays the tap's haptic itself.
          <Label>
            <Row title="Set a calorie target" chevron onPress={() => router.push('/you/targets')} />
          </Label>
        )}
      </Section>
      </>
    ),
    progress: (
      <>
      {/* Named for the screen it opens. Its rows read as You's do: a name, one quiet figure, a chevron. */}
      <Section page title="Progress" style={FLUSH} actions={moves('progress')}>
        <Label>
          {/* The week so far in one figure; the muscles outside their range are what Progress opens on. */}
          <Row title="This week" value={weekFigure(plan.weekDone, plan.weekTarget, week)} chevron onPress={() => router.push('/today/progress')} />
          {monday && lastWeek.checkIn && !lastWeek.hidden ? <WeekCheckInRow checkIn={lastWeek.checkIn} todayKey={todayKey} /> : null}
        </Label>
      </Section>
      </>
    ),
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Today',
          // The mark the launch intro lands on.
          unstable_headerLeftItems: () => [
            {
              type: 'custom',
              element: <BrandMark size={HEADER_MARK_SIZE} anchor fadesWithScroll style={headerMarkSlot} />,
              hidesSharedBackground: true,
            },
          ],
        }}
      />
      <TabScroll
        // A lifted group has the touch: the page holds still under it.
        scrollEnabled={!dragging}
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

          {/* Hold a group and glass cards come in behind them all; drag it into place, and the cards fade once it is set down. */}
          <View style={{ marginTop: 18 }}>
            <DragList
              cards
              gap={space.group}
              items={order.map((key) => ({ key, node: groups[key] }))}
              enabled
              onMove={(key, index) => moveTodaySection(userId, key as TodaySection, index)}
              onDragging={setDragging}
            />
          </View>
        </Animated.View>
      </TabScroll>
    </>
  );
}

function SessionLabel({ session }: { session: SessionModel }) {
  const current = session.current;
  // A flexible session starts empty: nothing to finish yet, as on Train,
  // which asks for its first movement.
  const empty = session.movements.length === 0;
  const { finish, closing } = useFinishWorkout(session);
  const openWorkout = openTrain;
  const title = current ? current.movement.name : empty ? 'No movements yet' : session.sets.length > 0 ? 'All sets logged' : 'Nothing left to log';
  // The set's target, as Train fills it in, while the set holds no numbers of its own.
  const history = usePreviousHistory(session.workoutId);
  const target = current && current.set.weight === null && current.set.reps === null
    ? setTargetFor(current.set, current.movement.sets, sessionTargets(session, history))
    : null;
  const line = current
    ? target
      ? `Set ${current.setNumber} of ${current.movement.sets.length} · target ${formatSet(target.weight, target.reps)}`
      : setLine(current.setNumber, current.movement.sets.length, current.set.weight, current.set.reps)
    : empty
      ? 'Add your first movement in Train'
      : 'Finish to save the session';

  return (
    // The finished day's record (PlanCard) keeps this skeleton, so finishing changes words, not layout.
    // The whole card returns to the workout; its button resumes or finishes.
    <SessionCard
      top={0}
      day={session.dayName}
      daySpoken={`${session.dayName} · In progress`}
      // The workout's clock, as Train and the workout bar keep it.
      aside={<LiveClock startedAt={session.startedAt} />}
      tally={empty ? null : { marks: session.sets.map((set) => set.completed), current: current?.index ?? null, label: `${session.doneCount} of ${session.sets.length} sets done` }}
      title={title}
      line={line}
      action={
        current || empty ? (
          <Capsule title="Resume" tone="effort" onPress={openWorkout} />
        ) : (
          // Every set is logged: Finish finishes here, as it does on Train.
          <Capsule title="Finish" tone="effort" busy={closing} onPress={finish} />
        )
      }
      onPress={openWorkout}
    />
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
          {/* A figure reads in regular weight: bold is for headings. */}
          <RollingText variant="secondary" style={{ fontVariant: ['tabular-nums'], textAlign: 'right' }}>
            {value}
          </RollingText>
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {` of ${of}`}
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

/** "3 of 4 sessions", "2 sessions" without a weekly target; before any session, the trained muscles in range, or nothing yet. */
function weekFigure(done: number | null, target: number | null | undefined, week: { inRange: number; trained: number }): string | undefined {
  if (done !== null && target) return `${done} of ${target} sessions`;
  if (done) return `${done} ${done === 1 ? 'session' : 'sessions'}`;
  return week.trained > 0 ? `${week.inRange} of ${week.trained} muscles in range` : undefined;
}
