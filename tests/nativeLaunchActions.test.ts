import { beforeEach, describe, expect, it } from 'vitest';

import * as launch from '../native/src/lib/launchActions';

// Snap a meal, Log food and Train pressed outside the app: what a press opens,
// that it runs once, and what an open Log food sheet does with Snap a meal.

const T = 1_000_000;
const press = (action: launch.LaunchAction, atMs = T) => ({ action, atMs });

beforeEach(() => {
  launch.useLaunchStore.setState({ press: null, held: true, cameraAsks: 0, openingAt: 0 });
});

describe('parseLaunchPress', () => {
  it('accepts a press iOS kept', () => {
    expect(launch.parseLaunchPress({ action: 'snap-meal', atMs: 1 })).toEqual({ action: 'snap-meal', atMs: 1 });
  });

  it.each([null, {}, { action: 'start-workout', atMs: 1 }, { action: 'train', atMs: '1' }, { action: 'train', atMs: NaN }, { action: 'train', atMs: Infinity }])(
    'rejects %o',
    (raw) => {
      expect(launch.parseLaunchPress(raw)).toBeNull();
    },
  );
});

describe('isFreshPress', () => {
  it('keeps a press for a minute and allows a clock a little behind', () => {
    const at = press('train');
    expect(launch.isFreshPress(at, T)).toBe(true);
    expect(launch.isFreshPress(at, T + launch.LAUNCH_PRESS_TTL_MS)).toBe(true);
    expect(launch.isFreshPress(at, T + launch.LAUNCH_PRESS_TTL_MS + 1)).toBe(false);
    expect(launch.isFreshPress(at, T - 5_000)).toBe(true);
    expect(launch.isFreshPress(at, T - 6_000)).toBe(false);
  });
});

describe('snapMealDate', () => {
  it('accepts route strings and camera-request numbers within the press window', () => {
    expect(launch.snapMealDate(String(T - 20_000), T).getTime()).toBe(T - 20_000);
    expect(launch.snapMealDate(T + 5_000, T).getTime()).toBe(T + 5_000);
  });

  it.each([undefined, null, '', 'nonsense', NaN, Infinity, T - 60_001, T + 5_001])('uses now for missing or implausible timestamp %s', (raw) => {
    expect(launch.snapMealDate(raw, T).getTime()).toBe(T);
  });
});

describe('receiveLaunchPress', () => {
  it('keeps a fresh press and ignores a stale one', () => {
    expect(launch.receiveLaunchPress(press('train', T - 61_000), T)).toBe(false);
    expect(launch.useLaunchStore.getState().press).toBeNull();
    expect(launch.receiveLaunchPress(press('train'), T)).toBe(true);
    expect(launch.useLaunchStore.getState().press).toEqual(press('train'));
  });

  it('lets a newer press replace an older one, never the reverse', () => {
    launch.receiveLaunchPress(press('log-food', T), T);
    expect(launch.receiveLaunchPress(press('snap-meal', T + 10), T + 10)).toBe(true);
    expect(launch.receiveLaunchPress(press('train', T + 5), T + 10)).toBe(false);
    expect(launch.useLaunchStore.getState().press).toEqual(press('snap-meal', T + 10));
  });

  it('ignores the empty value the module returns with nothing kept', () => {
    expect(launch.receiveLaunchPress({}, T)).toBe(false);
    expect(launch.receiveLaunchPress(null, T)).toBe(false);
    expect(launch.useLaunchStore.getState().press).toBeNull();
  });

  it('takes a press from JavaScript, stamped now', () => {
    expect(launch.postLaunchPress('log-food', T)).toBe(true);
    expect(launch.useLaunchStore.getState().press).toEqual(press('log-food', T));
  });
});

describe('rootStack', () => {
  const routes = [{ name: '(tabs)' }, { name: 'log-food' }];

  it('reads the root layout through expo-router’s wrapper, or without it', () => {
    expect(launch.rootStack({ routes: [{ name: '__root', state: { index: 1, routes } }] })).toEqual(['(tabs)', 'log-food']);
    expect(launch.rootStack({ index: 1, routes })).toEqual(['(tabs)', 'log-food']);
  });

  it('uses the last route without an index, and cuts routes past the index', () => {
    expect(launch.rootStack({ routes })).toEqual(['(tabs)', 'log-food']);
    expect(launch.rootStack({ index: 0, routes })).toEqual(['(tabs)']);
  });

  it.each([undefined, null, 'tabs', {}, { routes: 'x' }, { routes: [{ name: '__root' }] }])('gives nothing for %o', (state) => {
    expect(launch.rootStack(state)).toEqual([]);
  });
});

describe('planLaunch', () => {
  it.each([[['(tabs)']], [['(tabs)', 'movement']], [['(tabs)', 'run']]])('opens Log food with the camera over %o', (stack) => {
    expect(launch.planLaunch('snap-meal', stack)).toEqual({ kind: 'open-log-food', camera: true });
  });

  it('hands Snap a meal to a Log food sheet on top, and refuses one under another sheet', () => {
    expect(launch.planLaunch('snap-meal', ['(tabs)', 'log-food'])).toEqual({ kind: 'logger-camera' });
    expect(launch.planLaunch('snap-meal', ['(tabs)', 'log-food', 'saved-meal'])).toEqual({ kind: 'refused' });
  });

  it('opens Log food on Recent unless one is open', () => {
    expect(launch.planLaunch('log-food', ['(tabs)'])).toEqual({ kind: 'open-log-food', camera: false });
    expect(launch.planLaunch('log-food', ['(tabs)', 'log-food'])).toEqual({ kind: 'none' });
    expect(launch.planLaunch('log-food', ['(tabs)', 'log-food', 'saved-meal'])).toEqual({ kind: 'refused' });
  });

  it('switches to Train only when nothing covers the tabs', () => {
    expect(launch.planLaunch('train', ['(tabs)'])).toEqual({ kind: 'train' });
    expect(launch.planLaunch('train', ['(tabs)', 'run'])).toEqual({ kind: 'refused' });
    expect(launch.planLaunch('train', ['(tabs)', 'log-food'])).toEqual({ kind: 'refused' });
  });

  it('opens Fuel for a reminder that names close-the-gap picks, only when nothing covers the tabs', () => {
    expect(launch.planLaunch('fuel', ['(tabs)'])).toEqual({ kind: 'fuel' });
    expect(launch.planLaunch('fuel', ['(tabs)', 'log-food'])).toEqual({ kind: 'refused' });
    expect(launch.planLaunch('fuel', ['sign-in'])).toEqual({ kind: 'wait' });
    // Posted by JavaScript only: not one of iOS's actions, but a press like them.
    expect(launch.LAUNCH_ACTIONS).not.toContain('fuel');
    expect(launch.parseLaunchPress({ action: 'fuel', atMs: 1 })).toEqual({ action: 'fuel', atMs: 1 });
  });

  it.each(launch.LAUNCH_ACTIONS.flatMap((action) => [[], ['index'], ['sign-in'], ['offline']].map((stack) => [action, stack] as const)))(
    'waits with %s over %o',
    (action, stack) => {
      expect(launch.planLaunch(action, stack)).toEqual({ kind: 'wait' });
    },
  );
});

describe('takeLaunchStep', () => {
  it('runs a press once', () => {
    launch.receiveLaunchPress(press('train'), T);
    expect(launch.takeLaunchStep(['(tabs)'], T)).toEqual({ kind: 'train' });
    expect(launch.useLaunchStore.getState().press).toBeNull();
    expect(launch.takeLaunchStep(['(tabs)'], T)).toEqual({ kind: 'none' });
  });

  it('keeps the press while it waits for the tabs', () => {
    launch.receiveLaunchPress(press('train'), T);
    expect(launch.takeLaunchStep(['index'], T)).toEqual({ kind: 'wait' });
    expect(launch.useLaunchStore.getState().press).toEqual(press('train'));
  });

  it('clears a stale press, and has nothing to do without one', () => {
    launch.receiveLaunchPress(press('train'), T);
    expect(launch.takeLaunchStep(['(tabs)'], T + 61_000)).toEqual({ kind: 'none' });
    expect(launch.useLaunchStore.getState().press).toBeNull();
    expect(launch.takeLaunchStep(['(tabs)'], T)).toEqual({ kind: 'none' });
  });

  it('counts a Log food sheet just asked for as on top until it shows', () => {
    launch.receiveLaunchPress(press('snap-meal', T), T);
    expect(launch.takeLaunchStep(['(tabs)'], T)).toEqual({ kind: 'open-log-food', camera: true, atMs: T });
    expect(launch.useLaunchStore.getState().openingAt).toBe(T);

    launch.receiveLaunchPress(press('snap-meal', T + 300), T + 300);
    expect(launch.takeLaunchStep(['(tabs)'], T + 300)).toEqual({ kind: 'logger-camera', atMs: T + 300 });
    launch.receiveLaunchPress(press('log-food', T + 400), T + 400);
    expect(launch.takeLaunchStep(['(tabs)'], T + 400)).toEqual({ kind: 'none' });

    launch.receiveLaunchPress(press('snap-meal', T + 1_600), T + 1_600);
    expect(launch.takeLaunchStep(['(tabs)'], T + 1_600)).toEqual({ kind: 'open-log-food', camera: true, atMs: T + 1_600 });
  });

  it('closes the window once the stack shows the sheet', () => {
    launch.receiveLaunchPress(press('snap-meal', T), T);
    launch.takeLaunchStep(['(tabs)'], T);
    launch.receiveLaunchPress(press('snap-meal', T + 200), T + 200);
    expect(launch.takeLaunchStep(['(tabs)', 'log-food'], T + 200)).toEqual({ kind: 'logger-camera', atMs: T + 200 });
    expect(launch.useLaunchStore.getState().openingAt).toBe(0);
  });
});

describe('the press store', () => {
  it('counts camera asks and drops a press', () => {
    launch.askLoggerCamera();
    launch.askLoggerCamera();
    expect(launch.useLaunchStore.getState().cameraAsks).toBe(2);
    launch.receiveLaunchPress(press('train'), T);
    launch.dropLaunchPress();
    expect(launch.useLaunchStore.getState().press).toBeNull();
  });
});

describe('sheetSnap', () => {
  const sheet = (patch: Partial<launch.SheetState> = {}): launch.SheetState => ({
    newEntry: true,
    pickerUp: false,
    occupied: false,
    holdsWork: false,
    analysisDraftOnly: true,
    forNow: true,
    ...patch,
  });

  it('does nothing while a picker is up, even over an edit', () => {
    expect(launch.sheetSnap(sheet({ pickerUp: true }))).toBe('ignore');
    expect(launch.sheetSnap(sheet({ pickerUp: true, newEntry: false }))).toBe('ignore');
  });

  it('refuses an edit or a busy sheet', () => {
    expect(launch.sheetSnap(sheet({ newEntry: false }))).toBe('refuse');
    expect(launch.sheetSnap(sheet({ occupied: true }))).toBe('refuse');
  });

  it('joins a sheet holding nothing for now, and starts one for another day, meal or time over', () => {
    expect(launch.sheetSnap(sheet())).toBe('join');
    expect(launch.sheetSnap(sheet({ forNow: false }))).toBe('restart');
  });

  it('joins work only when it is a description for now waiting for its estimate', () => {
    expect(launch.sheetSnap(sheet({ holdsWork: true }))).toBe('join');
    expect(launch.sheetSnap(sheet({ holdsWork: true, analysisDraftOnly: false }))).toBe('refuse');
    expect(launch.sheetSnap(sheet({ holdsWork: true, forNow: false }))).toBe('refuse');
  });
});
