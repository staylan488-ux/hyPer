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
import { movedTodayOrder, TODAY_SECTIONS, type TodaySection } from '../native/src/lib/todayOrder';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

// Fuel's store module is loaded for its real totals rule; nothing reaches the backend.
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's Fuel block (native/src/app/(tabs)/today/index.tsx) asks for a
// calorie target only once the saved one is known to be missing, and never
// shows yesterday's totals as today's. Its groups are named for the
// screens they open: Fuel, and Progress, whose rows read as You's do.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
type PressProps = PropsWithChildren<{
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onPress?: () => void;
  style?: (state: { pressed: boolean }) => Record<string, unknown>;
}>;
type RowProps = { title: string; detail?: string; value?: string; chevron?: boolean; onPress?: () => void };
type SectionProps = PropsWithChildren<{
  title: string;
  note?: string;
  page?: boolean;
  action?: { title: string; symbol?: string; onPress: () => void };
  actions?: { label: string; run: () => void }[];
}>;
type DragListProps = { items: { key: string; node: ReactNode }[]; cards?: boolean; gap?: number; onMove: (key: string, index: number) => void };
// What the screen hands its pressables, rows and sections, by name.
const presses: PressProps[] = [];
const rows: RowProps[] = [];
const sections: SectionProps[] = [];
const lists: DragListProps[] = [];
// The groups in the order they are drawn, each in its own element.
const DragList = (props: DragListProps) => {
  lists.push(props);
  return createElement(Fragment, null, props.items.map((item) => createElement('article', { key: item.key, 'data-group': item.key }, item.node)));
};
// A touch that lifted a group is not a tap on it.
let lifted = false;
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
// A group's block on the page, and the chevron that says it leads somewhere.
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
// The groups' order, with the app's own rule for a move (lib/todayOrder keeps it on the phone).
const orderStore = create(() => ({ order: [...TODAY_SECTIONS] as TodaySection[] }));
const DAY = '2026-11-04';
// Today's corner P's scroll fade (lib/brand.ts).
const markAtRest = { value: 1 };
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
    '~/components/DragList': { DragList },
    '~/components/SwipeRow': { closeOpenSwipeRow: () => lifted },
    '~/lib/todayOrder': {
      useTodayOrder: () => orderStore((state) => state.order),
      moveTodaySection: (_userId: string | null, key: TodaySection, index: number) =>
        orderStore.setState((state) => ({ order: movedTodayOrder(state.order, key, index) })),
    },
    '~/components/Label': { Label },
    '~/components/LiveClock': { LiveClock: () => null },
    '~/components/PlanCard': { PlanCard: Empty, SessionCard: Empty },
    '~/components/RollingText': { RollingText: Text },
    '~/components/Tally': { Tally: Empty },
    '~/components/Row': { Hairline: Empty, Row },
    '~/components/Section': { Section },
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
    '~/lib/finishWorkout': { useFinishWorkout: () => ({ finish: noop, closing: false }) },
    '~/lib/format': { formatLoad: String, formatWhole: (value: number) => String(Math.round(value)) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics },
    '~/lib/openTrain': { openTrain: () => undefined },
    '~/lib/fuel': { today: () => DAY, todayTotalsShown, useFuelStore: fuelStore },
    '~/lib/motion': { figureLayout: undefined },
    '~/lib/session': { useNow: () => Date.now(), useSessionModel: () => null },
    '~/lib/today': { useTodayPlan: () => ({ hero: { kind: 'rest' }, next: null, ...week }) },
    '~/theme/blanc': { space: { gutter: 20, labelPad: 18, group: 40 }, useBlanc: () => ({ pressed: '#E7E6E1', upcoming: '#707069' }), figureLead: () => 0, restingFigure: {} },
  });
  await act(async () => { root.render(createElement(TodayScreen)); });
}

const ASK = 'Set a calorie target';

beforeEach(() => {
  presses.length = 0;
  rows.length = 0;
  sections.length = 0;
  lists.length = 0;
  lifted = false;
  orderStore.setState({ order: [...TODAY_SECTIONS] });
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

describe('Today’s corner mark', () => {
  it('is back at rest once Today closes, so it shows when Today opens again', async () => {
    await open();
    // Scrolled until the P stepped back, then signed out.
    markAtRest.value = 0;
    act(() => root.unmount());
    root = createRoot(host);
    expect(markAtRest.value).toBe(1);
  });
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

describe('Today’s Fuel group, a heading over one block', () => {
  const TARGET = { calories: 2000, protein: 150, carbs: 200, fat: 60 } as MacroTarget;
  const SPOKEN = '1200 of 2000 calories eaten, 800 calories left. Protein 90 of 150 grams';
  const fuelCard = () => host.querySelector(`[aria-label="${SPOKEN}"]`);

  it('draws the figure and the protein meter in one block whose chevron says it opens Fuel', async () => {
    appStore.setState({ macroTarget: TARGET, macroTargetLoadedForUserId: 'user-1' });
    await open();

    const card = fuelCard()!;
    // The figure and the protein meter are one block, pressed as one.
    expect(card.closest('[data-card]')).not.toBeNull();
    expect(card.textContent).toContain('1200');
    expect(card.textContent).toContain('of 2000 kcal');
    expect(card.textContent).toContain('Protein90 of 150 g');
    // One chevron, on the block that leads somewhere, as Progress's rows have.
    expect([...card.querySelectorAll('[data-symbol]')].map((mark) => mark.getAttribute('data-symbol'))).toEqual(['chevron.right']);
  });

  it('keeps its VoiceOver label and hint, highlights under the finger and opens Fuel with a tap', async () => {
    appStore.setState({ macroTarget: TARGET, macroTargetLoadedForUserId: 'user-1' });
    await open();

    const press = presses.filter((props) => props.accessibilityLabel === SPOKEN).at(-1)!;
    expect(press.accessibilityHint).toBe('Opens Fuel');
    // A row's press highlight, rather than fading on the ground.
    expect(press.style!({ pressed: true })).toMatchObject({ backgroundColor: '#E7E6E1' });
    expect(press.style!({ pressed: false })).toMatchObject({ backgroundColor: 'transparent' });
    await act(async () => { press.onPress!(); });
    expect(router.navigate).toHaveBeenCalledWith('/fuel');
    expect(haptics.tap).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the touch that lifted its group', async () => {
    appStore.setState({ macroTarget: TARGET, macroTargetLoadedForUserId: 'user-1' });
    await open();
    lifted = true;
    const press = presses.filter((props) => props.accessibilityLabel === SPOKEN).at(-1)!;
    await act(async () => { press.onPress!(); });
    expect(router.navigate).not.toHaveBeenCalled();
    expect(haptics.tap).not.toHaveBeenCalled();
  });

  it('holds the block’s place, empty, while the saved target is read', async () => {
    await open();
    const held = [...host.querySelectorAll('[data-card][data-height]')];
    expect(held).toHaveLength(1);
    // The figure's line, its line toward the target and the protein meter.
    expect(Number(held[0].getAttribute('data-height'))).toBeGreaterThan(120);
    expect(held[0].textContent).toBe('');
  });

  it('asks for a target as one row in the same block, which opens the targets', async () => {
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

describe('Today’s groups, set apart by space', () => {
  const groupsShown = () => [...host.querySelectorAll('[data-group]')].map((group) => group.getAttribute('data-group'));
  const section = (title: string) => sections.filter((entry) => entry.title === title).at(-1)!;

  it('are held and dragged into place: glass cards while one is held, set apart by the page’s gap', async () => {
    await open();
    expect(lists.at(-1)).toMatchObject({ cards: true, gap: 40 });
    expect(groupsShown()).toEqual(['training', 'fuel', 'progress']);

    // Fuel set down first: the page follows at once.
    await act(async () => { lists.at(-1)!.onMove('fuel', 0); });
    expect(groupsShown()).toEqual(['fuel', 'training', 'progress']);
  });

  it('moves from a heading with VoiceOver, as a drag does by sight', async () => {
    await open();
    // Fuel is in the middle, Progress last.
    expect(section('Fuel').actions!.map((action) => action.label)).toEqual(['Move up', 'Move down']);
    expect(section('Progress').actions!.map((action) => action.label)).toEqual(['Move up']);
    await act(async () => { section('Progress').actions![0].run(); });
    expect(groupsShown()).toEqual(['training', 'progress', 'fuel']);
  });

  it('are a page’s groups, and Log food is the Fuel heading’s one action', async () => {
    await open();
    expect(sections.map((section) => [section.title, section.page])).toEqual([['Fuel', true], ['Progress', true]]);
    const fuel = sections.find((section) => section.title === 'Fuel')!;
    expect(fuel.action).toMatchObject({ title: 'Log food', symbol: 'plus' });
    await act(async () => { fuel.action!.onPress(); });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/log-food', params: { day: DAY } });
  });
});

describe('Today’s Progress group, named for the screen it opens', () => {
  const landmark = { id: 'l', user_id: 'me', mv: 6, mev: 8, mav_low: 12, mav_high: 18, mrv: 22 };
  const trained: MuscleVolume[] = [
    { muscle_group: 'chest', weekly_sets: 12, landmark: { ...landmark, muscle_group: 'chest' }, status: 'mav' },
    { muscle_group: 'hamstrings', weekly_sets: 4, landmark: { ...landmark, muscle_group: 'hamstrings' }, status: 'below_mev' },
  ] as MuscleVolume[];
  const progress = () => sections.filter((section) => section.title === 'Progress').at(-1);
  const thisWeek = () => rows.filter((entry) => entry.title === 'This week').at(-1)!;

  it('is Progress, over one row for the week so far that opens it', async () => {
    week = { weekDone: 3, weekTarget: 4 };
    appStore.setState({ weeklyVolume: trained });
    await open();
    // The heading is the name alone: no note beside it and no action of its own.
    expect(progress()?.note).toBeUndefined();
    expect(progress()?.action).toBeUndefined();
    // One line, as You's rows: the week's sessions; the muscles out of range are what Progress opens on.
    expect(thisWeek().value).toBe('3 of 4 sessions');
    expect(thisWeek().detail).toBeUndefined();
    expect(thisWeek().chevron).toBe(true);
    await act(async () => { thisWeek().onPress!(); });
    expect(router.push).toHaveBeenCalledWith('/today/progress');
  });

  it('counts sessions without a weekly target', async () => {
    week = { weekDone: 1, weekTarget: null };
    await open();
    expect(thisWeek().value).toBe('1 session');
  });

  it('says the trained muscles in range before a session is finished', async () => {
    week = { weekDone: 0, weekTarget: null };
    appStore.setState({ weeklyVolume: trained });
    await open();
    expect(thisWeek().value).toBe('1 of 2 muscles in range');
  });

  it('has no figure until the week is counted, and still opens Progress', async () => {
    await open();
    expect(thisWeek().value).toBeUndefined();
    await act(async () => { thisWeek().onPress!(); });
    expect(router.push).toHaveBeenCalledWith('/today/progress');
  });
});
