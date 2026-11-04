// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as runDisplay from '@/lib/runDisplay';
import * as runTracker from '@/lib/runTracker';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Start asks for location on the run screen. Without Precise Location every
// fix is a kilometre or more out and the run never locks, so Start says so
// there, with the way to Settings, instead of starting a run that cannot count.

type Permission = { location: string; precise?: boolean; motionAvailable?: boolean };

const box = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
const tracker = {
  state: null,
  finishedRun: null as runTracker.FinishedRun | null,
  nowMs: 0,
  gpsError: null,
  resumable: false,
  paused: false,
  resting: false,
  start: vi.fn(),
  resume: vi.fn(),
  split: vi.fn(),
  toggleRest: vi.fn(),
  finish: vi.fn(),
  discard: vi.fn(),
};
const requestPermissions = vi.fn<() => Promise<Permission>>();
const openSettings = vi.fn();
const router = { dismiss: vi.fn(), navigate: vi.fn() };
const saveTrackedRun = vi.fn<(run: runTracker.FinishedRun) => Promise<{ id: string } | null>>();
const loadHistoryMonth = vi.fn<() => Promise<void>>();

let root: Root;
let host: HTMLDivElement;

async function renderRunScreen() {
  const { default: RunScreen } = loadNativeModule<{ default: () => ReactNode }>('app/run.tsx', {
    '@expo/ui/swift-ui': { Host: box, Picker: box, Text: box },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: () => null, tag: () => null, tint: () => null },
    'date-fns': { format: () => '' },
    'expo-router': { router },
    'react-native': {
      ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
      Alert: { alert: vi.fn() },
      Linking: { openSettings },
      Pressable: box,
      ScrollView: box,
      StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {} },
      View: box,
    },
    'react-native-keyboard-controller': { KeyboardStickyView: box },
    'react-native-reanimated': {
      default: { View: box },
      Easing: { linear: () => 0 },
      useAnimatedStyle: () => ({}),
      useSharedValue: (value: number) => ({ value }),
      withTiming: (value: number) => value,
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@/hooks/useRunTracker': { createSimulatedSource: vi.fn(), useRunTracker: () => tracker },
    '@/lib/gpsScenarios': { gpsScenarios: [] },
    '@/lib/nativeBridge': { NativeRun: { requestPermissions, syncLiveActivity: vi.fn(async () => undefined) } },
    '@/lib/runDisplay': runDisplay,
    '@/lib/runTracker': runTracker,
    '@/stores/appStore': { useAppStore: { getState: () => ({ saveTrackedRun }) } },
    '~/components/BlancText': { BlancText: ({ children }: { children?: ReactNode }) => createElement('p', null, children) },
    '~/components/Capsule': {
      Capsule: ({ title, onPress }: { title: string; onPress?: () => void }) => createElement('button', { onClick: onPress }, title),
    },
    '~/components/Form': { FieldRow: () => null, FormNote: ({ children }: { children?: ReactNode }) => createElement('p', null, children) },
    '~/components/GlassButton': { GlassButton: () => null },
    '~/components/Label': { Label: box },
    '~/components/Row': { Hairline: () => null, Row: () => null },
    '~/components/Section': { Section: box },
    '~/lib/haptics': { haptics: { error: vi.fn(), select: vi.fn(), success: vi.fn(), tap: vi.fn() } },
    '~/lib/history': { loadHistoryMonth },
    '~/platform/previewFlag': { isPreviewActive: () => false },
    '~/theme/blanc': { space: { gutter: 16, inset: 16 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(RunScreen)); });
}

function button(title: string) {
  return [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === title);
}

async function pressStart(permission: Permission) {
  requestPermissions.mockResolvedValue(permission);
  await act(async () => { button('Start run')!.click(); });
}

describe('starting a run asks for location', () => {
  beforeEach(async () => {
    tracker.finishedRun = null;
    tracker.start.mockReset();
    requestPermissions.mockReset();
    openSettings.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await renderRunScreen();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('stops with the way to Settings when Precise Location is off', async () => {
    await pressStart({ location: 'whenInUse', precise: false, motionAvailable: true });

    expect(tracker.start).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Location is approximate for hyPer. Allow it, with Precise Location, to track runs.');
    await act(async () => { button('Open Settings')!.click(); });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('still says location is off when it is refused', async () => {
    await pressStart({ location: 'denied', precise: false, motionAvailable: true });

    expect(tracker.start).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Location is off for hyPer. Allow it, with Precise Location, to track runs.');
  });

  it('starts with Precise Location on, or when the device does not say', async () => {
    await pressStart({ location: 'whenInUse', precise: true, motionAvailable: true });
    expect(tracker.start).toHaveBeenCalledTimes(1);

    await pressStart({ location: 'always' });
    expect(tracker.start).toHaveBeenCalledTimes(2);
    expect(button('Open Settings')).toBeUndefined();
  });
});

// History may already be open in Train. Save shows it again without a new
// mount, so the save itself reads History's month and the run is listed.
describe('saving a finished run', () => {
  const run: runTracker.FinishedRun = {
    runId: 'run-1', mode: 'free', startedAtMs: Date.parse('2026-11-04T07:00:00Z'), endedAtMs: Date.parse('2026-11-04T07:30:00Z'),
    totalDistanceM: 5000, elapsedS: 1800, laps: [], reps: [],
  };
  beforeEach(async () => {
    tracker.finishedRun = run;
    saveTrackedRun.mockReset();
    loadHistoryMonth.mockReset().mockResolvedValue();
    router.dismiss.mockReset();
    router.navigate.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await renderRunScreen();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    tracker.finishedRun = null;
  });

  it('reads History’s month again, then opens History', async () => {
    saveTrackedRun.mockResolvedValue({ id: 'activity-1' });
    await act(async () => { button('Save run')!.click(); });

    expect(saveTrackedRun).toHaveBeenCalledWith(run);
    expect(loadHistoryMonth).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/train/history');
  });

  it('reads nothing when the save fails', async () => {
    saveTrackedRun.mockResolvedValue(null);
    await act(async () => { button('Save run')!.click(); });

    expect(loadHistoryMonth).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Could not save the run.');
  });
});
