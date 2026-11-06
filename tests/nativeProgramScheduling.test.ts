// @vitest-environment happy-dom
import type { User } from '@supabase/supabase-js';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const backend = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: backend.updateUser } } }));

import * as adaptiveHook from '@/hooks/useAdaptiveSplitScheduling';
import * as adaptive from '@/lib/adaptiveSplitScheduling';
import * as programSummary from '@/lib/programSummary';
import { useAuthStore } from '@/stores/authStore';
import type { Split } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Adaptive scheduling moved from You to the Program screen
// (native/src/app/(tabs)/train/program.tsx), beside the training mode it
// refines. It keeps its account setting (adaptive_split_scheduling in the
// user's metadata), its VoiceOver label and its note.

type ToggleSeen = { label: string; detail?: string; value: boolean; disabled?: boolean; list?: boolean; onChange: (next: boolean) => void };
type NoteSeen = { alert: boolean; text: string };

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const noop = () => {};

const program = {
  id: 'split-1',
  name: 'Push Pull',
  is_active: true,
  days: [{ id: 'day-1', split_id: 'split-1', day_name: 'Push', day_order: 0, exercises: [] }],
} as unknown as Split;

const app = create(() => ({
  splits: [program] as Split[],
  workoutMode: 'split' as 'split' | 'flexible',
  currentWorkout: null as { id: string; completed: boolean } | null,
  flexTemplates: [],
  setWorkoutMode: vi.fn(async () => ({ ok: true })),
  fetchSplits: vi.fn(async () => {}),
  fetchWorkoutMode: vi.fn(async () => {}),
  fetchCurrentWorkout: vi.fn(async () => {}),
  fetchFlexTemplates: vi.fn(async () => {}),
  deleteFlexTemplate: vi.fn(async () => {}),
}));

const haptics = { tap: vi.fn(), select: vi.fn(), success: vi.fn(), error: vi.fn() };
const newProgram = vi.fn();
type HeaderItem = { type: string; label: string; icon?: { type: string; name: string }; onPress: () => void };
// The bar's options, as the screen last set them.
let screenOptions: { unstable_headerRightItems?: () => HeaderItem[] } | undefined;
// What the screen draws, in order: rows by title, the switch by its label.
let drawn: string[] = [];
let toggles: ToggleSeen[] = [];
let notes: NoteSeen[] = [];

function load() {
  const text = ({ children }: PropsWithChildren) => createElement('span', null, children);
  return loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/train/program.tsx', {
    '@expo/ui/swift-ui': { Host: Wrap, Picker: Wrap, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: noop, tag: noop },
    'expo-router': {
      router: { push: noop },
      Stack: { Screen: ({ options }: { options: typeof screenOptions }) => { screenOptions = options; return null; } },
    },
    'react-native': { Alert: { alert: vi.fn() }, RefreshControl: () => null, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/hooks/useAdaptiveSplitScheduling': adaptiveHook,
    '@/lib/adaptiveSplitScheduling': adaptive,
    '@/lib/programSummary': programSummary,
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore },
    '@/types': {},
    '~/components/BlancText': { BlancText: text },
    '~/components/Capsule': { Capsule: () => null },
    '~/components/Form': {
      ToggleRow: (props: ToggleSeen) => {
        toggles.push(props);
        drawn.push(`switch: ${props.label}`);
        return null;
      },
      FormNote: ({ alert, children }: PropsWithChildren<{ alert?: boolean }>) => {
        notes.push({ alert: Boolean(alert), text: String(children) });
        return null;
      },
    },
    '~/components/HoldMenu': { showActionSheet: noop },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': {
      Hairline: () => null,
      Row: ({ title }: { title: string }) => {
        drawn.push(`row: ${title}`);
        return null;
      },
    },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics },
    '~/lib/motion': { rowEnter: null, rowExit: null, rowLayout: null },
    '~/lib/program': {
      deleteProgram: vi.fn(async () => true),
      editProgram: noop,
      newProgram,
      planTarget: () => '',
      renameQuickStart: noop,
      setActiveProgram: vi.fn(async () => false),
      startQuickStart: vi.fn(async () => {}),
      useDeletingPrograms: create(() => ({ ids: new Set<string>() })),
    },
    '~/theme/blanc': { space: { gutter: 20, inset: 16, section: 32 }, useBlanc: () => ({ label: '#fff' }) },
  }, { compile: true }).default;
}

let root: Root;
let host: HTMLDivElement;

async function render() {
  drawn = [];
  toggles = [];
  notes = [];
  await act(async () => { root.render(createElement(load())); });
}

const NOTE = 'Upcoming workouts follow the program days you complete. Off uses your saved schedule.';
const lastToggle = () => toggles.at(-1);

beforeEach(() => {
  backend.updateUser.mockReset();
  newProgram.mockClear();
  screenOptions = undefined;
  Object.values(haptics).forEach((fn) => fn.mockClear());
  useAuthStore.setState({ user: { id: 'user-a', user_metadata: {} } as unknown as User, session: null });
  app.setState({ splits: [program], workoutMode: 'split', currentWorkout: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('Adaptive scheduling on Program', () => {
  it('follows the programs in Program days, on by default, with its note and the same VoiceOver label', async () => {
    await render();
    expect(lastToggle()).toMatchObject({ label: 'Adaptive scheduling', value: true, disabled: false, list: true });
    // ToggleRow names the switch by its label alone, as it did on You.
    expect(lastToggle()?.detail).toBeUndefined();
    expect(notes.at(-1)).toEqual({ alert: false, text: NOTE });
    expect(drawn.indexOf('row: Push Pull')).toBeLessThan(drawn.indexOf('switch: Adaptive scheduling'));
  });

  it('saves the same account setting when switched, and shows the saved choice', async () => {
    backend.updateUser.mockResolvedValue({ data: { user: { id: 'user-a', user_metadata: { adaptive_split_scheduling: false } } }, error: null });
    await render();
    await act(async () => { lastToggle()!.onChange(false); });
    expect(backend.updateUser).toHaveBeenCalledWith({ data: { adaptive_split_scheduling: false } });
    expect(adaptive.isAdaptiveSplitSchedulingEnabled(useAuthStore.getState().user)).toBe(false);
    expect(lastToggle()).toMatchObject({ value: false, disabled: false });
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(notes.at(-1)).toEqual({ alert: false, text: NOTE });
  });

  it('says when the save failed and keeps the previous choice', async () => {
    backend.updateUser.mockResolvedValue({ data: { user: null }, error: new Error('offline') });
    await render();
    await act(async () => { lastToggle()!.onChange(false); });
    expect(lastToggle()).toMatchObject({ value: true, disabled: false });
    expect(haptics.error).toHaveBeenCalledTimes(1);
    expect(notes.at(-1)).toEqual({ alert: true, text: 'Couldn’t save this setting. Your previous choice is still active.' });
  });

  it('sits right after the locked training mode during a workout, and can still be switched', async () => {
    app.setState({ currentWorkout: { id: 'workout-1', completed: false } });
    await render();
    const mode = drawn.indexOf('row: Training mode');
    expect(mode).toBeGreaterThan(drawn.indexOf('row: Push Pull'));
    expect(drawn[mode + 1]).toBe('switch: Adaptive scheduling');
    expect(lastToggle()?.disabled).toBe(false);
  });

  it('is left out where nothing is scheduled: flexible sessions, or no program yet', async () => {
    app.setState({ workoutMode: 'flexible' });
    await render();
    expect(toggles).toEqual([]);

    await act(async () => { app.setState({ workoutMode: 'split', splits: [] }); });
    await render();
    expect(toggles).toEqual([]);
  });
});

describe("Program's bar button", () => {
  it('is a bare + that VoiceOver names New program (the bar item\'s title), and makes one', async () => {
    await render();
    const items = screenOptions!.unstable_headerRightItems!();
    expect(items).toHaveLength(1);
    // The label is the bar item's title: iOS draws the symbol alone and VoiceOver reads the title.
    expect(items[0]).toMatchObject({ type: 'button', label: 'New program', icon: { type: 'sfSymbol', name: 'plus' } });
    items[0].onPress();
    expect(newProgram).toHaveBeenCalledTimes(1);
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it('is not there in Flexible, which makes no programs', async () => {
    app.setState({ workoutMode: 'flexible' });
    await render();
    expect(screenOptions!.unstable_headerRightItems!()).toEqual([]);
  });
});
