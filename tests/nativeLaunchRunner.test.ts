// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';

import type * as LaunchActions from '../native/src/lib/launchActions';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Presses from outside the app reach the router once: when the signed-in tabs
// are up, the intro is gone and the app is active. lib/launch.ts runs here with
// its real press rules (lib/launchActions.ts) and mocked iOS, router and app state.

// The real rules on this React (native/'s zustand would bring its own copy).
const launchActions = loadNativeModule<typeof LaunchActions>('lib/launchActions.ts', { zustand });

type AuthScreen = 'boot' | 'offline' | 'sign-in' | 'app';
type Launch = {
  useLaunchActions: (screen: AuthScreen, introDone: boolean) => boolean;
  useLaunchActionRunner: () => void;
  takeNativeLaunch: () => void;
  launchWaiting: () => boolean;
  refusePress: () => void;
};

const push = vi.fn();
const navigate = vi.fn();
const announce = vi.fn();
const error = vi.fn();
const remove = vi.fn();
let rootState: unknown;
const stateListeners = new Set<() => void>();
const nav = {
  isReady: () => true,
  getRootState: () => rootState,
  addListener: (_type: string, callback: () => void) => {
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
  },
};
const appListeners = new Set<(state: string) => void>();
const AppState = {
  currentState: 'active',
  addEventListener: (_type: string, callback: (state: string) => void) => {
    appListeners.add(callback);
    return { remove: () => appListeners.delete(callback) };
  },
};
let nativeQueue: unknown[] = [];
let moduleListener: (() => void) | undefined;
const takePendingAction = vi.fn(() => nativeQueue.shift() ?? {});
const addLaunchActionListener = vi.fn((callback: () => void) => {
  moduleListener = callback;
  return { remove };
});

const launch = loadNativeModule<Launch>('lib/launch.ts', {
  'expo-router': { router: { push, navigate }, useNavigationContainerRef: () => nav },
  'react-native': { AppState, AccessibilityInfo: { announceForAccessibilityWithOptions: announce } },
  '../../modules/hyper-launch': { takePendingAction, addLaunchActionListener },
  './haptics': { haptics: { error } },
  './launchActions': launchActions,
});

const stack = (...names: string[]) => ({ routes: [{ name: '__root', state: { index: names.length - 1, routes: names.map((name) => ({ name })) } }] });
const fresh = (action: LaunchActions.LaunchAction) => ({ action, atMs: Date.now() });
const store = () => launchActions.useLaunchStore.getState();

let hurried: boolean[] = [];
function Root({ screen, introDone }: { screen: AuthScreen; introDone: boolean }) {
  hurried.push(launch.useLaunchActions(screen, introDone));
  return null;
}
function Tabs() {
  launch.useLaunchActionRunner();
  return null;
}
function App({ screen = 'app', introDone = true, tabs = true }: { screen?: AuthScreen; introDone?: boolean; tabs?: boolean }) {
  return createElement('div', null, createElement(Root, { screen, introDone }), tabs ? createElement(Tabs) : null);
}

let root: Root;
const render = async (props: Parameters<typeof App>[0] = {}) => {
  await act(async () => { root.render(createElement(App, props)); });
};
const emitAppState = async (state: string) => {
  await act(async () => {
    AppState.currentState = state;
    appListeners.forEach((listener) => listener(state));
  });
};
const emitNavigation = async () => {
  await act(async () => { stateListeners.forEach((listener) => listener()); });
};

beforeEach(() => {
  launchActions.useLaunchStore.setState({ press: null, held: true, cameraAsks: 0, openingAt: 0 });
  nativeQueue = [];
  moduleListener = undefined;
  hurried = [];
  rootState = stack('(tabs)');
  AppState.currentState = 'active';
  appListeners.clear();
  stateListeners.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0; });
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('useLaunchActionRunner', () => {
  it('opens Log food with the camera once for a press that launched the app', async () => {
    nativeQueue = [fresh('snap-meal')];
    await render();
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith({ pathname: '/log-food', params: { start: 'camera' } });
    await render();
    await render();
    expect(push).toHaveBeenCalledOnce();
    expect(store().press).toBeNull();
  });

  it('listens for presses before it takes the one waiting', async () => {
    await render();
    expect(addLaunchActionListener.mock.invocationCallOrder[0]).toBeLessThan(takePendingAction.mock.invocationCallOrder[0]);
  });

  it('waits for the intro, and hurries it meanwhile', async () => {
    nativeQueue = [fresh('snap-meal')];
    await render({ introDone: false });
    expect(push).not.toHaveBeenCalled();
    expect(hurried.at(-1)).toBe(true);
    await render({ introDone: true });
    expect(push).toHaveBeenCalledOnce();
    expect(hurried.at(-1)).toBe(false);
  });

  it('waits until the app is active, never under Control Center or Face ID', async () => {
    AppState.currentState = 'inactive';
    nativeQueue = [fresh('log-food')];
    await render();
    expect(push).not.toHaveBeenCalled();
    await emitAppState('active');
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('/log-food');
  });

  it('forgets a press when the app is left before it runs', async () => {
    AppState.currentState = 'inactive';
    nativeQueue = [fresh('snap-meal')];
    await render();
    await emitAppState('background');
    expect(store().press).toBeNull();
    await emitAppState('active');
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps a press until the tabs are in the stack', async () => {
    rootState = stack('index');
    nativeQueue = [fresh('snap-meal')];
    await render();
    expect(push).not.toHaveBeenCalled();
    expect(store().press).not.toBeNull();
    rootState = stack('(tabs)');
    await emitNavigation();
    expect(push).toHaveBeenCalledOnce();
    await emitNavigation();
    expect(push).toHaveBeenCalledOnce();
  });

  it('hands Snap a meal to a Log food sheet on top', async () => {
    rootState = stack('(tabs)', 'log-food');
    nativeQueue = [fresh('snap-meal')];
    await render();
    expect(push).not.toHaveBeenCalled();
    expect(store().cameraAsks).toBe(1);
  });

  it('opens one sheet for two quick presses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_000_000);
      await render();
      await act(async () => { launchActions.receiveLaunchPress(fresh('snap-meal')); });
      vi.setSystemTime(1_000_200);
      await act(async () => { launchActions.receiveLaunchPress(fresh('snap-meal')); });
      expect(push).toHaveBeenCalledOnce();
      expect(store().cameraAsks).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses Train while the run screen covers the tabs, and lets the press go', async () => {
    rootState = stack('(tabs)', 'run');
    nativeQueue = [fresh('train')];
    await render();
    expect(navigate).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith(launchActions.PRESS_REFUSED, { queue: true });
    expect(store().press).toBeNull();
  });

  it('switches to Train when nothing covers the tabs', async () => {
    nativeQueue = [fresh('train')];
    await render();
    expect(navigate).toHaveBeenCalledWith('/train');
    expect(error).not.toHaveBeenCalled();
  });
});

describe('useLaunchActions', () => {
  it('takes presses at mount, on the module’s event and on return to the front', async () => {
    await render({ tabs: false });
    expect(takePendingAction).toHaveBeenCalledOnce();
    nativeQueue = [fresh('log-food')];
    await act(async () => { moduleListener!(); });
    expect(store().press?.action).toBe('log-food');
    await act(async () => { launchActions.dropLaunchPress(); });
    nativeQueue = [fresh('train')];
    await emitAppState('active');
    expect(store().press?.action).toBe('train');
    expect(launch.launchWaiting()).toBe(true);
  });

  it('holds presses while the intro is up', async () => {
    await render({ tabs: false, introDone: false });
    expect(store().held).toBe(true);
    await render({ tabs: false, introDone: true });
    expect(store().held).toBe(false);
  });

  it('forgets a press on the sign-in screen', async () => {
    nativeQueue = [fresh('snap-meal')];
    await render({ tabs: false, screen: 'sign-in', introDone: false });
    expect(store().press).toBeNull();
    expect(hurried.at(-1)).toBe(false);
  });

  it('hurries the intro only while a press waits behind it', async () => {
    await render({ tabs: false, introDone: false });
    expect(hurried.at(-1)).toBe(false);
    await act(async () => { launchActions.postLaunchPress('train'); });
    expect(hurried.at(-1)).toBe(true);
    await render({ tabs: false, introDone: true });
    expect(hurried.at(-1)).toBe(false);
  });

  it('stops listening when the root layout goes', async () => {
    await render({ tabs: false });
    await act(async () => root.unmount());
    expect(remove).toHaveBeenCalledOnce();
    expect(appListeners.size).toBe(0);
    root = createRoot(document.createElement('div'));
  });
});
