// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as todayModel from '@/lib/todayModel';
import * as types from '@/types';
import type { WorkoutSet } from '@/types';
import type { MovementHistoryMap } from '@/lib/setTargets';
import * as nativeSetTargets from '../native/src/lib/setTargets';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's card for the live workout (native/src/app/(tabs)/today/index.tsx).
// A flexible session starts with no movements: Today says what Train says,
// not "All sets logged" with a Finish button. The live card and the finished
// day's record (PlanCard) are one skeleton, SessionCard: finishing changes
// the words, not the layout.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};
const finish = vi.fn();
const navigate = vi.fn();
const openTrain = vi.fn();
const push = vi.fn();

// Each part says what it is, so a check can read the card's skeleton in order.
const Text = ({ children, variant }: PropsWithChildren<{ variant?: string }>) => createElement('span', { 'data-variant': variant ?? 'body' }, children);
const View = ({ children, style }: PropsWithChildren<{ style?: { minHeight?: number } }>) =>
  createElement('div', style?.minHeight ? { 'data-min-height': String(style.minHeight) } : null, children);
type PressProps = PropsWithChildren<{ accessible?: boolean; accessibilityLabel?: string; accessibilityHint?: string; onPress?: () => void }>;
const Pressable = ({ children, accessible, accessibilityLabel, accessibilityHint }: PressProps) =>
  createElement('div', { 'data-card': accessible === false ? 'parts' : 'one stop', 'aria-label': accessibilityLabel, 'data-hint': accessibilityHint }, children);
const Tally = ({ accessibilityLabel }: { accessibilityLabel: string }) => createElement('i', { 'data-tally': accessibilityLabel });
const Capsule = ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { onClick: onPress }, title);
// The live clock in the footnote it draws.
const markAtRest = { value: 1 };
const LiveClock = () => createElement('span', { 'data-variant': 'footnote', 'data-clock': '' }, '10:00');

// Today's finished workout, as History gives it to the record.
const finished = { id: 'w9', title: 'Pull', splitDayId: 'pull', marks: [true, true, false], sets: 2, minutes: 41 };

const plan = loadNativeModule<Record<string, (props: never) => ReactNode>>('components/PlanCard.tsx', {
  'expo-router': { router: { navigate, push } },
  'date-fns': dates,
  // The finished card's chevron: a mark only, hidden from VoiceOver.
  'expo-symbols': { SymbolView: (props: { name: string }) => createElement('u', { 'data-symbol': props.name }) },
  'react-native': { Pressable, View },
  'react-native-reanimated': { default: { View: Wrap }, FadeIn: { duration: () => undefined } },
  '@/stores/appStore': { useAppStore: create(() => ({ splits: [] })) },
  '~/components/BlancText': { BlancText: Text },
  '~/components/Capsule': { Capsule },
  '~/components/Label': { Label: ({ children }: PropsWithChildren) => createElement('section', null, children) },
  '~/components/Tally': { Tally },
  '~/lib/accessibility': silentAccessibility,
  '~/lib/format': { formatMinutes: (minutes: number) => `${minutes} min` },
  '~/lib/haptics': { haptics: { tap: noop } },
  '~/lib/history': { selectHistoryDay: noop },
  '~/lib/openTrain': { openTrain },
  '~/lib/session': { useStartSession: () => ({ starting: null, start: async () => false }) },
  '~/lib/today': { useFinishedToday: (done: boolean) => (done ? finished : null) },
  '~/lib/program': { newProgram: () => undefined },
  '~/theme/blanc': { space: { gutter: 16, labelPad: 18 }, useBlanc: () => ({ pressed: '#eee' }) },
});

const set = (id: string, completed: boolean) =>
  ({ id, exercise_id: 'row', set_number: 1, weight: 100, reps: 8, completed }) as unknown as WorkoutSet;
const movement = (sets: WorkoutSet[]) => ({ exerciseId: 'row', name: 'Row', sets });

let session: Record<string, unknown>;
let history: MovementHistoryMap = {};
let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: TodayScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/today/index.tsx', {
    'date-fns': dates,
    'expo-router': { router: { navigate, push: noop }, Stack: { Screen: Empty } },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { Pressable, RefreshControl: Empty, View },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/todayModel': todayModel,
    '@/types': types,
    '@/lib/fuelSummary': fuelSummary,
    '@/stores/appStore': { useAppStore: create(() => ({ macroTarget: null, weeklyVolume: [], nutritionProfile: null })) },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '~/components/BlancText': { BlancText: Text },
    '~/components/BrandMark': { BrandMark: Empty, HEADER_MARK_SIZE: 24, headerMarkSlot: {} },
    '~/components/Capsule': { Capsule },
    '~/components/Label': { Label: Wrap },
    '~/components/LiveClock': { LiveClock },
    '~/components/PlanCard': { PlanCard: Empty, SessionCard: plan.SessionCard },
    '~/components/RollingText': { RollingText: Wrap },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/components/DragList': { DragList: ({ items }: { items: { key: string; node: ReactNode }[] }) => createElement(Fragment, null, items.map((item) => createElement(Fragment, { key: item.key }, item.node))) },
    '~/components/SwipeRow': { closeOpenSwipeRow: () => false },
    '~/lib/todayOrder': { moveTodaySection: noop, useTodayOrder: () => ['training', 'fuel', 'progress'] },
    '~/components/Section': { Section: Empty },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/components/WeekCheckInRow': { WeekCheckInRow: Empty },
    '~/lib/weekCheckInDay': { isCheckInToday: () => false },
    '~/lib/weekCheckIn': { loadWeekCheckIn: noop, useWeekCheckIn: () => ({ checkIn: null, loading: false, failed: false, hidden: false }) },
    '~/lib/accountData': {
      useAccountRefresh: () => ({ refreshing: false, refresh: noop }),
      useCurrentDayKey: () => '2026-11-04',
      useWorkoutsRevision: create(() => ({ revision: 0 })),
    },
    '~/lib/brand': { markAtRest, useIntroRise: () => ({}) },
    '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish, closing: false }) },
    '~/lib/format': { formatMinutes: (minutes: number) => `${minutes} min`, formatSet: (weight: number | null, reps: number | null) => (weight !== null && reps !== null ? `${weight} lb × ${reps}` : ''), formatWhole: String },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop } },
    '~/lib/openTrain': { openTrain },
    '~/lib/fuel': { today: () => '2026-11-04', todayTotalsShown: () => null, useFuelStore: create(() => ({})) },
    '~/lib/motion': { figureLayout: {} },
    '~/lib/session': { useNow: () => Date.parse('2026-11-04T18:10:00Z'), usePreviousHistory: () => history, useSessionModel: () => session },
    '~/lib/setTargets': nativeSetTargets,
    '~/lib/today': { useTodayPlan: () => ({ hero: { kind: 'rest' }, next: null, weekDone: null, weekTarget: null }) },
    '~/theme/blanc': { space: { gutter: 20, labelPad: 18, group: 40 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(TodayScreen)); });
}

const buttons = () => [...host.querySelectorAll('button')].map((button) => button.textContent);
/** The session card's parts in order: each text by its style, the tally, the button. */
const skeleton = () =>
  [...host.querySelectorAll('section [data-variant], section [data-tally], section button')].map((part) =>
    part.matches('[data-tally]') ? 'tally' : part.tagName === 'BUTTON' ? 'button' : (part as HTMLElement).dataset.variant,
  );

beforeEach(() => {
  finish.mockClear();
  navigate.mockClear();
  openTrain.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const live = (movements: ReturnType<typeof movement>[], current: unknown) => ({
  workoutId: 'w1', dayName: 'Pull', flexible: true, startedAt: new Date('2026-11-04T18:00:00Z'),
  sets: movements.flatMap((entry) => entry.sets), doneCount: 0, movements, current,
});

describe('Today\'s live workout card', () => {
  it('asks for the first movement of an empty flexible session, as Train does', async () => {
    session = live([], null);
    await open();

    expect(host.textContent).toContain('No movements yet');
    expect(host.textContent).toContain('Add your first movement in Train');
    expect(host.textContent).not.toContain('All sets logged');
    expect(host.textContent).not.toContain('Finish to save the session');
    expect(buttons()).toEqual(['Resume']);
    await act(async () => { host.querySelector('button')!.click(); });
    // Train's own top, never stacked over a page left open in Train.
    expect(openTrain).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it('still offers Finish once every set is logged', async () => {
    session = live([movement([set('s1', true)])], null);
    await open();

    expect(host.textContent).toContain('All sets logged');
    expect(host.textContent).toContain('Finish to save the session');
    expect(buttons()).toEqual(['Finish']);
  });

  it('still names the next set while one is left', async () => {
    const open1 = set('s1', false);
    const row = movement([open1]);
    session = live([row], { movement: row, set: open1, setNumber: 1, index: 0, blocked: null });
    await open();

    expect(host.textContent).toContain('Row');
    expect(host.textContent).toContain('Set 1 of 1');
    expect(buttons()).toEqual(['Resume']);
  });

  it('names the next set\'s target while the set holds no numbers, as Train fills it in', async () => {
    const open1 = { ...set('s1', false), weight: null, reps: null } as WorkoutSet;
    const row = { ...movement([open1]), plan: { target_reps_min: 8, target_reps_max: 12 } };
    session = { ...live([row], { movement: row, set: open1, setNumber: 1, index: 0, blocked: null }), date: '2026-11-04' };
    history = { row: [{ workoutId: 'w0', date: '2026-11-01', sets: [{ weight: 100, reps: 9 }] }] };
    await open();
    history = {};

    expect(host.textContent).toContain('Set 1 of 1 · target 100 × 10');
  });

  it('reads as its parts to VoiceOver, the day first, and reaches its button on its own', async () => {
    const open1 = set('s1', false);
    const row = movement([open1]);
    session = live([row], { movement: row, set: open1, setNumber: 1, index: 0, blocked: null });
    await open();

    expect(host.querySelector('[data-card]')?.getAttribute('data-card')).toBe('parts');
    expect(host.querySelector('[data-tally]')?.getAttribute('data-tally')).toBe('0 of 1 sets done');
  });
});

describe('Today\'s session card, live and finished', () => {
  it('keeps one skeleton: the day and its time, the tally, then the title line; finishing changes words, not layout', async () => {
    const open1 = set('s1', false);
    const row = movement([set('s0', true), open1]);
    session = live([row], { movement: row, set: open1, setNumber: 2, index: 1, blocked: null });
    await open();
    const liveParts = skeleton();
    // Pull · 10:00, the tally, Row · Set 2 of 2, Resume.
    expect(liveParts).toEqual(['secondary', 'footnote', 'tally', 'headline', 'secondary', 'button']);
    expect([...host.querySelectorAll('section [data-variant]')].map((part) => part.textContent)).toEqual(['Pull', '10:00', 'Row', 'Set 2 of 2 · 100 lb × 8']);
    // The title line holds a button's height.
    expect(host.querySelector('[data-min-height="44"]')).not.toBeNull();
    act(() => root.unmount());

    // The session finished: the record, from History, in the same places.
    root = createRoot(host);
    const PlanCard = plan.PlanCard as (props: { hero: unknown; next: string | null; place: 'today' }) => ReactNode;
    await act(async () => { root.render(createElement(PlanCard, { hero: { kind: 'done', title: 'Session complete' }, next: 'Tomorrow · Legs', place: 'today' })); });
    expect(skeleton()).toEqual(liveParts.slice(0, -1));
    expect([...host.querySelectorAll('section [data-variant]')].map((part) => part.textContent)).toEqual(['Pull', '41 min', 'Done · 2 of 3 sets', 'Next: Legs']);
    // No button, at the same height: the card itself opens the workout, as one stop.
    expect(buttons()).toEqual([]);
    expect(host.querySelector('[data-min-height="44"]')).not.toBeNull();
    const card = host.querySelector<HTMLElement>('[data-card]')!;
    expect(card.dataset.card).toBe('one stop');
    expect(card.getAttribute('aria-label')).toBe('Pull, 41 minutes, Done, 2 of 3 sets logged, Next: Legs');
    expect(card.dataset.hint).toBe('Opens the workout');
    // Where Resume was, a chevron says the card opens a screen, as every such card does.
    expect(host.querySelector('[data-symbol="chevron.right"]')).not.toBeNull();
  });
});
