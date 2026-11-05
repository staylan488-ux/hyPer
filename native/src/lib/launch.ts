// Presses from outside the app (lib/launchActions.ts), wired to iOS, the app's
// life cycle and the router.
import { router, useNavigationContainerRef } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { AuthScreen } from '@/lib/authScreen';

import { addLaunchActionListener, takePendingAction } from '../../modules/hyper-launch';
import { announce } from './accessibility';
import { haptics } from './haptics';
import {
  askLoggerCamera,
  dropLaunchPress,
  PRESS_REFUSED,
  receiveLaunchPress,
  rootStack,
  takeLaunchStep,
  useLaunchStore,
  type LaunchStep,
} from './launchActions';

/** Moves a press iOS is keeping into the app. */
export function takeNativeLaunch(): void {
  receiveLaunchPress(takePendingAction());
}

/** A press is waiting: the root layout leaves the launch intro out for it. */
export const launchWaiting = (): boolean => useLaunchStore.getState().press !== null;

/** A press that can't open what it names: one error haptic, and a line for VoiceOver. Nothing on screen changes. */
export function refusePress(): void {
  haptics.error();
  announce(PRESS_REFUSED);
}

/**
 * Root layout: hears presses while the app runs (the module's event, every
 * return to the front), holds them while the intro is up, and drops one when
 * the app is left or sign-in is needed. Returns true while a press waits
 * behind the intro (hurry it).
 */
export function useLaunchActions(screen: AuthScreen, introDone: boolean): boolean {
  useEffect(() => {
    // Listen first, then take: a press posted in between is read by one or the other.
    const pressed = addLaunchActionListener(takeNativeLaunch);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') takeNativeLaunch();
      // A press belongs to the visit it opened: leaving the app drops one not yet run.
      else if (state === 'background') dropLaunchPress();
    });
    takeNativeLaunch();
    return () => {
      pressed.remove();
      appState.remove();
    };
  }, []);
  useEffect(() => {
    useLaunchStore.setState({ held: !introDone });
  }, [introDone]);
  const waiting = useLaunchStore((state) => state.press !== null);
  useEffect(() => {
    // Signed out: the press opens sign-in and is forgotten.
    if (waiting && screen === 'sign-in') dropLaunchPress();
  }, [waiting, screen]);
  return waiting && !introDone;
}

/** Tab layout (the signed-in app): runs a waiting press once, when the app is up and active. */
export function useLaunchActionRunner(): void {
  const navigation = useNavigationContainerRef();
  const waiting = useLaunchStore((state) => state.press !== null);
  const held = useLaunchStore((state) => state.held);
  // Active only: never under Control Center, Siri or the Face ID sheet.
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    setActive(AppState.currentState === 'active');
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!waiting || held || !active) return;
    const attempt = () => {
      const step = takeLaunchStep(rootStack(navigation.isReady() ? navigation.getRootState() : undefined));
      if (step.kind === 'wait') return false;
      // After this frame: the tabs (or whatever is on top) finish drawing first.
      if (step.kind !== 'none') requestAnimationFrame(() => runLaunchStep(step));
      return true;
    };
    if (attempt()) return;
    // The tabs are not in the stack yet: look again after the next navigation.
    return navigation.addListener('state', () => {
      attempt();
    });
  }, [waiting, held, active, navigation]);
}

function runLaunchStep(step: LaunchStep): void {
  if (step.kind === 'open-log-food') router.push(step.camera ? { pathname: '/log-food', params: { start: 'camera', atMs: String(step.atMs) } } : '/log-food');
  else if (step.kind === 'logger-camera') askLoggerCamera(step.atMs);
  // The same call as the workout bar, Today's Open workout and PlanCard.
  else if (step.kind === 'train') router.navigate('/train');
  else if (step.kind === 'refused') refusePress();
}
