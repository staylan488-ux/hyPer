import { format } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Animated from 'react-native-reanimated';

import { onAppVisible } from '@/lib/appVisibility';
import type { GapPick, GapPlan } from '@/lib/gapPicks';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { servingLabel } from '@/lib/nutritionLedger';
import type { MacroTotals } from '@/lib/nutritionMacros';
import { createPendingEntryId, type PendingEntryId } from '@/lib/pendingEntryId';
import { recentFoodKey } from '@/lib/recentFoods';
import type { NutritionGroup } from '@/types';
import type { MenuAction } from '~/components/HoldMenu';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { announce } from '~/lib/accessibility';
import { gapEveningStart, gapPlanFor } from '~/lib/closeGap';
import { formatWhole } from '~/lib/format';
import { loadDayGroups, suggestedGroup, useFuelStore, type FoodLog } from '~/lib/fuel';
import { useFuelReminderStore } from '~/lib/fuelReminder';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';

import { offerReview, type QuickAddState } from './context';
import { FoodRow, foodLine, quickAddMenu, saveQuickAdd } from './FoodLists';
import { hideRecentFood, loadRecentCache, readHidden, readRecentCache, subscribeRecentCache } from './recent';

/** Recent's logs for the card, read again at most this often while it shows. */
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

/** A pick's add not confirmed yet: its retry-safe id and where it first went, so a retry writes that same entry. */
type PendingAdd = { pending: PendingEntryId; date: Date; time: string; groups: NutritionGroup[]; groupId: string | null; inFlight: boolean };

/**
 * Close the gap (Fuel, today, in the evening): when today is well short (as
 * the Fuel reminder measures it), the two or three usual foods that together
 * cover what's left (src/lib/gapPicks.ts). + logs one now at its usual amount
 * into the meal that fits the time, and its tick takes it back out; a tap
 * reviews it in Log food at that amount; a swipe or hold hides it, here and
 * in Recent, until it is logged again. Once touched, the card holds still
 * until Fuel is left, so nothing moves under a finger.
 */
export function GapPicks({ userId, day, totals, target, goal, dayLogs }: {
  userId: string;
  /** Today's key; the card shows only on today. */
  day: string;
  totals: MacroTotals;
  target: { calories?: number | null; protein?: number | null } | null | undefined;
  goal: NutritionGoal | null | undefined;
  /** Today's entries: a food already eaten today comes a little later. */
  dayLogs: readonly FoodLog[];
}) {
  const settings = useFuelReminderStore((state) => state.settings);
  const evening = useEvening(gapEveningStart(settings));
  const kept = useSyncExternalStore(subscribeRecentCache, () => readRecentCache(userId));
  useEffect(() => {
    if (evening) void loadRecentCache(userId, LOGS_MAX_AGE_MS);
  }, [evening, userId]);
  // Read again on each visit: a food hidden in Log food's Recent stays out here too.
  const [hidden, setHidden] = useState(() => readHidden(userId));
  const eatenToday = useMemo(() => new Set(dayLogs.flatMap((log) => (log.food ? [recentFoodKey(log.food)] : []))), [dayLogs]);
  const plan = useMemo(
    () => (evening ? gapPlanFor({ logs: kept?.logs, day, totals, target, goal, hidden, eatenToday }) : null),
    [evening, kept, day, totals, target, goal, hidden, eatenToday],
  );

  // Keep unconfirmed adds (and their original card) across visits for a safe retry.
  const [held, setHeld] = useState<{ day: string; plan: GapPlan } | null>(null);
  const [states, setStates] = useState<Record<string, QuickAddState>>({});
  const pendingAdds = useRef(new Map<string, PendingAdd>());
  const addedEntries = useRef(new Map<string, { id: string; name: string; removing: boolean }>());
  const shown = held && held.day === day ? held.plan : plan;
  const hold = () => {
    if (shown) setHeld((current) => (current && current.day === day ? current : { day, plan: shown }));
  };
  useFocusEffect(
    useCallback(() => {
      setHidden(readHidden(userId));
      return () => {
        // A failed response may still have committed. Keep its id as well as a running save's.
        if (pendingAdds.current.size > 0) return;
        for (const added of addedEntries.current.values()) if (added.removing) return;
        pendingAdds.current.clear();
        addedEntries.current.clear();
        setStates({});
        setHeld(null);
      };
    }, [userId]),
  );

  const add = async (pick: GapPick) => {
    hold();
    const waiting = pendingAdds.current.get(pick.key);
    // One write at a time for a pick; a confirmed one is not logged again until taken out.
    if (waiting?.inFlight || addedEntries.current.has(pick.key)) return;
    setStates((state) => ({ ...state, [pick.key]: 'saving' }));
    let attempt = waiting;
    if (!attempt) {
      const now = new Date();
      // Held before the meals are read, so a second tap meanwhile waits for this one.
      attempt = { pending: createPendingEntryId(), date: now, time: format(now, 'HH:mm'), groups: [], groupId: null, inFlight: true };
      pendingAdds.current.set(pick.key, attempt);
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
      haptics.error();
      setStates((state) => ({ ...state, [pick.key]: 'error' }));
      announce(`Couldn't confirm ${pick.food.name}`);
      return;
    }
    pendingAdds.current.delete(pick.key);
    addedEntries.current.set(pick.key, { id: entryId, name: pick.food.name, removing: false });
    haptics.success();
    setStates((state) => ({ ...state, [pick.key]: 'done' }));
    announce(`${pick.food.name} added`);
    void useFuelStore.getState().refreshAfterWrite();
  };

  // A mis-tapped +: the tick takes the entry back out, and the + comes back.
  const takeOut = async (pick: GapPick) => {
    const logged = addedEntries.current.get(pick.key);
    if (!logged || logged.removing) return;
    logged.removing = true;
    setStates((state) => ({ ...state, [pick.key]: 'saving' }));
    const removed = await useFuelStore.getState().deleteEntry(logged.id).catch(() => false);
    logged.removing = false;
    if (!removed) {
      haptics.error();
      setStates((state) => ({ ...state, [pick.key]: 'done' }));
      announce(`Couldn't take out ${logged.name}`);
      return;
    }
    addedEntries.current.delete(pick.key);
    haptics.success();
    setStates((state) => {
      const next = { ...state };
      delete next[pick.key];
      return next;
    });
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

  // A held card leaves out what was hidden since; the others stay where they are.
  const picks = (shown?.picks ?? []).filter((pick) => !(hidden[pick.key] >= pick.addedAt));
  if (!shown || picks.length === 0) return null;
  // The foods' total, as each meal's header gives its own.
  const note = shown.aim === 'calories' ? `${formatWhole(shown.kcal)} kcal` : `${formatWhole(shown.protein)} g protein`;
  return (
    <Animated.View entering={rowEnter} exiting={blockExit} layout={rowLayout}>
      <Section title="Close the gap" note={note} style={{ marginTop: 20 }}>
        <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
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
      </Section>
    </Animated.View>
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
