// The fuel reminder (You): an optional evening notification when today is
// well short of calories or protein. hyPer has no background run, so the words
// are worked out when a notification is handed to iOS, and the plan is handed
// over again whenever today's food, the targets, the goal, the setting or the
// permission change, and on every return to the front. One per day at most;
// kept on this phone, per account. The rules are in ./fuelReminderPlan.
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { create } from 'zustand';

import { onAppVisible } from '@/lib/appVisibility';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { useFuelStore } from './fuel';
import {
  clampReminderMinutes, DEFAULT_REMINDER_SETTINGS, FUEL_REMINDER_CATEGORY, FUEL_REMINDER_SNAP_ACTION, fuelReminderId, fuelShortfall,
  hasReminderTarget, isFuelReminderId, parseReminderHistory, parseReminderSettings, planFuelReminders,
  pruneReminderHistory, reminderDay, reminderPermission,
  type FuelReminderSettings, type ReminderHistory, type ReminderPermission, type ReminderPlanInput, type ReminderRequest,
} from './fuelReminderPlan';
import { postLaunchPress } from './launchActions';

type ReminderState = { userId: string | null; settings: FuelReminderSettings; permission: ReminderPermission | null };
/** You reads this; useFuelReminder owns it. `permission` stays null until read. */
export const useFuelReminderStore = create<ReminderState>(() => ({ userId: null, settings: DEFAULT_REMINDER_SETTINGS, permission: null }));

const settingsKey = (userId: string) => `hyper:fuel-reminder:${userId}`;
const historyKey = (userId: string) => `hyper:fuel-reminder-sent:${userId}`;
function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // holds until the app closes
  }
}

// The signed-in account's reminders handed to iOS, by day (see reminderSent).
let history: ReminderHistory = {};
let historyFor: string | null = null;
// Debug builds only (checkFuelReminderSoon): a time that is never saved.
let debugMinutes: number | null = null;

function loadAccount(userId: string) {
  history = parseReminderHistory(read(historyKey(userId)));
  historyFor = userId;
  useFuelReminderStore.setState({ userId, settings: parseReminderSettings(read(settingsKey(userId))) });
}
function forgetAccount() {
  history = {};
  historyFor = null;
  debugMinutes = null;
  useFuelReminderStore.setState({ userId: null, settings: DEFAULT_REMINDER_SETTINGS });
}
function saveSettings(patch: Partial<FuelReminderSettings>) {
  const { userId, settings } = useFuelReminderStore.getState();
  if (!userId) return;
  const next = { ...settings, ...patch };
  write(settingsKey(userId), JSON.stringify(next));
  useFuelReminderStore.setState({ settings: next });
}

// Asking, reading, handing over and clearing run one at a time, in call order.
let tail: Promise<void> = Promise.resolve();
function inOrder(step: () => Promise<void>): Promise<void> {
  tail = tail.then(step).catch(() => {
    // A reminder, not a record: the next change or return tries again.
  });
  return tail;
}

/** Reads the permission, first asking if iOS still can; the store's change hands the plan over. */
function checkPermission(ask = false) {
  void inOrder(async () => {
    let status = await Notifications.getPermissionsAsync();
    if (ask && !status.granted && status.canAskAgain) {
      status = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    useFuelReminderStore.setState({ permission: reminderPermission(status) });
  });
}

/**
 * You's switch. On asks iOS in context, and the hand-over follows the answer;
 * refused, it stays on and You offers Settings. Off takes back what iOS holds
 * (the hand-over) and clears one already shown.
 */
export function setFuelReminderEnabled(enabled: boolean) {
  saveSettings({ enabled });
  if (enabled) checkPermission(true);
  else void inOrder(() => dismissDelivered());
}
/** You's time, kept to the evening window. */
export function setFuelReminderTime(minutes: number) {
  const next = clampReminderMinutes(minutes);
  if (next !== useFuelReminderStore.getState().settings.minutes) saveSettings({ minutes: next });
}

type Inputs = Omit<ReminderPlanInput, 'now' | 'history' | 'pendingIds'>;
/** What iOS should hold: inputs, or null inputs for nothing at all; null while something it needs is unknown. */
function wanted(): { userId: string; inputs: Inputs | null } | null {
  const userId = useAuthStore.getState().user?.id ?? null;
  const { userId: loadedFor, settings, permission } = useFuelReminderStore.getState();
  if (!userId || loadedFor !== userId) return null;
  // Off, or nothing iOS would show: nothing pending.
  if (!settings.enabled || permission === 'denied') return { userId, inputs: null };
  const fuel = useFuelStore.getState();
  // A confirmed save makes the old shortfall unreliable, even if its refresh
  // fails. Take reminders back until a read reconciles today's totals.
  if (fuel.totalsNeedRefresh) return { userId, inputs: null };
  // Not read or not answered yet: iOS would refuse it; keep what it holds.
  if (permission !== 'granted') return null;
  const app = useAppStore.getState();
  if (app.macroTargetLoadedForUserId !== userId || app.nutritionProfileLoadedForUserId !== userId) return null;
  if (fuel.todayLoadedForUserId !== userId || fuel.todayLoadedKey !== fuel.todayKey) return null;
  return {
    userId,
    inputs: {
      settings: { enabled: true, minutes: debugMinutes ?? settings.minutes },
      day: fuel.todayKey,
      totals: fuel.todayTotals,
      target: app.macroTarget,
      goal: app.nutritionProfile?.goal ?? null,
    },
  };
}

const pendingReminderIds = async () =>
  (await Notifications.getAllScheduledNotificationsAsync()).map((request) => request.identifier).filter(isFuelReminderId);

/** Takes back what is no longer wanted and hands over the rest, noting each step in the account's history as it lands. */
async function hold(userId: string, now: Date, requests: ReminderRequest[], pending: string[]) {
  const wantedIds = new Set(requests.map((request) => request.id));
  const next: ReminderHistory = { ...(historyFor === userId ? history : parseReminderHistory(read(historyKey(userId)))) };
  // Saved after every step, so an app suspended or closed part-way never
  // leaves iOS holding a day the record lacks (that day could go out twice).
  const save = () => {
    const pruned = pruneReminderHistory(next, now);
    if (historyFor === userId) history = pruned;
    write(historyKey(userId), JSON.stringify(pruned));
  };
  try {
    for (const id of pending) {
      if (wantedIds.has(id)) continue;
      await Notifications.cancelScheduledNotificationAsync(id);
      // Taken back before it was due: that day can still have one.
      delete next[reminderDay(id)];
      save();
    }
    for (const request of requests) {
      await Notifications.scheduleNotificationAsync({
        identifier: request.id,
        content: {
          title: request.title,
          body: request.body,
          sound: 'default',
          categoryIdentifier: FUEL_REMINDER_CATEGORY,
          threadIdentifier: FUEL_REMINDER_CATEGORY,
        },
        // Wall-clock parts (month from 1); iOS works out the instant.
        trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, ...request.at, second: 0, repeats: false },
      });
      next[request.day] = request.atMs;
      save();
    }
  } finally {
    // Also prunes when there was nothing to change.
    save();
  }
}

async function dismissDelivered(only?: string) {
  for (const shown of await Notifications.getPresentedNotificationsAsync()) {
    const id = shown.request.identifier;
    if (isFuelReminderId(id) && (only === undefined || id === only)) await Notifications.dismissNotificationAsync(id);
  }
}

let applied: string | null = null;
let queued = false;
/** Hands the plan to iOS after the steps already queued; a burst of changes makes one run with the latest state. */
function requestSync() {
  if (queued) return;
  queued = true;
  void inOrder(async () => {
    queued = false;
    const want = wanted();
    if (!want) return;
    const pending = await pendingReminderIds();
    const pendingIds = new Set(pending);
    const now = new Date();
    const requests = want.inputs ? planFuelReminders({ ...want.inputs, now, history, pendingIds }) : [];
    if (!requests) return;
    const key = JSON.stringify(requests);
    const held = pending.length === requests.length && requests.every((request) => pendingIds.has(request.id));
    if (key !== applied || !held) {
      applied = null;
      await hold(want.userId, now, requests, pending);
      applied = key;
      if (debugMinutes !== null) await logPending(want.inputs?.day);
    }
    // Enough logged: a reminder already showing for today goes too.
    const inputs = want.inputs;
    if (inputs && hasReminderTarget(inputs.target) && !fuelShortfall(inputs.totals, inputs.target, inputs.goal)) {
      await dismissDelivered(fuelReminderId(inputs.day));
    }
  });
}

/** Mount and return to the front: the time may have passed, Settings may now allow it, the zone may have changed. */
function handOverAgain() {
  applied = null;
  checkPermission();
  requestSync();
  void inOrder(() => dismissDelivered());
}

/** Nobody signed in (a sign-out, or a saved session that could not be restored): no reminder stays pending, shown or waiting to open. */
export function clearFuelReminders(): Promise<void> {
  return inOrder(async () => {
    applied = null;
    for (const id of await pendingReminderIds()) await Notifications.cancelScheduledNotificationAsync(id);
    await dismissDelivered();
    const last = Notifications.getLastNotificationResponse();
    if (last && isFuelReminderId(last.notification.request.identifier)) Notifications.clearLastNotificationResponse();
  });
}

/** Sign-out from the tabs: the account's history also learns that its pending days were taken back. */
function signOutOf(userId: string) {
  void inOrder(async () => {
    applied = null;
    await hold(userId, new Date(), [], await pendingReminderIds());
  });
  void clearFuelReminders();
  forgetAccount();
}

/** Resolves once every step queued so far has run (tests, scripted checks). */
export const fuelReminderSettled = () => tail;

async function logPending(day?: string) {
  const held = (await Notifications.getAllScheduledNotificationsAsync()).filter((request) => isFuelReminderId(request.identifier));
  if (day && !held.some((request) => request.identifier === fuelReminderId(day))) {
    console.log('[fuelReminder] nothing for today: not well short, or already sent');
  }
  for (const request of held) {
    console.log(`[fuelReminder] ${request.identifier} "${request.content.title}" ${JSON.stringify(request.trigger)}`);
  }
}

/** Debug builds (-hyperAction fuelReminder): today's reminder a minute from now through the real path, then a log of what iOS holds. */
export function checkFuelReminderSoon() {
  const started = Date.now();
  const attempt = () => {
    const { userId } = useFuelReminderStore.getState();
    const fuel = useFuelStore.getState();
    if (!userId || fuel.todayLoadedForUserId !== userId || fuel.todayLoadedKey !== fuel.todayKey) {
      if (Date.now() - started < 15_000) setTimeout(attempt, 250);
      else console.log('[fuelReminder] skipped: the account did not load');
      return;
    }
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes() + 1;
    if (minutes >= 24 * 60) {
      console.log('[fuelReminder] skipped: too close to midnight');
      return;
    }
    debugMinutes = minutes;
    history = { ...history };
    delete history[fuel.todayKey];
    applied = null;
    setFuelReminderEnabled(true);
    requestSync();
  };
  attempt();
}

/** The signed-in account's reminder follows its food, targets, setting and permission until sign-out. */
function followAccount(userId: string) {
  loadAccount(userId);
  const stopFuel = useFuelStore.subscribe((s, p) => {
    if (s.todayTotals !== p.todayTotals || s.todayKey !== p.todayKey || s.todayLoadedKey !== p.todayLoadedKey
      || s.todayLoadedForUserId !== p.todayLoadedForUserId || s.totalsNeedRefresh !== p.totalsNeedRefresh) requestSync();
  });
  const stopApp = useAppStore.subscribe((s, p) => {
    if (s.macroTarget !== p.macroTarget || s.nutritionProfile !== p.nutritionProfile
      || s.macroTargetLoadedForUserId !== p.macroTargetLoadedForUserId
      || s.nutritionProfileLoadedForUserId !== p.nutritionProfileLoadedForUserId) requestSync();
  });
  const stopSelf = useFuelReminderStore.subscribe((s, p) => {
    if (s.settings !== p.settings || s.userId !== p.userId || s.permission !== p.permission) requestSync();
  });
  const stopVisible = onAppVisible(handOverAgain);
  handOverAgain();
  return () => {
    stopFuel();
    stopApp();
    stopSelf();
    stopVisible();
    // The tabs unmount only on sign-out: nothing of this account stays pending or shown.
    signOutOf(userId);
  };
}

// The response last acted on, so one tap that arrives both stored and as an event opens once.
let lastOpened: string | null = null;
let followingTaps = false;

/**
 * A tap on the reminder opens Log food on Recent; its Snap a meal button
 * (press and hold the reminder) opens the camera. Both go through the launch
 * press store, so they run exactly like the Home Screen quick actions of the
 * same name: once, after the intro, with the app in front, and never closing
 * a sheet that is open (lib/launch.ts).
 */
function onReminderResponse(response: Notifications.NotificationResponse | null) {
  if (!response || !isFuelReminderId(response.notification.request.identifier)) return;
  Notifications.clearLastNotificationResponse();
  const key = `${response.notification.request.identifier}:${response.notification.date}:${response.actionIdentifier}`;
  if (key === lastOpened) return;
  lastOpened = key;
  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) postLaunchPress('log-food');
  else if (response.actionIdentifier === FUEL_REMINDER_SNAP_ACTION) postLaunchPress('snap-meal');
}

/** The reminder's Snap a meal button. iOS keeps the category, so setting it again is harmless. */
function registerReminderActions() {
  try {
    void Notifications.setNotificationCategoryAsync(FUEL_REMINDER_CATEGORY, [
      { identifier: FUEL_REMINDER_SNAP_ACTION, buttonTitle: 'Snap a meal', options: { opensAppToForeground: true } },
    ]).catch(() => {});
  } catch {
    // unavailable
  }
}

/**
 * Root layout, at module scope beside takeNativeLaunch: reminder taps for the
 * whole run of the app, the one that launched it (read once) and each one
 * after. Read there, not in the tabs, a tap becomes a press the moment it
 * lands, so the press rules apply from the tap: a cold launch leaves the intro
 * out, the offline wait keeps it a minute at most, and leaving the app or the
 * sign-in screen forgets it. Once per run; a second call does nothing.
 */
export function followReminderTaps(): void {
  if (followingTaps) return;
  followingTaps = true;
  registerReminderActions();
  // Listen first, then take: a tap that lands in between is read by one or the other (lastOpened keeps it to one press).
  try {
    Notifications.addNotificationResponseReceivedListener(onReminderResponse);
  } catch {
    // unavailable
  }
  try {
    onReminderResponse(Notifications.getLastNotificationResponse());
  } catch {
    // unavailable
  }
}

/** Mounted once (tab layout). Taps are read at the root (followReminderTaps). */
export function useFuelReminder() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => (userId ? followAccount(userId) : undefined), [userId]);
}
