// Snap a meal, Log food and Train asked for from outside the app: the Snap a
// meal control (Control Center, the lock screen, the Action button), App
// Shortcuts (Shortcuts, Spotlight, Siri) and the Home Screen quick actions.
// iOS keeps the press in modules/hyper-launch until the app takes it
// (lib/launch.ts). This module decides what a press opens, makes sure it runs
// once, and decides what an open Log food sheet does with it. Pure, so tests
// can check it.
//
// JavaScript can post a press too (a notification tap, a scripted dev launch):
// postLaunchPress(action), or receiveLaunchPress with an untyped value. It then
// runs exactly as one from iOS would.
import { create } from 'zustand';

/** Mirrors HyperLaunchAction (modules/hyper-launch/ios/HyperLaunchStore.swift). */
export const LAUNCH_ACTIONS = ['snap-meal', 'log-food', 'train'] as const;
export type LaunchAction = (typeof LAUNCH_ACTIONS)[number];
export type LaunchPress = { action: LaunchAction; atMs: number };

/** How long a press keeps: through a slow cold launch or the offline wait, never into a later visit. */
export const LAUNCH_PRESS_TTL_MS = 60_000;
/** A press stamped a moment ahead of this clock still counts. */
const CLOCK_SLACK_MS = 5_000;
/** A Log food sheet just asked for counts as on top until the stack shows it, at most this long. */
export const LOG_FOOD_OPENING_MS = 1_500;
/** What VoiceOver hears when a press can't open what it names; an error haptic goes with it. */
export const PRESS_REFUSED = 'Finish what’s open, then try again.';

export function parseLaunchPress(raw: unknown): LaunchPress | null {
  if (!raw || typeof raw !== 'object') return null;
  const { action, atMs } = raw as { action?: unknown; atMs?: unknown };
  if (typeof action !== 'string' || !(LAUNCH_ACTIONS as readonly string[]).includes(action)) return null;
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;
  return { action: action as LaunchAction, atMs };
}

export const isFreshPress = (press: LaunchPress, now: number) =>
  now - press.atMs <= LAUNCH_PRESS_TTL_MS && press.atMs - now <= CLOCK_SLACK_MS;

export type LaunchStep =
  | { kind: 'wait' } // the signed-in tabs are not in the stack yet: keep the press
  | { kind: 'none' } // what it names is already in front
  | { kind: 'refused' } // something open covers it; nothing is closed
  | { kind: 'open-log-food'; camera: boolean }
  | { kind: 'logger-camera' } // the Log food sheet on top decides (sheetSnap)
  | { kind: 'train' };

type NavStack = { index?: number; routes: readonly { name: string; state?: unknown }[] };
const asStack = (value: unknown): NavStack | null =>
  value && typeof value === 'object' && Array.isArray((value as NavStack).routes) ? (value as NavStack) : null;

/** The root layout's stack, bottom to top. expo-router wraps it in a `__root` route. */
export function rootStack(state: unknown): string[] {
  let stack = asStack(state);
  const root = stack?.routes.find((route) => route.name === '__root');
  if (root) stack = asStack(root.state);
  if (!stack) return [];
  const top = typeof stack.index === 'number' ? stack.index : stack.routes.length - 1;
  return stack.routes.slice(0, top + 1).map((route) => route.name);
}

/** Where a press goes. A sheet or screen already open is never closed. */
export function planLaunch(action: LaunchAction, stack: readonly string[]): LaunchStep {
  if (!stack.includes('(tabs)')) return { kind: 'wait' };
  const top = stack[stack.length - 1];
  if (action === 'train') return top === '(tabs)' ? { kind: 'train' } : { kind: 'refused' };
  if (top === 'log-food') return action === 'snap-meal' ? { kind: 'logger-camera' } : { kind: 'none' };
  // Log food under another sheet: one Log food sheet at a time, and the sheet on top stays.
  if (stack.includes('log-food')) return { kind: 'refused' };
  return { kind: 'open-log-food', camera: action === 'snap-meal' };
}

type LaunchState = {
  /** The press not yet run. */
  press: LaunchPress | null;
  /** The launch intro is on screen (the root layout says when it is gone). */
  held: boolean;
  /** Counts Snap a meal presses handed to an open Log food sheet. */
  cameraAsks: number;
  /** When a press last asked for a Log food sheet (0: none waiting to show). */
  openingAt: number;
};
export const useLaunchStore = create<LaunchState>(() => ({ press: null, held: true, cameraAsks: 0, openingAt: 0 }));

/**
 * Keeps a press (from iOS, or any value shaped `{ action, atMs }`); a newer one
 * replaces one not yet run. A malformed, unknown or stale value is ignored.
 */
export function receiveLaunchPress(raw: unknown, now = Date.now()): boolean {
  const press = parseLaunchPress(raw);
  if (!press || !isFreshPress(press, now)) return false;
  const current = useLaunchStore.getState().press;
  if (current && current.atMs > press.atMs) return false;
  useLaunchStore.setState({ press });
  return true;
}

/**
 * The entry point for JavaScript (a notification tap, for example): a press of
 * `action` now, run once the app is up, exactly as a press from iOS.
 */
export function postLaunchPress(action: LaunchAction, now = Date.now()): boolean {
  return receiveLaunchPress({ action, atMs: now }, now);
}

export function dropLaunchPress(): void {
  if (useLaunchStore.getState().press) useLaunchStore.setState({ press: null });
}

/** The waiting press's step, at most once: any step except wait clears the press first. */
export function takeLaunchStep(stack: readonly string[], now = Date.now()): LaunchStep {
  const { press, openingAt } = useLaunchStore.getState();
  if (!press) return { kind: 'none' };
  if (!isFreshPress(press, now)) {
    useLaunchStore.setState({ press: null });
    return { kind: 'none' };
  }
  // router.push is queued: a sheet asked for a moment ago is not in the stack yet.
  const shown = stack.includes('log-food');
  const opening = !shown && openingAt > 0 && now - openingAt < LOG_FOOD_OPENING_MS;
  const step = planLaunch(press.action, opening ? [...stack, 'log-food'] : stack);
  if (step.kind === 'wait') return step;
  useLaunchStore.setState({ press: null, openingAt: step.kind === 'open-log-food' ? now : shown ? 0 : openingAt });
  return step;
}

/** Snap a meal while the Log food sheet is on top: the sheet decides (log-food.tsx). */
export function askLoggerCamera(): void {
  useLaunchStore.setState((state) => ({ cameraAsks: state.cameraAsks + 1 }));
}

/** An open Log food sheet's answer to Snap a meal. */
export type SheetSnap = 'join' | 'restart' | 'refuse' | 'ignore';
export type SheetState = {
  /** Not editing an entry, changing a saved meal or saving logged foods as a meal. */
  newEntry: boolean;
  /** The camera, the photo library, the camera prompt or Add photo's choices are already up. */
  pickerUp: boolean;
  /** Closing, a lookup running, a food under review, a meal being built or reviewed, Scan open, or text in Manual's Describe with AI. */
  occupied: boolean;
  /** Closing would ask first (the leave guard's rule). */
  holdsWork: boolean;
  /** The analysis tab can take a photo, and holds the only work (a description or one photo). */
  analysisDraftOnly: boolean;
  /** Logs to today, with its When untouched by the person or by Fuel. */
  forNow: boolean;
};

export function sheetSnap(sheet: SheetState): SheetSnap {
  // A camera or the library is already in front of him: nothing to add.
  if (sheet.pickerUp) return 'ignore';
  if (!sheet.newEntry || sheet.occupied) return 'refuse';
  // Nothing to lose: log now, from a fresh start if the sheet is for another day, meal or time.
  if (!sheet.holdsWork) return sheet.forNow ? 'join' : 'restart';
  // A description (or one photo) waiting for its estimate: the photo joins it.
  return sheet.forNow && sheet.analysisDraftOnly ? 'join' : 'refuse';
}
