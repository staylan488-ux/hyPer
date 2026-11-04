// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as todayModel from '@/lib/todayModel';
import type { WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's card for the live workout (native/src/app/(tabs)/today/index.tsx).
// A flexible session starts with no movements: Today says what Train says,
// not "All sets done" with a Finish button.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};
const finish = vi.fn();
const navigate = vi.fn();

const set = (id: string, completed: boolean) =>
  ({ id, exercise_id: 'row', set_number: 1, weight: 100, reps: 8, completed }) as unknown as WorkoutSet;
const movement = (sets: WorkoutSet[]) => ({ exerciseId: 'row', name: 'Row', sets });

let session: Record<string, unknown>;
let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: TodayScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/today/index.tsx', {
    'date-fns': dates,
    'expo-router': { router: { navigate, push: noop }, Stack: { Screen: Empty } },
    'react-native': { Pressable: Wrap, RefreshControl: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/todayModel': todayModel,
    '@/lib/fuelSummary': fuelSummary,
    '@/stores/appStore': { useAppStore: create(() => ({ macroTarget: null, weeklyVolume: [], nutritionProfile: null })) },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
    '~/components/BrandMark': { BrandMark: Empty, HEADER_MARK_SIZE: 24, headerMarkSlot: {} },
    '~/components/Capsule': {
      Capsule: ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { onClick: onPress }, title),
    },
    '~/components/Label': { Label: Wrap },
    '~/components/PlanCard': { PlanCard: Empty },
    '~/components/RollingText': { RollingText: Wrap },
    '~/components/Tally': { Tally: Empty },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/components/Section': { Section: Empty },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/lib/accountData': { useAccountRefresh: () => ({ refreshing: false, refresh: noop }) },
    '~/lib/brand': { useIntroRise: () => ({}) },
    '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish, closing: false }) },
    '~/lib/format': { formatLoad: String, formatWhole: String },
    '~/lib/haptics': { haptics: { tap: noop } },
    '~/lib/fuel': { today: () => '2026-11-04', todayTotalsShown: () => null, useFuelStore: create(() => ({})) },
    '~/lib/motion': { figureLayout: {} },
    '~/lib/session': { useNow: () => Date.parse('2026-11-04T18:10:00Z'), useSessionModel: () => session },
    '~/lib/today': { useTodayPlan: () => ({ hero: { kind: 'rest' }, next: null, weekDone: null, weekTarget: null }) },
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(TodayScreen)); });
}

const buttons = () => [...host.querySelectorAll('button')].map((button) => button.textContent);

beforeEach(() => {
  finish.mockClear();
  navigate.mockClear();
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

    expect(host.textContent).toContain('Add your first movement');
    expect(host.textContent).not.toContain('All sets done');
    expect(host.textContent).not.toContain('Finish to save the session');
    expect(buttons()).toEqual(['Resume']);
    await act(async () => { host.querySelector('button')!.click(); });
    expect(navigate).toHaveBeenCalledWith('/train');
    expect(finish).not.toHaveBeenCalled();
  });

  it('still offers Finish once every set is logged', async () => {
    session = live([movement([set('s1', true)])], null);
    await open();

    expect(host.textContent).toContain('All sets done');
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
});
