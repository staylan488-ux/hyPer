// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as activityMetrics from '@/lib/activityMetrics';
import * as activitySessions from '@/lib/activitySessions';
import * as historyMonth from '@/lib/historyMonth';
import * as workoutSessions from '@/lib/workoutSessions';
import type { WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// History's day list (native/src/app/(tabs)/train/history.tsx) draws a
// strength session's sets as the tally, finished or running, in place of an
// "N of M sets" line. The running one's next set is its stroke in the live
// red, as on Train and Today, and its state stays in words: "12:23 AM · In
// progress" by the live dot. VoiceOver still hears the count. Where the tally
// doesn't fit (the accessibility sizes) the count is written instead.

type Props = Record<string, unknown> & { children?: ReactNode };

const Box = ({ children }: Props) => createElement('div', null, children);
const Empty = () => null;
// A row shows what it was given: its words, the mark before its detail and what sits at its right.
const Row = ({ title, detail, detailMark, trailing, accessibilityLabel }: Props) =>
  createElement(
    'div',
    { 'data-row': title as string, 'data-detail': detail as string | undefined, 'aria-label': accessibilityLabel as string | undefined },
    detailMark ? createElement('i', { 'data-detail-mark': 'true' }, detailMark as ReactNode) : null,
    trailing as ReactNode,
  );
const Tally = ({ marks, current, compact, accessibilityLabel }: Props) =>
  createElement('b', {
    'data-tally': (marks as boolean[]).map((mark) => (mark ? 'x' : '-')).join(''),
    'data-current': current === null ? 'none' : String(current),
    'data-compact': compact ? 'true' : 'false',
    'aria-label': accessibilityLabel as string,
  });

const day = '2026-11-06';
const set = (id: string, exercise: string, completed: boolean) =>
  ({ id, exercise_id: exercise, set_number: 1, weight: 80, reps: 8, rpe: null, completed, exercise: { id: exercise, name: exercise } }) as unknown as WorkoutSet;
const liveSets = [
  ...['a1', 'a2', 'a3'].map((id) => set(id, 'bench', true)),
  ...['b1', 'b2'].map((id) => set(id, 'row', true)),
  ...['b3', 'c1', 'c2', 'c3'].map((id) => set(id, id === 'b3' ? 'row' : 'curl', false)),
];
const startedAt = new Date('2026-11-06T00:23:00');
const liveWorkout = { id: 'w-live', date: day, started_at: startedAt.toISOString(), completed: false, split_day: { day_name: 'Upper A' }, sets: liveSets };
const finishedWorkout = {
  id: 'w-done',
  date: day,
  started_at: '2026-11-06T07:00:00',
  completed_at: '2026-11-06T07:48:00',
  completed: true,
  split_day: { day_name: 'Lower A' },
  sets: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'].map((id) => set(id, 'squat', true)),
};
const session = {
  workoutId: 'w-live',
  startedAt,
  sets: liveSets,
  doneCount: 5,
  movements: [{ exerciseId: 'bench' }, { exerciseId: 'row' }, { exerciseId: 'curl' }],
  current: { index: 5 },
};

let large = false;
let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: HistoryScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/train/history.tsx', {
    'date-fns': dates,
    'expo-router': { router: { dismissTo: vi.fn(), push: vi.fn() }, Stack: { Screen: Empty }, useFocusEffect: () => undefined },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { Alert: { alert: vi.fn() }, Pressable: Box, RefreshControl: Empty, ScrollView: Box, View: Box },
    'react-native-reanimated': { default: { View: Box } },
    '@/lib/activityMetrics': activityMetrics,
    '@/lib/activitySessions': activitySessions,
    '@/lib/historyMonth': historyMonth,
    '@/lib/workoutSessions': workoutSessions,
    '@/stores/appStore': { useAppStore: Object.assign(create(() => ({ whoopConnection: null })), { getState: () => ({ fetchWhoopConnection: vi.fn() }) }) },
    '~/components/BlancText': { BlancText: Box },
    '~/components/Label': { Label: Box },
    '~/components/HoldMenu': { showActionSheet: vi.fn() },
    '~/components/Row': { Hairline: Empty, Row },
    '~/components/Section': { Section: Box },
    '~/components/SwipeRow': { SwipeRow: Box },
    '~/components/TabScroll': { TabScroll: Box },
    '~/components/Tally': { Tally },
    '~/lib/accessibility': { ...silentAccessibility, useLargeText: () => large },
    '~/lib/format': format,
    '~/lib/haptics': { haptics: { error: vi.fn(), select: vi.fn(), success: vi.fn(), tap: vi.fn() } },
    '~/lib/history': {
      confirmDeleteActivity: vi.fn(),
      confirmDeleteWorkout: vi.fn(),
      followToday: () => true,
      loadHistoryMonth: vi.fn(),
      mergeActivities: vi.fn(),
      selectHistoryDay: vi.fn(),
      syncActivities: vi.fn(),
      useHistoryStore: create(() => ({
        month: new Date('2026-11-01T00:00:00'),
        day,
        workouts: [liveWorkout, finishedWorkout],
        activities: [],
        loading: false,
        failed: false,
      })),
      workoutsOnDay: (workouts: unknown[]) => workouts,
    },
    '~/lib/historyDay': {
      dayEntries: (workouts: unknown[]) => workouts.map((workout) => ({ kind: 'workout', workout })),
    },
    '~/lib/motion': { blockExit: {}, rowEnter: {}, rowExit: {}, rowLayout: {} },
    '~/lib/session': { useSessionModel: () => session },
    '~/platform/previewFlag': { isPreviewActive: () => false },
    '~/theme/blanc': { useBlanc: () => ({ live: 'live' }) },
  });
  await act(async () => {
    root.render(createElement(HistoryScreen));
  });
}

const row = (title: string) => host.querySelector<HTMLElement>(`[data-row="${title}"]`)!;
const time = activitySessions.formatActivityStartTime(startedAt.toISOString());

beforeEach(() => {
  large = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('History\'s strength sessions', () => {
  it('draws the running session\'s sets as its tally, the next set in the live red, instead of "5 of 9 sets"', async () => {
    await open();
    const live = row('Upper A');
    const tally = live.querySelector<HTMLElement>('[data-tally]')!;
    expect(tally.dataset.tally).toBe('xxxxx----');
    expect(tally.dataset.current).toBe('5');
    expect(tally.dataset.compact).toBe('true');
    expect(live.dataset.detail).toBe(`${time} · In progress`);
    expect(live.dataset.detail).not.toContain('of 9 sets');
    // The live dot before the detail line keeps the state legible.
    expect(live.querySelector('[data-detail-mark]')).not.toBeNull();
  });

  it('still says "5 of 9 sets" to VoiceOver', async () => {
    await open();
    const live = row('Upper A');
    expect(live.getAttribute('aria-label')).toBe(`Upper A, In progress, ${time}, 5 of 9 sets`);
    expect(live.querySelector('[data-tally]')!.getAttribute('aria-label')).toBe('5 of 9 sets');
  });

  it('draws a finished session the same way, without a next stroke', async () => {
    await open();
    const done = row('Lower A');
    const tally = done.querySelector<HTMLElement>('[data-tally]')!;
    expect(tally.dataset.tally).toBe('xxxxxx');
    expect(tally.dataset.current).toBe('none');
    expect(tally.dataset.compact).toBe('true');
    expect(done.dataset.detail ?? '').not.toContain('sets');
    expect(done.getAttribute('aria-label')).toContain('6 sets');
  });

  it('writes the count in words where the tally doesn\'t fit, at the accessibility sizes', async () => {
    large = true;
    await open();
    const live = row('Upper A');
    expect(live.querySelector('[data-tally]')).toBeNull();
    expect(live.dataset.detail).toBe(`${time} · In progress · 5 of 9 sets`);
    expect(live.querySelector('[data-detail-mark]')).not.toBeNull();
    expect(row('Lower A').querySelector('[data-tally]')).toBeNull();
  });
});

describe("History's month grid", () => {
  // The month's cells, in grid order, for each of the three pages (last, this, next month).
  const grids = () => [...host.querySelectorAll('div')].filter((node) => node.children.length >= 28 && node.children.length % 7 === 0);

  it('starts its weeks on Monday, as the training week and Fuel do: M T W T F S S', async () => {
    await open();
    const header = [...host.querySelectorAll('div')].find(
      (node) => node.children.length === 7 && [...node.children].every((child) => /^[A-Z]$/.test(child.textContent ?? '')),
    );
    expect([...header!.children].map((child) => child.textContent)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    // November 2026 begins on a Sunday: six empty places, then the 1st ends the first row.
    const november = [...grids()[1].children].map((cell) => cell.textContent);
    expect(november.slice(0, 7)).toEqual(['', '', '', '', '', '', '1']);
    expect(november[7]).toBe('2');
    // December begins on a Tuesday, the second place.
    expect([...grids()[2].children].map((cell) => cell.textContent).slice(0, 2)).toEqual(['', '1']);
  });
});
