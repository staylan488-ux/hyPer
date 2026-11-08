// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as plan from '../native/src/lib/fuelReminderPlan';
import * as entry from '@/lib/saveNutritionEntry';
import * as pending from '@/lib/pendingEntryId';
import { loadNativeModule } from './helpers/loadNativeModule';
import { memoryStorage } from './memoryStorage';
import { nativeFuelStore } from './helpers/nativeFuelStore';
import type { FoodLog } from '../native/src/lib/fuel';

// The fuel reminder handed to iOS through the real hook, with a fake
// expo-notifications that holds pending and shown notifications and, like
// iOS, refuses to schedule without permission.

const savedTz = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = '2026-11-04';
const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
const id = (day: string) => `hyper-fuel-reminder-${day}`;
const totals = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0 });

type Permission = {
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status: number; allowsAlert: boolean; allowsDisplayOnLockScreen: boolean; allowsDisplayInNotificationCenter: boolean };
};
type Response = { actionIdentifier: string; notification: { date: number; request: { identifier: string } } };
type Scheduled = { content: Record<string, unknown>; trigger: Record<string, unknown> };

const allowed = (): Permission => ({
  granted: true,
  canAskAgain: true,
  ios: { status: 2, allowsAlert: true, allowsDisplayOnLockScreen: true, allowsDisplayInNotificationCenter: true },
});

const ios = {
  pending: new Map<string, Scheduled>(),
  presented: [] as string[],
  permission: allowed(),
  answer: allowed(),
  last: null as Response | null,
  responder: null as ((response: Response) => void) | null,
};
const PROVISIONAL = 3;
const schedule = async ({ identifier, content, trigger }: { identifier: string } & Scheduled) => {
  // Like iOS: a provisional app may schedule (it shows quietly in Notification Center).
  if (!ios.permission.granted && ios.permission.ios?.status !== PROVISIONAL) throw new Error('Notifications are not allowed');
  ios.pending.set(identifier, { content, trigger });
  return identifier;
};
const notifications = {
  SchedulableTriggerInputTypes: { CALENDAR: 'calendar' },
  DEFAULT_ACTION_IDENTIFIER: DEFAULT_ACTION,
  getPermissionsAsync: vi.fn(async () => ios.permission),
  requestPermissionsAsync: vi.fn(async () => {
    ios.permission = ios.answer;
    return ios.answer;
  }),
  getAllScheduledNotificationsAsync: vi.fn(async () =>
    [...ios.pending].map(([identifier, request]) => ({ identifier, content: request.content, trigger: request.trigger }))),
  scheduleNotificationAsync: vi.fn(schedule),
  cancelScheduledNotificationAsync: vi.fn(async (identifier: string) => {
    ios.pending.delete(identifier);
  }),
  getPresentedNotificationsAsync: vi.fn(async () => ios.presented.map((identifier) => ({ date: 0, request: { identifier } }))),
  dismissNotificationAsync: vi.fn(async (identifier: string) => {
    ios.presented = ios.presented.filter((shown) => shown !== identifier);
  }),
  getLastNotificationResponse: vi.fn(() => ios.last),
  clearLastNotificationResponse: vi.fn(() => {
    ios.last = null;
  }),
  setNotificationCategoryAsync: vi.fn(async () => ({})),
  addNotificationResponseReceivedListener: vi.fn((listener: (response: Response) => void) => {
    ios.responder = listener;
    return { remove: () => { ios.responder = null; } };
  }),
};

const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: 'user-1' } }));
const app = create(() => ({
  macroTarget: { calories: 2800, protein: 160 } as { calories: number; protein: number } | null,
  nutritionProfile: { goal: 'bulk' } as { goal: string } | null,
  macroTargetLoadedForUserId: 'user-1' as string | null,
  nutritionProfileLoadedForUserId: 'user-1' as string | null,
}));
const fuel = create(() => ({
  todayKey: DAY,
  todayTotals: totals(1950, 120),
  todayLoadedForUserId: 'user-1' as string | null,
  todayLoadedKey: DAY as string | null,
}));
const postLaunchPress = vi.fn((action: string) => Boolean(action));
let visible: (() => void) | null = null;

type Mod = {
  useFuelReminder: () => void;
  followReminderTaps: () => void;
  useFuelReminderStore: { getState: () => { userId: string | null; settings: { enabled: boolean; minutes: number }; permission: string | null } };
  setFuelReminderEnabled: (enabled: boolean) => void;
  setFuelReminderTime: (minutes: number) => void;
  clearFuelReminders: () => Promise<void>;
  fuelReminderSettled: () => Promise<void>;
};
let mod: Mod;
let root: Root;
let host: HTMLDivElement;

function Probe() {
  mod.useFuelReminder();
  return null;
}
const render = async () => {
  await act(async () => { root.render(createElement(Probe)); });
};
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await mod.fuelReminderSettled(); });
};
/** Lets queued steps run without waiting for the whole chain (a step may be held open). */
const flush = async () => {
  await act(async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); });
};
const pendingIds = () => [...ios.pending.keys()].sort();
const storedHistory = () => JSON.parse(localStorage.getItem('hyper:fuel-reminder-sent:user-1') ?? '{}') as Record<string, number>;
const seedSettings = (settings: { enabled: boolean; minutes: number }) =>
  localStorage.setItem('hyper:fuel-reminder:user-1', JSON.stringify(settings));
const scheduledIds = () => notifications.scheduleNotificationAsync.mock.calls.map(([request]) => request.identifier);
const response = (identifier: string, date: number, actionIdentifier = DEFAULT_ACTION): Response => ({
  actionIdentifier,
  notification: { date, request: { identifier } },
});

function loadReminder(fuelStore: unknown = fuel): Mod {
  return loadNativeModule<Mod>('lib/fuelReminder.ts', {
    'expo-notifications': notifications,
    zustand: { create },
    '@/lib/appVisibility': {
      onAppVisible: (listener: () => void) => {
        visible = listener;
        return () => { visible = null; };
      },
    },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: auth },
    './fuel': { useFuelStore: fuelStore },
    './fuelReminderPlan': plan,
    './launchActions': { postLaunchPress },
  });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 13, 0));
  seedSettings({ enabled: true, minutes: 1200 });
  ios.pending = new Map();
  ios.presented = [];
  ios.permission = allowed();
  ios.answer = allowed();
  ios.last = null;
  ios.responder = null;
  notifications.scheduleNotificationAsync.mockImplementation(schedule);
  auth.setState({ user: { id: 'user-1' } });
  app.setState({
    macroTarget: { calories: 2800, protein: 160 },
    nutritionProfile: { goal: 'bulk' },
    macroTargetLoadedForUserId: 'user-1',
    nutritionProfileLoadedForUserId: 'user-1',
  });
  fuel.setState({ todayKey: DAY, todayTotals: totals(1950, 120), todayLoadedForUserId: 'user-1', todayLoadedKey: DAY });
  postLaunchPress.mockClear();
  notifications.setNotificationCategoryAsync.mockClear();
  visible = null;
  mod = loadReminder();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('handing the reminder to iOS', () => {
  it('waits for targets, the goal and today’s food, then holds today and the next two days', async () => {
    app.setState({ macroTargetLoadedForUserId: null, nutritionProfileLoadedForUserId: null });
    fuel.setState({ todayLoadedForUserId: null, todayLoadedKey: null });
    await render();
    await settle();
    app.setState({ macroTargetLoadedForUserId: 'user-1' });
    await settle();
    app.setState({ nutritionProfileLoadedForUserId: 'user-1' });
    await settle();
    // Yesterday's figures still on screen while today loads.
    fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: '2026-11-03' });
    await settle();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    fuel.setState({ todayLoadedKey: DAY });
    await settle();
    expect(pendingIds()).toEqual([id('2026-11-04'), id('2026-11-05'), id('2026-11-06')]);
    expect(ios.pending.get(id(DAY))).toEqual({
      trigger: { type: 'calendar', year: 2026, month: 11, day: 4, hour: 20, minute: 0, second: 0, repeats: false },
      content: {
        title: '850 kcal and 40 g protein to go',
        body: 'Still time for a good meal.',
        sound: 'default',
        categoryIdentifier: 'fuelReminder',
        threadIdentifier: 'fuelReminder',
      },
    });
    expect(ios.pending.get(id('2026-11-05'))?.content.title).toBe('Nothing logged today');
    expect(Object.keys(storedHistory())).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
  });

  it('takes today’s back once enough is logged, and clears one already shown', async () => {
    await render();
    await settle();
    ios.presented = [id(DAY), 'hyper-rest-over'];
    fuel.setState({ todayTotals: totals(2500, 150) });
    await settle();
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(id(DAY));
    expect(pendingIds()).toEqual([id('2026-11-05'), id('2026-11-06')]);
    expect(Object.keys(storedHistory())).toEqual(['2026-11-05', '2026-11-06']);
    expect(ios.presented).toEqual(['hyper-rest-over']);
  });

  it('skips an unchanged plan and hands everything over again on return to the front', async () => {
    await render();
    await settle();
    const handed = notifications.scheduleNotificationAsync.mock.calls.length;
    expect(handed).toBe(3);
    fuel.setState({ todayTotals: totals(1950, 120) });
    await settle();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(handed);

    ios.presented = [id('2026-11-03'), 'hyper-rest-over'];
    await act(async () => { visible?.(); });
    await settle();
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(handed + 3);
    expect(ios.presented).toEqual(['hyper-rest-over']);
  });

  it('takes every reminder back when switched off, leaving Rest over', async () => {
    await render();
    await settle();
    ios.pending.set('hyper-rest-over', { content: {}, trigger: {} });
    mod.setFuelReminderEnabled(false);
    await settle();
    expect(pendingIds()).toEqual(['hyper-rest-over']);
    expect(JSON.parse(localStorage.getItem('hyper:fuel-reminder:user-1')!)).toEqual({ enabled: false, minutes: 1200 });
  });

  it('sends at most one a day, even when the time moves later after it went out', async () => {
    await render();
    await settle();
    ios.pending.delete(id(DAY)); // delivered
    vi.setSystemTime(new Date(2026, 10, 4, 20, 1));
    notifications.scheduleNotificationAsync.mockClear();
    mod.setFuelReminderTime(1290);
    await settle();
    expect(scheduledIds()).toEqual([id('2026-11-05'), id('2026-11-06')]);
  });

  it('counts a reminder that went out while the app was closed', async () => {
    seedSettings({ enabled: true, minutes: 1320 });
    localStorage.setItem('hyper:fuel-reminder-sent:user-1', JSON.stringify({ [DAY]: new Date(2026, 10, 4, 20, 0).getTime() }));
    vi.setSystemTime(new Date(2026, 10, 4, 21, 0));
    await render();
    await settle();
    expect(pendingIds()).toEqual([id('2026-11-05'), id('2026-11-06')]);
  });

  it('retries the whole plan after a failed hand-over', async () => {
    notifications.scheduleNotificationAsync
      .mockImplementationOnce(schedule)
      .mockImplementationOnce(async () => { throw new Error('add failed'); });
    await render();
    await settle();
    expect(Object.keys(storedHistory())).toEqual([DAY]);

    fuel.setState({ todayTotals: totals(1950, 120) });
    await settle();
    expect(pendingIds()).toEqual([id('2026-11-04'), id('2026-11-05'), id('2026-11-06')]);
    expect(Object.keys(storedHistory())).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
  });

  it('notes each day as iOS takes it, so an app closed part-way never sends one twice', async () => {
    let release!: () => void;
    const held = async (request: Parameters<typeof schedule>[0]) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return schedule(request);
    };
    notifications.scheduleNotificationAsync.mockImplementationOnce(schedule).mockImplementationOnce(held);
    await render();
    await flush();
    // Suspended after today's add: the record already has it.
    expect(pendingIds()).toEqual([id(DAY)]);
    expect(Object.keys(storedHistory())).toEqual([DAY]);
    release();
    await settle();
    expect(Object.keys(storedHistory())).toEqual([DAY, '2026-11-05', '2026-11-06']);

    // Taking today's back is noted before the next add lands too.
    notifications.scheduleNotificationAsync.mockImplementationOnce(held);
    fuel.setState({ todayTotals: totals(2500, 150) });
    await flush();
    expect(pendingIds()).toEqual([id('2026-11-05'), id('2026-11-06')]);
    expect(Object.keys(storedHistory())).toEqual(['2026-11-05', '2026-11-06']);
    release();
    await settle();
    expect(Object.keys(storedHistory())).toEqual(['2026-11-05', '2026-11-06']);
  });
});

describe('permission', () => {
  it('asks when switched on and holds the plan the moment it is allowed', async () => {
    seedSettings({ enabled: false, minutes: 1200 });
    ios.permission = { granted: false, canAskAgain: true, ios: { ...allowed().ios!, status: 0 } };
    let scheduledBeforeAnswer = -1;
    notifications.requestPermissionsAsync.mockImplementationOnce(async () => {
      scheduledBeforeAnswer = notifications.scheduleNotificationAsync.mock.calls.length;
      ios.permission = ios.answer;
      return ios.answer;
    });
    await render();
    await settle();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    mod.setFuelReminderEnabled(true);
    await settle();
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(scheduledBeforeAnswer).toBe(0);
    expect(pendingIds()).toHaveLength(3);
  });

  it('stays on when refused, holds nothing, and picks up once Settings allows it', async () => {
    seedSettings({ enabled: false, minutes: 1200 });
    ios.permission = { granted: false, canAskAgain: true };
    ios.answer = { granted: false, canAskAgain: false };
    await render();
    await settle();
    mod.setFuelReminderEnabled(true);
    await settle();
    expect(mod.useFuelReminderStore.getState().settings.enabled).toBe(true);
    expect(mod.useFuelReminderStore.getState().permission).toBe('denied');
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(pendingIds()).toEqual([]);

    ios.permission = allowed();
    await act(async () => { visible?.(); });
    await settle();
    expect(pendingIds()).toHaveLength(3);
  });

  it('treats allowed but shown nowhere as off', async () => {
    ios.permission = {
      granted: true,
      canAskAgain: true,
      ios: { status: 2, allowsAlert: false, allowsDisplayOnLockScreen: false, allowsDisplayInNotificationCenter: false },
    };
    await render();
    await settle();
    expect(mod.useFuelReminderStore.getState().permission).toBe('denied');
    expect(pendingIds()).toEqual([]);
  });

  it('holds the plan with provisional permission', async () => {
    ios.permission = { granted: false, canAskAgain: true, ios: { ...allowed().ios!, status: PROVISIONAL } };
    await render();
    await settle();
    expect(mod.useFuelReminderStore.getState().permission).toBe('granted');
    expect(pendingIds()).toHaveLength(3);
  });
});

describe('signing out', () => {
  it('takes this account’s reminders back, keeps Rest over, and starts again on the next sign-in', async () => {
    await render();
    await settle();
    ios.pending.set('hyper-rest-over', { content: {}, trigger: {} });
    ios.presented = [id('2026-11-03'), 'hyper-rest-over'];
    await act(async () => {
      auth.setState({ user: null });
      root.render(null);
    });
    await settle();
    expect(pendingIds()).toEqual(['hyper-rest-over']);
    expect(ios.presented).toEqual(['hyper-rest-over']);
    expect(mod.useFuelReminderStore.getState().userId).toBeNull();
    expect(storedHistory()).toEqual({});

    await act(async () => { auth.setState({ user: { id: 'user-1' } }); });
    await render();
    await settle();
    expect(pendingIds()).toContain(id(DAY));
  });

  it('starts another account on this phone with the switch off', async () => {
    await render();
    await settle();
    expect(pendingIds()).toHaveLength(3);
    await act(async () => {
      auth.setState({ user: null });
      root.render(null);
    });
    await settle();
    notifications.scheduleNotificationAsync.mockClear();
    notifications.getPermissionsAsync.mockClear();

    app.setState({ macroTargetLoadedForUserId: 'user-2', nutritionProfileLoadedForUserId: 'user-2' });
    fuel.setState({ todayLoadedForUserId: 'user-2' });
    await act(async () => { auth.setState({ user: { id: 'user-2' } }); });
    await render();
    await settle();
    expect(mod.useFuelReminderStore.getState()).toMatchObject({
      userId: 'user-2',
      settings: { enabled: false, minutes: 1200 },
      permission: 'granted',
    });
    expect(notifications.getPermissionsAsync).toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(pendingIds()).toEqual([]);
    // The first account keeps its own choice for when it signs in again.
    expect(JSON.parse(localStorage.getItem('hyper:fuel-reminder:user-1')!)).toEqual({ enabled: true, minutes: 1200 });
  });

  it('clears everything with nobody signed in, and a stored tap only when it is a reminder’s', async () => {
    ios.pending.set(id(DAY), { content: {}, trigger: {} });
    ios.pending.set('hyper-rest-over', { content: {}, trigger: {} });
    ios.presented = [id('2026-11-03')];
    ios.last = response('hyper-rest-over', 1);
    await mod.clearFuelReminders();
    expect(pendingIds()).toEqual(['hyper-rest-over']);
    expect(ios.presented).toEqual([]);
    expect(notifications.clearLastNotificationResponse).not.toHaveBeenCalled();

    ios.last = response(id('2026-11-03'), 2);
    await mod.clearFuelReminders();
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
    expect(ios.last).toBeNull();
  });
});

describe('a tap on the reminder', () => {
  // Read at the root from launch (followReminderTaps, beside takeNativeLaunch).
  // The press then runs like the Home Screen quick action of the same name
  // (after the intro, with the app in front): see nativeLaunchRunner.test.ts.
  const follow = () => act(async () => { mod.followReminderTaps(); });

  it('opens Log food once, through the launch press store', async () => {
    await follow();
    await act(async () => { ios.responder?.(response(id(DAY), 1)); });
    expect(postLaunchPress).toHaveBeenCalledTimes(1);
    expect(postLaunchPress).toHaveBeenCalledWith('log-food');
    // The same tap again opens nothing more.
    await act(async () => { ios.responder?.(response(id(DAY), 1)); });
    expect(postLaunchPress).toHaveBeenCalledTimes(1);
  });

  it('opens the camera from the reminder’s Snap a meal button', async () => {
    await follow();
    await act(async () => { ios.responder?.(response(id(DAY), 1, plan.FUEL_REMINDER_SNAP_ACTION)); });
    expect(postLaunchPress).toHaveBeenCalledTimes(1);
    expect(postLaunchPress).toHaveBeenCalledWith('snap-meal');
  });

  it('registers the Snap a meal button, which brings the app to the front', async () => {
    await follow();
    expect(notifications.setNotificationCategoryAsync).toHaveBeenCalledWith('fuelReminder', [
      { identifier: 'snapMeal', buttonTitle: 'Snap a meal', options: { opensAppToForeground: true } },
    ]);
    // No ':' or '-' in the category (expo-notifications' rule).
    expect(plan.FUEL_REMINDER_CATEGORY).toMatch(/^[A-Za-z]+$/);
  });

  it('ignores Rest over, other notifications and unknown actions', async () => {
    await follow();
    await act(async () => {
      ios.responder?.(response('hyper-rest-over', 1));
      ios.responder?.(response('something-else', 1));
      ios.responder?.(response(id(DAY), 2, 'dismiss'));
    });
    expect(postLaunchPress).not.toHaveBeenCalled();
  });

  it('opens Log food for the tap that launched the app, and forgets it', async () => {
    ios.last = response(id(DAY), 1);
    await follow();
    expect(postLaunchPress).toHaveBeenCalledWith('log-food');
    expect(notifications.clearLastNotificationResponse).toHaveBeenCalled();
    expect(ios.last).toBeNull();
    // The same tap arriving again as an event opens nothing more.
    await act(async () => { ios.responder?.(response(id(DAY), 1)); });
    expect(postLaunchPress).toHaveBeenCalledTimes(1);
  });

  it('listens before it takes the stored tap, and follows once however often it is called', async () => {
    ios.last = response(id(DAY), 1);
    await follow();
    await follow();
    expect(notifications.addNotificationResponseReceivedListener.mock.invocationCallOrder[0])
      .toBeLessThan(notifications.getLastNotificationResponse.mock.invocationCallOrder[0]);
    expect(notifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1);
    expect(notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(postLaunchPress).toHaveBeenCalledTimes(1);
  });

  it('leaves taps to the root: the tab layout’s hook neither reads nor hears them', async () => {
    ios.last = response(id(DAY), 1);
    await render();
    await settle();
    expect(notifications.getLastNotificationResponse).not.toHaveBeenCalled();
    expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(postLaunchPress).not.toHaveBeenCalled();
    expect(ios.last).not.toBeNull();
  });
});

describe('the notification handler', () => {
  it('sends the reminder quietly to Notification Center and keeps Rest over as it was', async () => {
    const setNotificationHandler = vi.fn();
    loadNativeModule('platform/restNotifications.ts', {
      'expo-notifications': { setNotificationHandler, SchedulableTriggerInputTypes: { DATE: 'date' } },
      'react-native': { Alert: { alert: vi.fn() } },
      '~/lib/fuelReminderPlan': plan,
    });
    const { handleNotification } = setNotificationHandler.mock.calls[0][0] as {
      handleNotification: (notification: { request: { identifier: string } }) => Promise<Record<string, boolean>>;
    };
    const handled = (identifier: string) => handleNotification({ request: { identifier } });
    expect(await handled(id(DAY))).toEqual({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false });
    expect(await handled('hyper-rest-over')).toMatchObject({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true });
    expect(await handled('something-else')).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
  });
});


describe('the first rest asks for alerts with a reason', () => {
  type Choice = { text: string; onPress?: () => void };
  const load = (granted: boolean) => {
    let choices: Choice[] = [];
    const alert = vi.fn((_title: string, _message: string, buttons: Choice[]) => { choices = buttons; });
    const requestPermissionsAsync = vi.fn(async () => ({ granted }));
    const scheduleNotificationAsync = vi.fn(async () => 'id');
    const module = loadNativeModule<{ scheduleRestEndNotification: (endsAt: string) => Promise<void> }>('platform/restNotifications.ts', {
      'expo-notifications': {
        setNotificationHandler: vi.fn(),
        SchedulableTriggerInputTypes: { DATE: 'date' },
        getPermissionsAsync: vi.fn(async () => ({ granted: false, canAskAgain: true })),
        requestPermissionsAsync,
        scheduleNotificationAsync,
      },
      'react-native': { Alert: { alert } },
      '~/lib/fuelReminderPlan': plan,
    });
    return { module, alert, requestPermissionsAsync, scheduleNotificationAsync, choose: (text: string) => choices.find((choice) => choice.text === text)!.onPress!() };
  };
  const later = () => new Date(Date.now() + 90_000).toISOString();

  it('explains first, then lets iOS ask on Continue', async () => {
    const h = load(true);
    const scheduling = h.module.scheduleRestEndNotification(later());
    await vi.waitFor(() => expect(h.alert).toHaveBeenCalledOnce());
    expect(h.alert.mock.calls[0][0]).toBe('Rest alerts');
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    h.choose('Continue');
    await scheduling;
    expect(h.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(h.scheduleNotificationAsync).toHaveBeenCalledOnce();
  });

  it('asks iOS nothing on Not now, and the rest runs without an alert', async () => {
    const h = load(true);
    const scheduling = h.module.scheduleRestEndNotification(later());
    await vi.waitFor(() => expect(h.alert).toHaveBeenCalledOnce());
    h.choose('Not now');
    await scheduling;
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(h.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('confirmed food writes with a failed refresh', () => {
  const log = (calories: number, protein: number): FoodLog => ({
    id: 'entry', user_id: 'user-1', date: DAY, food_id: 'food', servings: 1, logged_at: null,
    food: { id: 'food', name: 'Meal', calories, protein, carbs: 0, fat: 0 } as FoodLog['food'],
  });

  it.each([undefined, 'edited-entry'])('invalidates each confirmed entry even if the next item fails (editing ID: %s)', async (editingId) => {
    const real = nativeFuelStore();
    real.read.mockResolvedValue({ data: [log(1950, 120)], error: null });
    await real.useFuelStore.getState().loadToday(DAY);
    mod = loadReminder(real.useFuelStore);
    await render();
    await settle();
    expect(pendingIds()).toContain(id(DAY));
    const persist = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const logger = loadNativeModule<typeof import('../native/src/lib/foodLogger')>('lib/foodLogger.ts', {
      'date-fns': dates,
      '@/lib/foodLoggerUtils': {},
      '@/lib/pendingEntryId': pending,
      '@/lib/saveNutritionEntry': { ...entry, persistNutritionEntry: persist },
      '@/lib/supabase': {},
      './fuel': real,
    });
    const input = {
      foodId: 'food', servings: 1, source: 'manual', editingId,
      when: { date: new Date(2026, 10, 4), time: '13:00', groupId: null },
      groups: [], pending: pending.createPendingEntryId(),
    };
    await logger.saveFoodEntry(input);
    await expect(logger.saveFoodEntry(input)).rejects.toThrow('offline');
    await settle();
    expect(pendingIds()).not.toContain(id(DAY));
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(true);
  });

  it('takes back an old reminder after Copy to today, and waits for reconciled totals', async () => {
    const real = nativeFuelStore();
    real.read.mockResolvedValue({ data: [log(1950, 120)], error: null });
    await real.useFuelStore.getState().loadToday(DAY);
    mod = loadReminder(real.useFuelStore);
    await render();
    await settle();
    expect(pendingIds()).toContain(id(DAY));
    expect(ios.pending.get(id(DAY))!.content.title).toContain('850');

    real.read.mockResolvedValue({ data: null, error: new Error('offline') });
    expect(await real.useFuelStore.getState().copyToToday([log(850, 40)], null)).toBe(true);
    expect(real.copy).toHaveBeenCalledOnce();
    await settle();
    expect(pendingIds()).not.toContain(id(DAY));
    await act(async () => { visible?.(); });
    await settle();
    expect(pendingIds()).not.toContain(id(DAY));

    // A later successful read can schedule from its new shortfall.
    real.read.mockResolvedValue({ data: [log(2100, 140)], error: null });
    await real.useFuelStore.getState().refresh();
    await settle();
    expect(ios.pending.get(id(DAY))!.content.title).toContain('700');
    expect(ios.pending.get(id(DAY))!.content.title).not.toContain('850');
  });
});
