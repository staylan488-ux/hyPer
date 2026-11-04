// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as todayModel from '@/lib/todayModel';
import type { MacroTarget } from '@/types';
import { todayTotalsShown } from '../native/src/lib/fuel';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

// Fuel's store module is loaded for its real totals rule; nothing reaches the backend.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's Fuel card (native/src/app/(tabs)/today/index.tsx) asks for a
// calorie target only once the saved one is known to be missing, and never
// shows yesterday's totals as today's.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
// Keeps the card's spoken summary, which has its figures in words.
const Pressable = ({ children, accessibilityLabel }: PropsWithChildren<{ accessibilityLabel?: string }>) =>
  createElement('div', { 'aria-label': accessibilityLabel }, children);
const Empty = () => null;
const noop = () => {};
const Text = ({ children }: PropsWithChildren) => createElement('span', null, children);

const appStore = create(() => ({
  macroTarget: null as MacroTarget | null,
  macroTargetLoadedForUserId: null as string | null,
  weeklyVolume: [],
  nutritionProfile: null,
}));
const DAY = '2026-11-04';
const totals = { calories: 1200, protein: 90, carbs: 0, fat: 0 };
const fuelStore = create(() => ({ todayKey: DAY, todayLoadedKey: DAY as string | null, todayTotals: totals }));

let root: Root;
let host: HTMLDivElement;
const shown = () => host.textContent ?? '';

async function open() {
  const { default: TodayScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/today/index.tsx', {
    'date-fns': dates,
    'expo-router': { router: { navigate: noop, push: noop }, Stack: { Screen: Empty } },
    'react-native': { Pressable, RefreshControl: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/todayModel': todayModel,
    '@/lib/fuelSummary': fuelSummary,
    '@/stores/appStore': { useAppStore: appStore },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '~/components/BlancText': { BlancText: Text },
    '~/components/BrandMark': { BrandMark: Empty, HEADER_MARK_SIZE: 30, headerMarkSlot: {} },
    '~/components/Capsule': { Capsule: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/PlanCard': { PlanCard: Empty },
    '~/components/RollingText': { RollingText: Text },
    '~/components/Tally': { Tally: Empty },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/components/Section': { Section: Wrap },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/lib/accountData': { useAccountRefresh: () => ({ refreshing: false, refresh: noop }) },
    '~/lib/brand': { useIntroRise: () => ({}) },
    '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish: noop, closing: false }) },
    '~/lib/format': { formatLoad: String, formatWhole: (value: number) => String(Math.round(value)) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop } },
    '~/lib/fuel': { today: () => DAY, todayTotalsShown, useFuelStore: fuelStore },
    '~/lib/motion': { figureLayout: undefined },
    '~/lib/session': { useNow: () => Date.now(), useSessionModel: () => null },
    '~/lib/today': { useTodayPlan: () => ({ hero: { kind: 'rest' }, next: null, weekDone: null, weekTarget: null }) },
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(TodayScreen)); });
}

const ASK = 'Set a calorie target';

beforeEach(() => {
  appStore.setState({ macroTarget: null, macroTargetLoadedForUserId: null });
  fuelStore.setState({ todayKey: DAY, todayLoadedKey: DAY, todayTotals: totals });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Today’s Fuel card', () => {
  it('does not ask for a target while the saved one is still loading', async () => {
    await open();
    expect(shown()).not.toContain(ASK);

    await act(async () => {
      appStore.setState({ macroTarget: { calories: 2000, protein: 150, carbs: 200, fat: 60 } as MacroTarget, macroTargetLoadedForUserId: 'user-1' });
    });
    expect(shown()).toContain('800');
    expect(shown()).toContain('kcal left');
    expect(shown()).not.toContain(ASK);
  });

  it('asks once the read finds no target for this account', async () => {
    await open();
    await act(async () => { appStore.setState({ macroTargetLoadedForUserId: 'user-1' }); });
    expect(shown()).toContain(ASK);
  });

  it('does not ask on another account’s read', async () => {
    appStore.setState({ macroTargetLoadedForUserId: 'user-2' });
    await open();
    expect(shown()).not.toContain(ASK);
  });

  it('shows nothing eaten, not yesterday’s totals, when the new day’s food failed to load', async () => {
    // The read for today failed, so the store still holds yesterday's 500 kcal.
    fuelStore.setState({ todayKey: DAY, todayLoadedKey: '2026-11-03', todayTotals: { calories: 500, protein: 40, carbs: 0, fat: 0 } });
    appStore.setState({ macroTarget: { calories: 2000, protein: 150, carbs: 200, fat: 60 } as MacroTarget, macroTargetLoadedForUserId: 'user-1' });
    await open();

    const card = host.querySelector('[aria-label*="calories left"]');
    expect(card?.getAttribute('aria-label')).toBe('2000 calories left. Eaten 0 of 2000 calories, protein 0 of 150 grams');
    expect(shown()).toContain('2000kcal left');
    expect(shown()).toContain('Eaten0 / 2000');
  });
});
