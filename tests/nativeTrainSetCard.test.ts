// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as movementOrder from '@/lib/movementOrder';
import * as setAutofill from '@/lib/setAutofill';
import * as warmupPlates from '@/lib/warmupPlates';
import type { WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';
import * as nativeSetTargets from '../native/src/lib/setTargets';
import type { MovementHistoryMap } from '@/lib/setTargets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Train's set card (native/src/app/(tabs)/train/index.tsx). Last time's
// figure is written under each field only while it says something new: "last
// 80" under an 80 only repeats the figure, so it hides (keeping its line, so
// the card doesn't move) and comes back once the field is edited away from it.
// The card's notes sit at one quiet level with the set line above them. Its
// quiet action names what it ends ("Skip last set" with one set to go), and
// the Movements row up now reads as current: a medium title over "Now".

type Props = Record<string, unknown> & { children?: ReactNode };

const Box = ({ children }: Props) => createElement('div', null, children);
const Empty = () => null;
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? (style as Record<string, unknown>) : {};
// An animated view says when it is the one that fades with the scroll (its opacity driven by a shared value).
const AnimatedView = ({ children, style }: Props) =>
  createElement('div', { 'data-fades': 'opacity' in flatten(style) ? 'true' : undefined }, children);
// A pressable keeps what VoiceOver hears.
const Pressable = ({ children, accessibilityLabel }: Props) => createElement('div', { 'data-pressable': 'true', 'aria-label': accessibilityLabel as string | undefined }, children);
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
let history: MovementHistoryMap;
let notes: Record<string, { note: string }>;
let note: string | null;
let session: Record<string, unknown>;
let total: number;
/** What makes the movement more than a plain one: a superset or a swap. */
let pairing: Record<string, unknown>;
/** The movement's first set is up, with nothing of it logged yet. */
let fresh: boolean;
let largeText = false;
let laterMovements: Record<string, unknown>[] = [];
const push = vi.fn();

/** Barbell Row, set 3 of 3 (or of `total`): two logged at 80 × 8, the third filled in from them. */
function liveSession(total = 3) {
  const sets = fresh
    ? Array.from({ length: total }, (_, index) => set(`s${index + 1}`, index + 1, false))
    : [set('s1', 1, true, 80, 8), set('s2', 2, true, 80, 8), ...Array.from({ length: total - 2 }, (_, index) => set(`s${index + 3}`, index + 3, false))];
  const done = fresh ? 0 : 2;
  const movement = {
    exerciseId: 'row',
    name: 'Barbell Row',
    sets,
    done,
    plan: { target_reps_min: 8, target_reps_max: 10 },
    superset: null,
    substitutesFor: null,
    note,
    skipped: false,
    endedEarly: false,
    ...pairing,
  };
  return {
    workoutId: 'w1',
    date: '2026-11-06',
    dayName: 'Upper A',
    flexible: false,
    startedAt: new Date('2026-11-06T00:23:00'),
    sets,
    doneCount: done,
    movements: [movement, ...laterMovements],
    current: { movement, set: sets[done], setNumber: done + 1, index: done, blocked: null },
  };
}

const { headingShown } = loadNativeModule<{ headingShown: (scrolled: number, span: unknown) => number }>('lib/barTitle.ts', {});
const setEntry = loadNativeModule<Record<string, unknown>>('lib/setEntry.ts', {
  'react-native': { ActionSheetIOS: { showActionSheetWithOptions: vi.fn() } },
  './haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
});

// The real list row, so the Movements list's type is the row's own.
const { Row } = loadNativeModule<{ Row: (props: Props) => ReactNode }>('components/Row.tsx', {
  'expo-symbols': { SymbolView: Empty },
  'react-native': { Pressable, StyleSheet: { hairlineWidth: 0.5 }, View: Box },
  '~/lib/accessibility': silentAccessibility,
  '~/lib/haptics': { haptics: { select: vi.fn(), tap: vi.fn() } },
  '~/theme/blanc': { useBlanc: () => ({}) },
  './BlancText': { BlancText: Text },
  './HoldMenu': { HoldMenu: Box, hasHoldMenu: false, menuAccessibility: () => null, showActionSheet: vi.fn() },
  './SwipeRow': { closeOpenSwipeRow: () => false, useSwipeActions: () => null },
});

let root: Root;
let host: HTMLDivElement;

async function open() {
  session = liveSession(total);
  const { default: TrainScreen } = loadNativeModule<{ default: () => ReactNode }>(
    'app/(tabs)/train/index.tsx',
    {
      'expo-router': { router: { push }, Stack: { Screen: Empty } },
      'expo-symbols': { SymbolView: Empty },
      'date-fns': dates,
      'react-native': {
        Alert: { alert: vi.fn(), prompt: vi.fn() },
        Keyboard: { dismiss: vi.fn() },
        Pressable,
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
      '@/lib/warmupPlates': warmupPlates,
      '@/lib/workoutSessions': { TRAINING_WEEK: { weekStartsOn: 1 } },
      '@/stores/appStore': { useAppStore: create(() => ({ logSet: vi.fn(), currentWorkout: null })) },
      '~/components/BlancText': { BlancText: Text },
      '~/components/Capsule': { Capsule: ({ title }: Props) => createElement('button', null, title as string) },
      '~/components/Chip': {
        Chip: ({ label, accessibilityLabel, onPress }: Props) =>
          createElement('button', { 'aria-label': accessibilityLabel as string | undefined, onClick: onPress as () => void }, label as string),
      },
      '~/components/DragList': { DragList: ({ items }: Props) => createElement(Box, null, ...(items as { node: ReactNode }[]).map((item) => item.node)) },
      '~/components/FigureInput': { FigureInput },
      '~/components/Form': { FormNote: Box },
      '~/components/Label': { Label: Box },
      '~/components/LiveClock': { LiveClock: Empty },
      '~/components/PlanCard': { PlanCard: Empty },
      '~/components/Row': { Hairline: Empty, Row },
      '~/components/Section': { Section: Box },
      '~/components/SwipeRow': { SwipeRow: Box },
      '~/components/TabScroll': { scrolledFromRest: (offset: number) => offset + 165, TabScroll: Box, tabBarCover: () => 83 },
      '~/components/Tally': { COMPACT_RISE: 6, Tally: Empty },
      '~/components/UndoBar': { UndoBar: Empty },
      '~/lib/accessibility': { ...silentAccessibility, useLargeText: () => largeText },
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
        usePreviousHistory: () => history,
        usePreviousTargets: () => previous,
        useSessionModel: () => session,
        useStartSession: () => ({ starting: null, start: vi.fn() }),
      },
      '~/lib/sessionModel': { afterLoggedSet: () => ({ nextExerciseId: null, rest: false }) },
      '~/lib/setEntry': setEntry,
      '~/lib/setTargets': nativeSetTargets,
      '~/lib/today': { useFinishedToday: () => undefined, useTodayPlan: () => ({}) },
      '~/lib/warmup': { useBarWeight: () => 45 },
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
  total = 3;
  fresh = false;
  push.mockClear();
  pairing = {};
  note = null;
  notes = {};
  previous = { row: { 1: { weight: 80, reps: 8, rpe: null }, 2: { weight: 80, reps: 8, rpe: null }, 3: { weight: 80, reps: 8, rpe: null } } };
  history = {};
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

describe('the set card\'s target', () => {
  const targetLine = () => [...host.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent?.startsWith('Target'));

  beforeEach(() => {
    fresh = true;
    previous = { row: { 1: { weight: 80, reps: 9, rpe: null }, 2: { weight: 80, reps: 9, rpe: null }, 3: { weight: 80, reps: 8, rpe: null } } };
    history = { row: [{ workoutId: 'w0', date: '2026-11-03', sets: [{ weight: 80, reps: 9 }, { weight: 80, reps: 9 }, { weight: 80, reps: 8 }] }] };
  });

  it('fills the fields with the target and says why in one line, with no last-time captions', async () => {
    await open();
    expect(host.querySelector('[data-field="Weight in pounds"]')?.textContent).toBe('80');
    expect(host.querySelector('[data-field="Reps"]')?.textContent).toBe('10');
    expect(targetLine()?.textContent).toBe('Target · one more rep than last time');
    expect(captions().map((caption) => caption.shown)).toEqual([false, false]);
    const name = [...host.querySelectorAll<HTMLElement>('[data-pressable]')].find((pressable) => pressable.getAttribute('aria-label')?.startsWith('Barbell Row'))!;
    expect(name.getAttribute('aria-label')).toContain('Target, one more rep than last time');
  });

  it('shows the target under a field edited away from it, in place of last time', async () => {
    await open();
    await type('Reps', '12');
    expect(targetLine()?.textContent).toBe('Target · one more rep than last time');
    expect(captions()[1]).toEqual({ text: 'target 10', spoken: 'Target, 10 reps', shown: true });
  });

  it('keeps the header block\'s fade with the target line inside it', async () => {
    await open();
    const faded = [...host.querySelectorAll<HTMLElement>('[data-fades]')];
    expect(faded[0].textContent).toContain('Target · one more rep than last time');
  });

  it('keeps the reason at the accessibility sizes, free to wrap', async () => {
    largeText = true;
    try {
      await open();
      expect(targetLine()?.textContent).toBe('Target · one more rep than last time');
    } finally {
      largeText = false;
    }
  });

  it('gives the one quiet line to a note, the reason still in the spoken name', async () => {
    notes = { row: { note: 'Straps on the last set' } };
    await open();
    expect(targetLine()).toBeUndefined();
    expect(host.textContent).toContain('Straps on the last set');
    const name = [...host.querySelectorAll<HTMLElement>('[data-pressable]')].find((pressable) => pressable.getAttribute('aria-label')?.startsWith('Barbell Row'))!;
    expect(name.getAttribute('aria-label')).toContain('Target, one more rep than last time');
  });

  it('shows no target under a weight far from it', async () => {
    await open();
    await type('Weight in pounds', '30');
    expect(captions().map((caption) => caption.shown)).toEqual([false, false]);
    await type('Weight in pounds', '75');
    expect(captions()[0]).toEqual({ text: 'target 80', spoken: 'Target, 80 pounds', shown: true });
  });

  it('names a later movement\'s target in its row, spoken with units', async () => {
    const press = { ...set('p1', 1, false), exercise_id: 'press', exercise: { id: 'press', name: 'Overhead Press', equipment: 'Barbell' } } as unknown as WorkoutSet;
    laterMovements = [{
      exerciseId: 'press', name: 'Overhead Press', sets: [press], done: 0, plan: { target_reps_min: 8, target_reps_max: 12 },
      superset: null, substitutesFor: null, note: null, skipped: false, endedEarly: false,
    }];
    history = { ...history, press: [{ workoutId: 'w0', date: '2026-11-03', sets: [{ weight: 60, reps: 10 }] }] };
    try {
      await open();
      const row = [...host.querySelectorAll<HTMLElement>('[aria-label]')].find((element) => element.getAttribute('aria-label')?.startsWith('Overhead Press'))!;
      expect(row.textContent).toContain('target 60 × 11');
      expect(row.getAttribute('aria-label')).toContain('target 60 pounds × 11 reps');
    } finally {
      laterMovements = [];
    }
  });

  it('is absent with no history, leaving last time in the fields', async () => {
    history = {};
    await open();
    expect(targetLine()).toBeUndefined();
    expect(host.querySelector('[data-field="Reps"]')?.textContent).toBe('9');
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

describe('the set card\'s rep target', () => {
  it.each([
    ['a superset', { superset: { groupId: 'g1', role: 'A', partnerId: 'curl', partnerName: 'Hammer Curl' } }, 'superset with Hammer Curl'],
    ['a swapped movement', { substitutesFor: { exercise_id: 'bench', exercise_name: 'Bench Press', notes: null } }, 'instead of Bench Press'],
  ])('still shows, and says, the target reps for %s', async (_case, extra, context) => {
    pairing = extra;
    await open();
    const line = [...host.querySelectorAll<HTMLElement>('span')].find((span) => span.textContent?.startsWith('Set 3 of 3'))!;
    expect(line.textContent).toBe(`Set 3 of 3 · ${context} · 8–10 reps`);
    const name = [...host.querySelectorAll<HTMLElement>('[data-pressable]')].find((pressable) => pressable.getAttribute('aria-label')?.startsWith('Barbell Row'))!;
    expect(name.getAttribute('aria-label')).toContain('8 to 10 reps');
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

describe('the set card\'s quiet action', () => {
  const action = () => [...host.querySelectorAll<HTMLElement>('[data-pressable]')].find((pressable) => /^(Skip|End) /.test(pressable.getAttribute('aria-label') ?? ''))!;

  it('says "Skip last set" with one set of the movement to go, and names what it keeps', async () => {
    await open();
    expect(action().textContent).toBe('Skip last set');
    expect(action().getAttribute('aria-label')).toBe('Skip the last set of Barbell Row, keeping 2 of 3 sets');
  });

  it('keeps "End early" with more than one set to go', async () => {
    total = 4;
    await open();
    expect(action().textContent).toBe('End early');
    expect(action().getAttribute('aria-label')).toBe('End Barbell Row early, keeping 2 of 4 sets');
  });
});

describe('the Movements row up now', () => {
  it('reads as current: a medium title, as a row with a detail line has, over "Now" alone', async () => {
    await open();
    const row = [...host.querySelectorAll<HTMLElement>('[data-pressable]')].find((pressable) => pressable.getAttribute('aria-label')?.startsWith('Barbell Row, Now'))!;
    expect(row.getAttribute('aria-label')).toBe('Barbell Row, Now, 2 of 3 sets done');
    const [title, detail, ...more] = [...row.querySelectorAll<HTMLElement>('span')];
    expect({ text: title.textContent, variant: title.dataset.variant, tone: title.dataset.tone }).toEqual({ text: 'Barbell Row', variant: 'bodyStrong', tone: 'ink' });
    expect({ text: detail.textContent, variant: detail.dataset.variant, tone: detail.dataset.tone }).toEqual({ text: 'Now', variant: 'secondary', tone: 'graphite' });
    expect(more).toEqual([]);
  });
});

describe('the set card\'s warm-up and plates', () => {
  const chips = () => [...host.querySelectorAll<HTMLButtonElement>('button')].map((button) => button.textContent);
  const chip = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!;

  it('offers warm-ups before a barbell movement\'s first set, opening them at the weight typed', async () => {
    fresh = true;
    await open();
    expect(chips()).toEqual(['Add RPE', 'Warm-up', 'Log set']);
    expect(chip('Warm-up').getAttribute('aria-label')).toBe('Warm-up sets');
    await act(async () => chip('Warm-up').click());
    expect(push).toHaveBeenCalledWith({ pathname: '/warm-up', params: { id: 'row', weight: '80' } });
  });

  it('offers the plates on later sets, and nothing at or under the bar', async () => {
    await open();
    expect(chips()).toEqual(['Add RPE', 'Plates', 'Log set']);
    expect(chip('Plates').getAttribute('aria-label')).toBe('Plates for 80 pounds');
    await type('Weight in pounds', '45');
    expect(chips()).toEqual(['Add RPE', 'Log set']);
    await type('Weight in pounds', '');
    expect(chips()).toEqual(['Add RPE', 'Log set']);
  });

  it('keeps warm-ups off a first set too light to ramp up to', async () => {
    fresh = true;
    await open();
    await type('Weight in pounds', '50');
    // Only 5 lb over the bar: no warm-up, but the plates still help.
    expect(chips()).toEqual(['Add RPE', 'Plates', 'Log set']);
  });
});
