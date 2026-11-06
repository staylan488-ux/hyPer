// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as movementOrder from '@/lib/movementOrder';
import * as setAutofill from '@/lib/setAutofill';
import type { WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Train's set card (native/src/app/(tabs)/train/index.tsx). Last time's
// figure is written under each field only while it says something new: "last
// 80" under an 80 only repeats the figure, so it hides (keeping its line, so
// the card doesn't move) and comes back once the field is edited away from it.
// The card's notes sit at one quiet level with the set line above them.

type Props = Record<string, unknown> & { children?: ReactNode };

const Box = ({ children }: Props) => createElement('div', null, children);
const Empty = () => null;
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
// An animated view says when it is the one that fades with the scroll (its opacity driven by a shared value).
const AnimatedView = ({ children, style }: Props) =>
  createElement('div', { 'data-fades': 'opacity' in flatten(style) ? 'true' : undefined }, children);
const Text = ({ children, variant, tone, accessibilityLabel, accessibilityElementsHidden, style }: Props) =>
  createElement(
    'span',
    {
      'data-variant': (variant as string | undefined) ?? 'body',
      'data-tone': (tone as string | undefined) ?? 'ink',
      'aria-label': accessibilityLabel as string | undefined,
      'aria-hidden': accessibilityElementsHidden ? 'true' : undefined,
      'data-opacity': (style as { opacity?: number } | undefined)?.opacity,
    },
    children,
  );
/** Each figure field's typing, by its label, to type into from the test. */
const typeInto: Record<string, (text: string) => void> = {};
const FigureInput = ({ value, onChangeText, accessibilityLabel }: Props) => {
  typeInto[accessibilityLabel as string] = onChangeText as (text: string) => void;
  return createElement('span', { 'data-field': accessibilityLabel as string }, value as string);
};

const set = (id: string, setNumber: number, completed: boolean, weight: number | null = null, reps: number | null = null) =>
  ({ id, exercise_id: 'row', set_number: setNumber, weight, reps, rpe: null, completed, exercise: { id: 'row', name: 'Barbell Row', equipment: 'Barbell' } }) as unknown as WorkoutSet;

let previous: setAutofill.PreviousWorkoutSetMap;
let notes: Record<string, { note: string }>;
let note: string | null;
let session: Record<string, unknown>;

/** Barbell Row, set 3 of 3: two logged at 80 × 8, the third filled in from them. */
function liveSession() {
  const sets = [set('s1', 1, true, 80, 8), set('s2', 2, true, 80, 8), set('s3', 3, false)];
  const movement = {
    exerciseId: 'row',
    name: 'Barbell Row',
    sets,
    done: 2,
    plan: { target_reps_min: 8, target_reps_max: 10 },
    superset: null,
    substitutesFor: null,
    note,
    skipped: false,
    endedEarly: false,
  };
  return {
    workoutId: 'w1',
    dayName: 'Upper A',
    flexible: false,
    startedAt: new Date('2026-11-06T00:23:00'),
    sets,
    doneCount: 2,
    movements: [movement],
    current: { movement, set: sets[2], setNumber: 3, index: 2, blocked: null },
  };
}

const { headingShown } = loadNativeModule<{ headingShown: (scrolled: number, span: unknown) => number }>('lib/barTitle.ts', {});
const setEntry = loadNativeModule<Record<string, unknown>>('lib/setEntry.ts', {
  'react-native': { ActionSheetIOS: { showActionSheetWithOptions: vi.fn() } },
  './haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
});

let root: Root;
let host: HTMLDivElement;

async function open() {
  session = liveSession();
  const { default: TrainScreen } = loadNativeModule<{ default: () => ReactNode }>(
    'app/(tabs)/train/index.tsx',
    {
      'expo-router': { router: { push: vi.fn() }, Stack: { Screen: Empty } },
      'expo-symbols': { SymbolView: Empty },
      'date-fns': dates,
      'react-native': {
        Alert: { alert: vi.fn(), prompt: vi.fn() },
        Keyboard: { dismiss: vi.fn() },
        Pressable: Box,
        RefreshControl: Empty,
        ScrollView: Box,
        StyleSheet: { hairlineWidth: 0.5 },
        TextInput: Empty,
        useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
        View: Box,
      },
      'react-native-keyboard-controller': { KeyboardStickyView: Box },
      'react-native-reanimated': {
        default: { View: AnimatedView },
        FadeIn: { duration: () => ({}) },
        FadeOut: { duration: () => ({}) },
        useAnimatedStyle: (style: () => Record<string, unknown>) => style(),
        useSharedValue: (value: number) => ({ value, get: () => value, set: () => undefined }),
      },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) },
      '@/lib/movementOrder': movementOrder,
      '@/lib/setAutofill': setAutofill,
      '@/lib/workoutSessions': { TRAINING_WEEK: { weekStartsOn: 1 } },
      '@/stores/appStore': { useAppStore: create(() => ({ logSet: vi.fn(), currentWorkout: null })) },
      '~/components/BlancText': { BlancText: Text },
      '~/components/Capsule': { Capsule: ({ title }: Props) => createElement('button', null, title as string) },
      '~/components/Chip': { Chip: ({ label }: Props) => createElement('button', null, label as string) },
      '~/components/DragList': { DragList: ({ items }: Props) => createElement(Box, null, ...(items as { node: ReactNode }[]).map((item) => item.node)) },
      '~/components/FigureInput': { FigureInput },
      '~/components/Form': { FormNote: Box },
      '~/components/Label': { Label: Box },
      '~/components/LiveClock': { LiveClock: Empty },
      '~/components/PlanCard': { PlanCard: Empty },
      '~/components/Row': { Hairline: Empty, Row: Empty },
      '~/components/Section': { Section: Box },
      '~/components/SwipeRow': { SwipeRow: Box },
      '~/components/TabScroll': { scrolledFromRest: (offset: number) => offset + 165, TabScroll: Box, tabBarCover: () => 83 },
      '~/components/Tally': { COMPACT_RISE: 6, Tally: Empty },
      '~/components/UndoBar': { UndoBar: Empty },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/accountData': { useAccountDay: () => '2026-11-06', useAccountRefresh: () => ({ refreshing: false, refresh: vi.fn() }) },
      '~/lib/beatLastTime': { gainOnLastTime: () => null },
      '~/lib/barTitle': { headingShown },
      '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish: vi.fn(), closing: false }) },
      '~/lib/workoutBar': { useWorkoutBarShown: create(() => ({ shown: false })) },
      '~/lib/format': format,
      '~/lib/haptics': { haptics: { beat: vi.fn(), error: vi.fn(), select: vi.fn(), success: vi.fn(), tap: vi.fn() } },
      '~/lib/motion': { rowLayout: {} },
      '~/lib/movement': {
        confirmRemoveMovement: vi.fn(),
        errorMessage: () => '',
        renameSession: vi.fn(),
        reorderMovements: vi.fn(),
        setSkipped: vi.fn(),
      },
      '~/lib/rest': { restSecondsFor: () => 90, startRest: vi.fn() },
      '~/lib/session': {
        liveSessionModel: () => session,
        useFocusStore: create(() => ({ exerciseId: null, focus: vi.fn() })),
        usePreviousNotes: () => notes,
        usePreviousTargets: () => previous,
        useSessionModel: () => session,
        useStartSession: () => ({ starting: null, start: vi.fn() }),
      },
      '~/lib/sessionModel': { afterLoggedSet: () => ({ nextExerciseId: null, rest: false }) },
      '~/lib/setEntry': setEntry,
      '~/lib/today': { useFinishedToday: () => undefined, useTodayPlan: () => ({}) },
      '~/platform/devLaunch': { devScrollTrace: { enabled: false } },
      '~/theme/blanc': { space: { gutter: 16, inset: 16, section: 26 }, type: { field: {} }, useBlanc: () => ({}) },
    },
    // Uncompiled: the React Compiler leaves StartFlexible (a try with finally) to run as written.
  );
  await act(async () => {
    root.render(createElement(TrainScreen));
  });
}

/** The two captions under the figures, weight then reps: what is written, what VoiceOver hears, and whether they show. */
const captions = () =>
  [...host.querySelectorAll<HTMLElement>('[data-variant="meta"]')].map((caption) => ({
    text: caption.textContent?.trim() ?? '',
    spoken: caption.getAttribute('aria-label'),
    shown: caption.dataset.opacity === '1' && caption.getAttribute('aria-hidden') !== 'true',
  }));
const type = async (field: 'Weight in pounds' | 'Reps', text: string) => {
  await act(async () => typeInto[field](text));
};
const textNamed = (words: string) => [...host.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent === words);

beforeEach(() => {
  note = null;
  notes = {};
  previous = { row: { 1: { weight: 80, reps: 8, rpe: null }, 2: { weight: 80, reps: 8, rpe: null }, 3: { weight: 80, reps: 8, rpe: null } } };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the "last" captions under Train\'s figures', () => {
  it('hide while the fields hold last time\'s figures, keeping their line', async () => {
    await open();
    expect(host.querySelector('[data-field="Weight in pounds"]')?.textContent).toBe('80');
    expect(host.querySelector('[data-field="Reps"]')?.textContent).toBe('8');
    const [weight, reps] = captions();
    expect(weight).toEqual({ text: '', spoken: null, shown: false });
    expect(reps).toEqual({ text: '', spoken: null, shown: false });
  });

  it('show, and are spoken, while a field differs from last time', async () => {
    previous.row[3] = { weight: 85, reps: 10, rpe: null };
    await open();
    expect(captions()).toEqual([
      { text: 'last 85', spoken: 'Last time, 85 pounds', shown: true },
      { text: 'last 10', spoken: 'Last time, 10 reps', shown: true },
    ]);
  });

  it('come back once a field is edited away from last time, and hide again on return', async () => {
    await open();
    await type('Reps', '9');
    expect(captions()[1]).toEqual({ text: 'last 8', spoken: 'Last time, 8 reps', shown: true });
    // The weight still matches: its caption stays hidden.
    expect(captions()[0].shown).toBe(false);
    await type('Reps', '8');
    expect(captions()[1].shown).toBe(false);
    await type('Weight in pounds', '');
    expect(captions()[0]).toEqual({ text: 'last 80', spoken: 'Last time, 80 pounds', shown: true });
    // "80,0" is still 80.
    await type('Weight in pounds', '80,0');
    expect(captions()[0].shown).toBe(false);
  });
});

describe('the set card under the collapsed bar', () => {
  it('fades its whole header block (name, set line and notes) together, and not the figures', async () => {
    note = 'Bench at notch 4';
    notes = { row: { note: 'Straps on the last set' } };
    await open();
    const faded = [...host.querySelectorAll<HTMLElement>('[data-fades]')];
    expect(faded).toHaveLength(1);
    const block = faded[0].textContent ?? '';
    for (const words of ['Barbell Row', 'Set 3 of 3', '8–10 reps', 'Bench at notch 4', 'Straps on the last set']) expect(block).toContain(words);
    expect(faded[0].querySelector('[data-field]')).toBeNull();
  });
});

describe('the set card\'s type', () => {
  it('sets the notes at the set line\'s size and tone', async () => {
    note = 'Bench at notch 4';
    notes = { row: { note: 'Straps on the last set' } };
    await open();
    const line = [...host.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent?.startsWith('Set 3 of 3'))!;
    expect(line.dataset.variant).toBe('secondary');
    expect(line.dataset.tone).toBe('graphite');
    for (const words of ['Bench at notch 4', 'Straps on the last set']) {
      const shown = textNamed(words)!;
      expect({ variant: shown.dataset.variant, tone: shown.dataset.tone }).toEqual({ variant: line.dataset.variant, tone: line.dataset.tone });
    }
  });
});
