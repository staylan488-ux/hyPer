// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import * as planSchedule from '@/lib/planSchedule';
import type { PlanSchedule } from '@/lib/planSchedule';
import type { HeroState } from '@/lib/todayModel';
import type { Split, SplitDay } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Schedule sheet (native/src/app/schedule.tsx): Day 1 and how sessions
// follow. Only views, navigation and saving are stand-ins.

const day = (id: string, name: string): SplitDay => ({ id, split_id: 'split-1', day_name: name, day_order: Number(id.slice(-1)), exercises: [] });
const days = [day('day-1', 'Upper A'), day('day-2', 'Lower A'), day('day-3', 'Upper B')];
const program = (dayCount: number) => ({
  id: 'split-1', user_id: 'user-1', name: 'Upper Lower', description: null, is_active: true,
  days_per_week: dayCount, days: [...days, day('day-4', 'Lower B')].slice(0, dayCount),
}) as Split;
const inOrder: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-26', mode: 'flex', weekdays: [], anchorDay: 0, flexAnchorIndex: 0, updatedAt: '2026-10-26T08:00:00.000Z' };
const weekly: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-26', mode: 'fixed', weekdays: [1, 3, 5], anchorDay: 1, updatedAt: '2026-10-26T08:00:00.000Z' };

type Plan = { hero: HeroState; schedule: PlanSchedule | null; upNext: SplitDay | null | undefined; seeded?: boolean };
const app = create(() => ({ activeSplit: program(3) as Split | null }));
const todayPlan = create<Plan>(() => ({ hero: { kind: 'loading' }, schedule: inOrder, upNext: undefined }));
const auth = create(() => ({ user: { id: 'user-1' } }));
const revision = create(() => ({ bump: () => {} }));
const save = vi.fn((_userId: string, schedule: PlanSchedule) => schedule);
const back = vi.fn();
let leaveGuarded = false;

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};
type PressableProps = PropsWithChildren<{ onPress: () => void; accessibilityLabel?: string; accessibilityState?: { selected?: boolean } }>;
type PickerProps = PropsWithChildren<{ selection: string; onSelectionChange: (value: string) => void }>;
const pickers: Record<string, PickerProps> = {};

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: ScheduleSheet } = loadNativeModule<{ default: () => ReactNode }>('app/schedule.tsx', {
    '@expo/ui/swift-ui': {
      DatePicker: Empty,
      Host: Wrap,
      Text: Wrap,
      Picker: (props: PickerProps) => {
        pickers[props.selection === 'fixed' || props.selection === 'flex' ? 'mode' : 'start'] = props;
        return createElement(Fragment, null, props.children);
      },
    },
    '@expo/ui/swift-ui/modifiers': { datePickerStyle: noop, pickerStyle: noop, tag: noop },
    'date-fns': dates,
    'expo-router': { router: { back } },
    'expo-symbols': { SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) },
    'react-native': {
      Pressable: ({ onPress, accessibilityLabel, accessibilityState, children }: PressableProps) =>
        createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, 'data-selected': String(Boolean(accessibilityState?.selected)) }, children),
      ScrollView: Wrap,
      View: Wrap,
    },
    '@/lib/planSchedule': { ...planSchedule, savePlanSchedule: save },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: auth },
    '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
    '~/components/Capsule': {
      Capsule: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
        createElement('button', { 'data-capsule': title, disabled: Boolean(disabled), onClick: onPress }, title),
    },
    '~/components/Form': {
      ChoiceRow: ({ title, checked, onPress }: { title: string; checked: boolean; onPress: () => void }) =>
        createElement('button', { onClick: onPress }, title, checked ? createElement('i', { 'data-symbol': 'checkmark' }) : null),
      FormNote: ({ children }: PropsWithChildren) => createElement('p', null, children),
    },
    '~/components/GlassButton': { GlassButton: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Hairline: Empty },
    '~/components/Section': { Section: Wrap },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { select: noop, success: noop } },
    '~/lib/leaveGuard': { useLeaveGuard: (dirty: boolean) => { leaveGuarded = dirty; } },
    '~/lib/today': { useTodayPlan: () => todayPlan(), useScheduleRevision: revision },
    '~/theme/blanc': { space: { inset: 16, gutter: 20, section: 28 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(ScheduleSheet)); });
}

const dayRow = (name: string) => [...host.querySelectorAll('button')].find((button) => button.textContent === name)!;
const checked = () => [...host.querySelectorAll('button')].filter((button) => button.querySelector('[data-symbol="checkmark"]')).map((button) => button.textContent);
const saveButton = () => host.querySelector<HTMLButtonElement>('[data-capsule="Save"]')!;
// The week's circles, as VoiceOver reads the training days among them.
const trainingDays = () =>
  [...host.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? '').filter((label) => label.endsWith('training day'));
const loaded = (plan: Partial<Plan>) => act(async () => { todayPlan.setState(plan); });

beforeEach(() => {
  save.mockClear();
  back.mockClear();
  leaveGuarded = false;
  app.setState({ activeSplit: program(3) });
  todayPlan.setState({ hero: { kind: 'loading' }, schedule: inOrder, upNext: undefined, seeded: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Schedule sheet, in order', () => {
  it('checks the session up next once the plan loads, so Save keeps the rotation', async () => {
    await open();
    // Upper A and Lower A done since the schedule was saved; Lower A today.
    await loaded({ hero: { kind: 'done', title: 'Lower A' }, upNext: days[2] });

    expect(checked()).toEqual(['Upper B']);
    expect(leaveGuarded).toBe(false);
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ mode: 'flex', flexAnchorIndex: 2 }));
  });

  it('waits while the plan shown is the phone’s copy, then checks the session up next', async () => {
    await open();
    // The copy's plan (launchCache) never picks what Save writes.
    await loaded({ hero: { kind: 'planned', day: days[1] }, upNext: days[1], seeded: true });
    expect(checked()).toEqual([]);
    expect(saveButton().disabled).toBe(true);
    await loaded({ hero: { kind: 'done', title: 'Lower A' }, upNext: days[2], seeded: false });
    expect(checked()).toEqual(['Upper B']);
  });

  it('waits for the plan before checking a day or saving one', async () => {
    await open();
    expect(checked()).toEqual([]);
    expect(saveButton().disabled).toBe(true);
  });

  it('keeps a day picked by hand while the plan was loading', async () => {
    await open();
    await act(async () => { dayRow('Lower A').click(); });
    expect(saveButton().disabled).toBe(false);
    await loaded({ hero: { kind: 'rest' }, upNext: days[2] });

    expect(checked()).toEqual(['Lower A']);
    expect(leaveGuarded).toBe(true);
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ flexAnchorIndex: 1 }));
  });

  it('checks today’s session on a planned day', async () => {
    await open();
    await loaded({ hero: { kind: 'planned', day: days[1] }, upNext: days[1] });
    expect(checked()).toEqual(['Lower A']);
  });
});

describe('Schedule sheet, set weekdays', () => {
  const circle = (weekday: string) => [...host.querySelectorAll('button')].find((button) => button.getAttribute('aria-label')?.startsWith(`${weekday},`))!;
  const note = () => [...host.querySelectorAll('p')].map((p) => p.textContent).join(' ');

  it('keeps the days saved though the program’s number of days changed', async () => {
    // Saved for Mon, Wed, Fri; the program now has four days.
    app.setState({ activeSplit: program(4) });
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();

    expect(trainingDays()).toEqual(['Monday, training day', 'Wednesday, training day', 'Friday, training day']);
    expect(note()).toContain('4 program days at 3 sessions a week');
    expect(leaveGuarded).toBe(false);
  });

  it('is unchanged when the days shown are the ones saved', async () => {
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();

    expect(trainingDays()).toEqual(['Monday, training day', 'Wednesday, training day', 'Friday, training day']);
    expect(note()).toContain('Program days follow in order, the same each week.');
    expect(leaveGuarded).toBe(false);
  });

  it('starts a new schedule on the usual days for the program’s length', async () => {
    todayPlan.setState({ hero: { kind: 'no-schedule' }, schedule: null, upNext: null });
    await open();
    expect(trainingDays()).toEqual(['Monday, training day', 'Wednesday, training day', 'Friday, training day']);
  });

  it('switches one day at a tap and saves exactly the days picked', async () => {
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();

    // Train Tuesday, Thursday and Saturday instead.
    for (const name of ['Monday', 'Wednesday', 'Friday', 'Saturday', 'Thursday', 'Tuesday']) {
      await act(async () => { circle(name).click(); });
    }
    expect(trainingDays()).toEqual(['Tuesday, training day', 'Thursday, training day', 'Saturday, training day']);
    expect(circle('Monday').getAttribute('aria-label')).toBe('Monday, rest day');
    expect(circle('Tuesday').dataset.selected).toBe('true');
    expect(leaveGuarded).toBe(true);
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ mode: 'fixed', weekdays: [2, 4, 6], anchorDay: 2 }));
  });

  it('trains on one day or all seven', async () => {
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();
    for (const name of ['Tuesday', 'Thursday', 'Saturday', 'Sunday']) {
      await act(async () => { circle(name).click(); });
    }
    expect(trainingDays()).toHaveLength(7);
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ weekdays: [1, 2, 3, 4, 5, 6, 0] }));
  });

  it('waits for at least one training day before saving, and says so', async () => {
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();
    for (const name of ['Monday', 'Wednesday', 'Friday']) {
      await act(async () => { circle(name).click(); });
    }
    expect(trainingDays()).toEqual([]);
    expect(saveButton().disabled).toBe(true);
    expect(note()).toBe('Pick at least one training day to save.');
    await act(async () => { saveButton().click(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the program’s first day on the weekday it was saved on', async () => {
    // Saved before exact days: Wed, Fri, Sun with Wednesday first.
    const fromWednesday: PlanSchedule = { ...weekly, weekdays: [3, 5, 0], anchorDay: 3 };
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: fromWednesday, upNext: days[1] });
    await open();
    expect(trainingDays()).toEqual(['Wednesday, training day', 'Friday, training day', 'Sunday, training day']);
    await act(async () => { circle('Monday').click(); });
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ weekdays: [3, 5, 0, 1], anchorDay: 3 }));
  });
});

describe('Schedule sheet, Day 1 today', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('starts the plan on the day Save is tapped, though the sheet opened the evening before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 23, 50));
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: null, upNext: null });
    await open();
    vi.setSystemTime(new Date(2026, 10, 5, 0, 10));
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ startDate: '2026-11-05' }));
  });
});
