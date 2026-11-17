import { format } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { create } from 'zustand';

import { onAppVisible } from '@/lib/appVisibility';
import { fuelTargets } from '@/lib/fuelSummary';
import type { GapPick, GapPlan } from '@/lib/gapPicks';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { servingLabel } from '@/lib/nutritionLedger';
import { sumMacros, type MacroTotals } from '@/lib/nutritionMacros';
import { createPendingEntryId, type PendingEntryId } from '@/lib/pendingEntryId';
import { recentFoodKey } from '@/lib/recentFoods';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { GlassButton } from '~/components/GlassButton';
import type { MenuAction } from '~/components/HoldMenu';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { SwipeRow } from '~/components/SwipeRow';
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { gapEveningStart, gapFigure, gapLogAllTitle, gapPickAmount, gapPlanFor, gapRowLine, gapWithWords } from '~/lib/closeGap';
import { formatWhole } from '~/lib/format';
import { loadDayGroups, suggestedGroup, useFuelDay, useFuelStore, useTodayKey, type FoodLog } from '~/lib/fuel';
import { useFuelReminderStore } from '~/lib/fuelReminder';
import { takeGapSheetAsk, useGapSheetAsk } from '~/lib/gapSheetAsk';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { figureLead, restingFigure, space, useBlanc } from '~/theme/blanc';

import { offerReview, type QuickAddState } from './context';
import { FoodRow, foodLine, quickAddMenu, saveQuickAdd } from './FoodLists';
import { hideRecentFood, loadRecentCache, readHidden, readRecentCache, subscribeRecentCache } from './recent';

/** Recent's logs for the picks, read again at most this often while they show. */
const LOGS_MAX_AGE_MS = 10 * 60_000;

/**
 * Whether the evening has begun (from `start`, minutes after midnight): drawn
 * again when it begins, at midnight, and on every return to the front. A
 * hook, so the React Compiler reads the clock each render.
 */
function useEvening(start: number): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = new Date(now);
    const minutes = at.getHours() * 60 + at.getMinutes();
    const next = new Date(at);
    if (minutes < start) next.setHours(Math.floor(start / 60), start % 60, 0, 0);
    else next.setHours(24, 0, 0, 0);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1000, next.getTime() - Date.now()));
    const stop = onAppVisible(() => setNow(Date.now()));
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [now, start]);
  const at = new Date(now);
  return at.getHours() * 60 + at.getMinutes() >= start;
}

type GapInput = {
  userId: string;
  /** Today's key; the picks are for today only. */
  day: string;
  /** Today is the day on screen, loaded: otherwise there are no picks, and none are read. */
  active: boolean;
  totals: MacroTotals;
  target: { calories?: number | null; protein?: number | null } | null | undefined;
  goal: NutritionGoal | null | undefined;
  /** Today's entries: a food already eaten today comes a little later. */
  dayLogs: readonly FoodLog[];
};

/**
 * Today's picks as they stand right now (src/lib/gapPicks.ts): in the
 * evening, when today is well short as the Fuel reminder measures it.
 * `settled` says the answer is in (the day and Recent's logs are read), so
 * "no picks" can be told from "not known yet".
 */
function useGapPlan({ userId, day, active, totals, target, goal, dayLogs }: GapInput) {
  const settings = useFuelReminderStore((state) => state.settings);
  const evening = useEvening(gapEveningStart(settings));
  const kept = useSyncExternalStore(subscribeRecentCache, () => readRecentCache(userId));
  useEffect(() => {
    if (active && evening) void loadRecentCache(userId, LOGS_MAX_AGE_MS);
  }, [active, evening, userId]);
  // Read again on each visit: a food hidden in Log food's Recent stays out here too.
  const [hidden, setHidden] = useState(() => readHidden(userId));
  useFocusEffect(
    useCallback(() => {
      setHidden(readHidden(userId));
    }, [userId]),
  );
  const eatenToday = useMemo(() => new Set(dayLogs.flatMap((log) => (log.food ? [recentFoodKey(log.food)] : []))), [dayLogs]);
  const plan = useMemo(
    () => (active && evening ? gapPlanFor({ logs: kept?.logs, day, totals, target, goal, hidden, eatenToday }) : null),
    [active, evening, kept, day, totals, target, goal, hidden, eatenToday],
  );
  return { plan, hidden, setHidden, settled: active && (!evening || Boolean(kept)) };
}

const openGapSheet = () => router.push('/close-gap');

/**
 * Close the gap on Fuel: one row under the day's figures (today, in the
 * evening, well short), saying where the usual foods would take the day. It
 * opens the sheet, where they are logged. The owner's pick (2026-11-17): as
 * a list on Fuel the picks read as one more meal of the diary.
 */
export function GapRow(props: GapInput) {
  return <GapRowForDay key={`${props.userId}:${props.day}`} {...props} />;
}

function GapRowForDay(input: GapInput) {
  const { plan, settled } = useGapPlan(input);
  // The reminder's tap: the sheet opens once there are picks to show in it, and not at all without.
  const askedAt = useGapSheetAsk((state) => state.askedAt);
  useEffect(() => {
    if (askedAt === null) return;
    if (plan) {
      if (takeGapSheetAsk()) openGapSheet();
    } else if (settled) takeGapSheetAsk();
  }, [askedAt, plan, settled]);
  if (!plan) return null;
  return (
    <Animated.View entering={rowEnter} exiting={blockExit}>
      <Hairline />
      <Row title="Close the gap" detail={gapRowLine(plan, input.totals)} chevron onPress={openGapSheet} />
    </Animated.View>
  );
}

/** A pick's add not confirmed yet: its retry-safe id and where it first went, so a retry writes that same entry. */
type PendingAdd = { pending: PendingEntryId; date: Date; time: string; groups: NutritionGroup[]; groupId: string | null; inFlight: boolean };
type AddedEntry = { id: string; name: string; removing: boolean };
/** What the sheet has shown and done for one account's day. `eaten` is the day's food when the picks were first touched. */
type GapSession = { held: { plan: GapPlan; eaten: Pick<MacroTotals, 'calories' | 'protein'> } | null; states: Record<string, QuickAddState> };
const NO_SESSION: GapSession = { held: null, states: {} };

// Kept outside the sheet, by account and day, so closing the sheet never
// forgets an add that was not confirmed: opened again, its row is still
// there and its retry writes the same entry.
const useGapSessions = create<Record<string, GapSession>>(() => ({}));
const gapWrites = new Map<string, { pending: Map<string, PendingAdd>; added: Map<string, AddedEntry> }>();

function writesFor(key: string) {
  let writes = gapWrites.get(key);
  if (!writes) {
    // One account's day at a time: another day's attempts are never retried.
    gapWrites.clear();
    useGapSessions.setState((all) => (key in all ? { [key]: all[key] } : {}), true);
    writes = { pending: new Map(), added: new Map() };
    gapWrites.set(key, writes);
  }
  return writes;
}

function patchSession(key: string, change: (session: GapSession) => GapSession) {
  useGapSessions.setState((all) => ({ ...all, [key]: change(all[key] ?? NO_SESSION) }));
}

function setPickState(key: string, pick: string, state: QuickAddState | null) {
  patchSession(key, (session) => {
    const states = { ...session.states };
    if (state) states[pick] = state;
    else delete states[pick];
    return { ...session, states };
  });
}

/** Tests start from nothing kept. */
export function forgetGapSessions() {
  gapWrites.clear();
  useGapSessions.setState({}, true);
}

/**
 * Lets go of what is settled, as the sheet comes to the front and as it is
 * left: confirmed ticks go, and with nothing unconfirmed the picks are free
 * to be worked out again from the day as it now stands.
 */
function releaseConfirmed(key: string) {
  const { pending, added } = writesFor(key);
  const retained = new Set(pending.keys());
  for (const [pick, entry] of added) {
    if (entry.removing) retained.add(pick);
    else added.delete(pick);
  }
  patchSession(key, (session) => ({
    held: retained.size === 0 ? null : session.held,
    states: Object.fromEntries(Object.entries(session.states).filter(([pick]) => retained.has(pick))),
  }));
}

const NO_LOGS: FoodLog[] = [];

/**
 * The Close the gap sheet (from Fuel's row, or the reminder's tap): where the
 * usual foods would take today, the foods, and one button that logs them all.
 * + logs one now at its usual amount into the meal that fits the time, and
 * its tick takes it back out; a tap reviews it in Log food at that amount; a
 * swipe or hold hides it, here and in Recent, until it is logged again. Once
 * touched, the sheet holds still until it is left, so nothing moves under a
 * finger.
 */
export function GapSheet() {
  const userId = useAuthStore((state) => state.user?.id);
  const day = useTodayKey();
  if (!userId) return null;
  return <GapSheetForDay key={`${userId}:${day}`} userId={userId} day={day} />;
}

function GapSheetForDay({ userId, day }: { userId: string; day: string }) {
  const c = useBlanc();
  const large = useLargeText();
  const target = useAppStore((state) => state.macroTarget);
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const { selected, logs, loaded } = useFuelDay();
  // The picks are today's: with another day on Fuel there are none.
  const live = selected === day;
  const dayLogs = live ? logs : NO_LOGS;
  const totals = sumMacros(dayLogs);
  const { plan, hidden, setHidden, settled } = useGapPlan({ userId, day, active: live && loaded, totals, target, goal, dayLogs });

  const key = `${userId}:${day}`;
  const session = useGapSessions((all) => all[key]) ?? NO_SESSION;
  const states = session.states;
  const shown = session.held?.plan ?? plan;
  const [loggingAll, setLoggingAll] = useState(false);
  const hold = () => {
    if (!shown) return;
    patchSession(key, (current) => (current.held ? current : { ...current, held: { plan: shown, eaten: { calories: totals.calories, protein: totals.protein } } }));
  };
  useFocusEffect(
    useCallback(() => {
      releaseConfirmed(key);
      return () => releaseConfirmed(key);
    }, [key]),
  );

  /** Logs a pick at its usual amount. `quiet`: one of several, so the caller speaks for them all. */
  const add = async (pick: GapPick, quiet = false): Promise<boolean> => {
    hold();
    const { pending, added } = writesFor(key);
    const waiting = pending.get(pick.key);
    // One write at a time for a pick; a confirmed one is not logged again until taken out.
    if (waiting?.inFlight) return false;
    if (added.has(pick.key)) return true;
    setPickState(key, pick.key, 'saving');
    let attempt = waiting;
    if (!attempt) {
      const now = new Date();
      // Held before the meals are read, so a second tap meanwhile waits for this one.
      attempt = { pending: createPendingEntryId(), date: now, time: format(now, 'HH:mm'), groups: [], groupId: null, inFlight: true };
      pending.set(pick.key, attempt);
      // Into the meal that fits the time (Dinner in the evening), as Log food would put it.
      const groups = await loadDayGroups(day).catch(() => [] as NutritionGroup[]);
      attempt.groups = groups;
      attempt.groupId = suggestedGroup(groups, now)?.id ?? null;
    }
    attempt.inFlight = true;
    const entryId = attempt.pending.take();
    const saved = await saveQuickAdd(pick.food, {
      servings: pick.servings,
      source: pick.source,
      when: { date: attempt.date, time: attempt.time, groupId: attempt.groupId },
      groups: attempt.groups,
      pending: attempt.pending,
    });
    attempt.inFlight = false;
    if (!saved) {
      if (!quiet) haptics.error();
      setPickState(key, pick.key, 'error');
      announce(`Couldn't confirm ${pick.food.name}`);
      return false;
    }
    pending.delete(pick.key);
    added.set(pick.key, { id: entryId, name: pick.food.name, removing: false });
    if (!quiet) {
      haptics.success();
      announce(`${pick.food.name} added`);
    }
    setPickState(key, pick.key, 'done');
    void useFuelStore.getState().refreshAfterWrite();
    return true;
  };

  // A mis-tapped +: the tick takes the entry back out, and the + comes back.
  const takeOut = async (pick: GapPick) => {
    const logged = writesFor(key).added.get(pick.key);
    if (!logged || logged.removing) return;
    logged.removing = true;
    setPickState(key, pick.key, 'saving');
    const removed = await useFuelStore.getState().deleteEntry(logged.id).catch(() => false);
    logged.removing = false;
    if (!removed) {
      haptics.error();
      setPickState(key, pick.key, 'done');
      announce(`Couldn't take out ${logged.name}`);
      return;
    }
    writesFor(key).added.delete(pick.key);
    haptics.success();
    setPickState(key, pick.key, null);
    announce(`${logged.name} taken out`);
    void useFuelStore.getState().refreshAfterWrite();
  };

  const review = (pick: GapPick) => {
    hold();
    offerReview(pick.food, pick.servings);
    router.push({ pathname: '/log-food', params: { day, review: '1' } });
  };

  const hide = (pick: GapPick) => {
    hold();
    haptics.success();
    setHidden(hideRecentFood(userId, pick.key));
  };

  // Held picks leave out what was hidden since; the others stay where they are.
  const picks = (shown?.picks ?? []).filter((pick) => !(hidden[pick.key] >= pick.addedAt));
  const left = picks.filter((pick) => states[pick.key] !== 'done').length;
  // A single + still on its way: the button waits for it rather than counting it as unconfirmed.
  const oneSaving = !loggingAll && picks.some((pick) => states[pick.key] === 'saving');

  // The main button: every pick not logged yet, one after another; the sheet closes once they are all in.
  const logAll = async () => {
    if (loggingAll) return;
    if (left === 0) {
      router.back();
      return;
    }
    setLoggingAll(true);
    let confirmed = true;
    for (const pick of picks) {
      if (!(await add(pick, true))) confirmed = false;
    }
    setLoggingAll(false);
    if (!confirmed) {
      haptics.error();
      return;
    }
    haptics.success();
    announce(picks.length === 1 ? `${picks[0].food.name} added` : `${picks.length} foods added`);
    router.back();
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
      <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <BlancText variant="headline" accessibilityRole="header">
          Close the gap
        </BlancText>
      </View>
      <View style={{ width: 44 }} />
    </View>
  );

  let body = null;
  if (shown && picks.length > 0) {
    // The figure is where the picks take the day, from the day's food when
    // they were first touched: it holds while they are ticked off one by one.
    const eaten = session.held?.eaten ?? totals;
    const base = shown.aim === 'calories' ? eaten.calories : eaten.protein;
    const goalValue = shown.aim === 'calories' ? fuelTargets(target).calories : fuelTargets(target).protein;
    const reach = picks.reduce((sum, pick) => sum + gapPickAmount(shown, pick), base);
    const figure = formatWhole(reach);
    const against = `of ${gapFigure(shown, goalValue)}${gapWithWords(picks.length, left)}`;
    body = (
      <>
        <View accessible accessibilityLabel={speak(`${figure} ${against}`)} style={{ paddingLeft: space.labelPad, paddingRight: space.gutter, paddingTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <RollingText variant="figure" size={48} style={{ ...restingFigure, letterSpacing: -1, marginLeft: figureLead(figure, 48, { tabular: false }) }}>
              {figure}
            </RollingText>
            <BlancText variant="secondary" tone="graphite" style={{ flexShrink: 1 }}>
              {against}
            </BlancText>
          </View>
          <PlanLine
            eaten={base / goalValue}
            foods={picks.map((pick) => ({ key: pick.key, share: gapPickAmount(shown, pick) / goalValue, logged: states[pick.key] === 'done' }))}
          />
        </View>
        <Label style={{ overflow: 'hidden', marginTop: 12 }} layout={rowLayout}>
          {picks.map((pick, index) => (
            <PickRow
              key={pick.key}
              pick={pick}
              divided={index > 0}
              state={states[pick.key]}
              onAdd={(chosen) => void add(chosen)}
              onTakeOut={(chosen) => void takeOut(chosen)}
              onOpen={review}
              onHide={hide}
            />
          ))}
        </Label>
        {/* The sheet's action, as large and at the same inset as the other sheets'. */}
        <View style={{ marginHorizontal: space.inset, marginTop: 18 }}>
          <Capsule title={gapLogAllTitle(picks.length, left)} size="large" fill busy={loggingAll} disabled={oneSaving} onPress={() => void logAll()} />
        </View>
      </>
    );
  } else if (settled || !live) {
    // Opened with nothing to offer (the day caught up, or every pick was hidden).
    body = (
      <>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 22, textAlign: 'center' }}>
          Nothing more to suggest today.
        </BlancText>
        <View style={{ marginHorizontal: space.inset, marginTop: 22 }}>
          <Capsule title="Done" size="large" fill onPress={() => router.back()} />
        </View>
      </>
    );
  }

  // The sheet fits its content; at the accessibility text sizes it can be
  // taller than the screen, so it scrolls there.
  return large ? (
    <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 36 }}>
      {header}
      {body}
    </ScrollView>
  ) : (
    <View style={{ backgroundColor: c.ground, paddingBottom: 24 }}>
      {header}
      {body}
    </View>
  );
}

/**
 * The day's line with the plan on it: what is eaten in ink, then each pick as
 * its own length, drawn to size, in the quiet mark until it is logged and in
 * ink once it is. Past the target the line is simply full.
 */
function PlanLine({ eaten, foods }: { eaten: number; foods: { key: string; share: number; logged: boolean }[] }) {
  const c = useBlanc();
  const width = (share: number) => `${Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100}%` as const;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', height: 3, borderRadius: 2, backgroundColor: c.track, overflow: 'hidden', marginTop: 10 }}>
      <View style={{ width: width(eaten), height: 3, borderRadius: 2, backgroundColor: c.ink, flexShrink: 0 }} />
      {foods.map((food) => (
        <View key={food.key} style={{ width: width(food.share), height: 3, flexShrink: 0, paddingLeft: 2 }}>
          <View style={{ flex: 1, borderRadius: 2, backgroundColor: food.logged ? c.ink : c.mark }} />
        </View>
      ))}
    </View>
  );
}

/** One pick: + logs it at the usual amount, a tap reviews it, a swipe or hold hides it. */
function PickRow({ pick, divided, state, onAdd, onTakeOut, onOpen, onHide }: {
  pick: GapPick;
  divided: boolean;
  state?: QuickAddState;
  onAdd: (pick: GapPick) => void;
  onTakeOut: (pick: GapPick) => void;
  onOpen: (pick: GapPick) => void;
  onHide: (pick: GapPick) => void;
}) {
  const amount = servingLabel({ servings: pick.servings, food: pick.food });
  const menu: MenuAction[] = [
    ...quickAddMenu({ purpose: 'log', state, logTitle: `Log ${amount} now`, onAdd: () => onAdd(pick), onTakeOut: () => onTakeOut(pick) }),
    { title: 'Review and log', symbol: 'list.bullet.rectangle', run: () => onOpen(pick) },
    { title: 'Hide', subtitle: 'Here and in Recent, until you log it again', symbol: 'eye.slash', destructive: true, removes: true, run: () => onHide(pick) },
  ];
  return (
    <Animated.View entering={rowEnter} exiting={rowExit} layout={rowLayout}>
      {divided ? <Hairline /> : null}
      <SwipeRow name={pick.food.name} actions={[{ label: 'Hide', destructive: true, onPress: () => onHide(pick) }]}>
        <FoodRow
          food={pick.food}
          state={state}
          detail={foodLine(pick.food, pick.servings, amount)}
          servings={pick.servings}
          onOpen={() => onOpen(pick)}
          onAdd={() => onAdd(pick)}
          onTakeOut={() => onTakeOut(pick)}
          menu={menu}
        />
      </SwipeRow>
    </Animated.View>
  );
}
