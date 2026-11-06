// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as fuelSummary from '@/lib/fuelSummary';
import * as todayModel from '@/lib/todayModel';
import * as types from '@/types';
import type { MacroTarget, MuscleVolume } from '@/types';
import { todayTotalsShown } from '../native/src/lib/fuel';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

// Fuel's store module is loaded for its real totals rule; nothing reaches the backend.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's Fuel card (native/src/app/(tabs)/today/index.tsx) asks for a
// calorie target only once the saved one is known to be missing, and never
// shows yesterday's totals as today's. Its sections are named for the
// screens they open: Fuel, and Progress.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
type PressProps = PropsWithChildren<{
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onPress?: () => void;
  style?: (state: { pressed: boolean }) => Record<string, unknown>;
}>;
type RowProps = { title: string; detail?: string; chevron?: boolean; onPress?: () => void };
type SectionProps = PropsWithChildren<{ title: string; note?: string; action?: { title: string; onPress: () => void } }>;
// What the screen hands its pressables, rows and sections, by name.
const presses: PressProps[] = [];
const rows: RowProps[] = [];
const sections: SectionProps[] = [];
const Section = (props: SectionProps) => {
  sections.push(props);
  return createElement(Fragment, null, props.children);
};
// The week's sessions, as useTodayPlan counts them.
let week: { weekDone: number | null; weekTarget: number | null } = { weekDone: null, weekTarget: null };
// Keeps the card's spoken summary, which has its figures in words.
const Pressable = (props: PressProps) => {
  presses.push(props);
  return createElement('div', { 'aria-label': props.accessibilityLabel }, props.children);
};
// The white card, and the chevron that says the card leads somewhere.
const Label = ({ children, style }: PropsWithChildren<{ style?: { height?: number } }>) =>
  createElement('section', { 'data-card': '', 'data-height': style?.height }, children);
const SymbolView = ({ name }: { name: string }) => createElement('i', { 'data-symbol': name });
const Row = (props: RowProps) => {
  rows.push(props);
  return createElement('span', { 'data-row': '' }, props.title);
};
const Empty = () => null;
const noop = () => {};
const Text = ({ children }: PropsWithChildren) => createElement('span', null, children);
const router = { navigate: vi.fn(), push: vi.fn() };
const haptics = { tap: vi.fn() };

const appStore = create(() => ({
  macroTarget: null as MacroTarget | null,
  macroTargetLoadedForUserId: null as string | null,
  weeklyVolume: [] as MuscleVolume[],
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
    'expo-router': { router, Stack: { Screen: Empty } },
    'expo-symbols': { SymbolView },
    'react-native': { Pressable, RefreshControl: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/todayModel': todayModel,
    '@/types': types,
    '@/lib/fuelSummary': fuelSummary,
    '@/stores/appStore': { useAppStore: appStore },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '~/components/BlancText': { BlancText: Text },
    '~/components/BrandMark': { BrandMark: Empty, HEADER_MARK_SIZE: 30, headerMarkSlot: {} },
    '~/components/Capsule': { Capsule: Empty },
    '~/components/Label': { Label },
    '~/components/LiveClock': { LiveClock: () => null },
    '~/components/PlanCard': { PlanCard: Empty, SessionCard: Empty },
    '~/components/RollingText': { RollingText: Text },
    '~/components/Tally': { Tally: Empty },
    '~/components/Row': { Hairline: Empty, Row },
    '~/components/Section': { Section },
    '~/components/TabScroll': { TabScroll: Wrap },
    '~/components/Track': { Track: Empty },
    '~/lib/accountData': { useAccountRefresh: () => ({ refreshing: false, refresh: noop }) },
    '~/lib/brand': { useIntroRise: () => ({}) },
    '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish: noop, closing: false }) },
    '~/lib/format': { formatLoad: String, formatWhole: (value: number) => String(Math.round(value)) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics },
    '~/lib/fuel': { today: () => DAY, todayTotalsShown, useFuelStore: fuelStore },
    '~/lib/motion': { figureLayout: undefined },
    '~/lib/session': { useNow: () => Date.now(), useSessionModel: () => null },
    '~/lib/today': { useTodayPlan: () => ({ hero: { kind: 'rest' }, next: null, ...week }) },
    '~/theme/blanc': { space: { gutter: 20 }, useBlanc: () => ({ pressed: '#E7E6E1', upcoming: '#707069' }), figureLead: () => 0, restingFigure: {} },
  });
  await act(async () => { root.render(createElement(TodayScreen)); });
}

const ASK = 'Set a calorie target';

beforeEach(() => {
  presses.length = 0;
  rows.length = 0;
  sections.length = 0;
  week = { weekDone: null, weekTarget: null };
  router.navigate.mockClear();
  router.push.mockClear();
  haptics.tap.mockClear();
  appStore.setState({ macroTarget: null, macroTargetLoadedForUserId: null, weeklyVolume: [] });
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
    expect(shown()).toContain('1200');
    expect(shown()).toContain('of 2000 kcal');
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
    expect(card?.getAttribute('aria-label')).toBe('0 of 2000 calories eaten, 2000 calories left. Protein 0 of 150 grams');
    expect(shown()).toContain('0of 2000 kcal');
    // Today shows the calories left and the protein meter; nothing of yesterday's 40 g.
    expect(shown()).toContain('Protein0 of 150 g');
  });
});

describe('Today’s Fuel section, a header over one card', () => {
  const TARGET = { calories: 2000, protein: 150, carbs: 200, fat: 60 } as MacroTarget;
  const SPOKEN = '1200 of 2000 calories eaten, 800 calories left. Protein 90 of 150 grams';
  const fuelCard = () => host.querySelector(`[aria-label="${SPOKEN}"]`);

  it('draws the figure and the protein meter inside a card whose chevron says it opens Fuel', async () => {
    appStore.setState({ macroTarget: TARGET, macroTargetLoadedForUserId: 'user-1' });
    await open();

    const card = fuelCard()!;
    // The figure and the protein meter sit in the white card, not on the ground.
    expect(card.closest('[data-card]')).not.toBeNull();
    expect(card.textContent).toContain('1200');
    expect(card.textContent).toContain('of 2000 kcal');
    expect(card.textContent).toContain('Protein90 of 150 g');
    // One chevron, on the card that leads somewhere, as Progress's row has.
    expect([...card.querySelectorAll('[data-symbol]')].map((mark) => mark.getAttribute('data-symbol'))).toEqual(['chevron.right']);
  });

  it('keeps its VoiceOver label and hint, highlights under the finger and opens Fuel with a tap', async () => {
    appStore.setState({ macroTarget: TARGET, macroTargetLoadedForUserId: 'user-1' });
    await open();

    const press = presses.filter((props) => props.accessibilityLabel === SPOKEN).at(-1)!;
    expect(press.accessibilityHint).toBe('Opens Fuel');
    // A card's press highlight, as its rows have, rather than fading on the ground.
    expect(press.style!({ pressed: true })).toMatchObject({ backgroundColor: '#E7E6E1' });
    expect(press.style!({ pressed: false })).toMatchObject({ backgroundColor: 'transparent' });
    await act(async () => { press.onPress!(); });
    expect(router.navigate).toHaveBeenCalledWith('/fuel');
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it('holds the card’s place with an empty card while the saved target is read', async () => {
    await open();
    const cards = [...host.querySelectorAll('[data-card]')];
    expect(cards).toHaveLength(1);
    expect(Number(cards[0].getAttribute('data-height'))).toBeGreaterThan(140);
    expect(cards[0].textContent).toBe('');
  });

  it('asks for a target as one row in the same card, which opens the targets', async () => {
    appStore.setState({ macroTargetLoadedForUserId: 'user-1' });
    await open();

    const ask = rows.filter((row) => row.title === ASK).at(-1)!;
    expect(ask.chevron).toBe(true);
    expect(host.querySelector('[data-row]')!.closest('[data-card]')).not.toBeNull();
    await act(async () => { ask.onPress!(); });
    expect(router.push).toHaveBeenCalledWith('/you/targets');
    // Row plays the tap's haptic itself.
    expect(haptics.tap).not.toHaveBeenCalled();
  });
});

describe('Today’s Progress section, named for the screen it opens', () => {
  const landmark = { id: 'l', user_id: 'me', mv: 6, mev: 8, mav_low: 12, mav_high: 18, mrv: 22 };
  const trained: MuscleVolume[] = [
    { muscle_group: 'chest', weekly_sets: 12, landmark: { ...landmark, muscle_group: 'chest' }, status: 'mav' },
    { muscle_group: 'hamstrings', weekly_sets: 4, landmark: { ...landmark, muscle_group: 'hamstrings' }, status: 'below_mev' },
  ] as MuscleVolume[];
  const progress = () => sections.filter((section) => section.title === 'Progress').at(-1);

  it('is Progress, with the week’s sessions in its note, over the muscles row that opens it', async () => {
    week = { weekDone: 3, weekTarget: 4 };
    appStore.setState({ weeklyVolume: trained });
    await open();
    expect(sections.some((section) => section.title === 'This week')).toBe(false);
    expect(progress()?.note).toBe('3 of 4 sessions this week');
    // The card leads there, so the header has no action of its own.
    expect(progress()?.action).toBeUndefined();
    const row = rows.filter((entry) => entry.title === '1 of 2 trained muscles in range').at(-1)!;
    expect(row.chevron).toBe(true);
    expect(row.detail).toBe('Hamstrings below');
    await act(async () => { row.onPress!(); });
    expect(router.push).toHaveBeenCalledWith('/today/progress');
  });

  it('counts sessions without a weekly target, and opens Progress from its header before a set is logged', async () => {
    week = { weekDone: 1, weekTarget: null };
    await open();
    expect(progress()?.note).toBe('1 session this week');
    // Not "Progress" twice on one line.
    expect(progress()?.action?.title).toBe('Open');
    await act(async () => { progress()!.action!.onPress(); });
    expect(router.push).toHaveBeenCalledWith('/today/progress');
  });

  it('has no note until the week is counted', async () => {
    await open();
    expect(progress()?.note).toBeUndefined();
  });
});
