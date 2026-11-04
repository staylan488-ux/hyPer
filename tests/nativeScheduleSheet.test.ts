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

type Plan = { hero: HeroState; schedule: PlanSchedule | null; upNext: SplitDay | null | undefined };
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
const loaded = (plan: Partial<Plan>) => act(async () => { todayPlan.setState(plan); });

beforeEach(() => {
  save.mockClear();
  back.mockClear();
  leaveGuarded = false;
  app.setState({ activeSplit: program(3) });
  todayPlan.setState({ hero: { kind: 'loading' }, schedule: inOrder, upNext: undefined });
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
  it('counts a rhythm rebuilt for a changed number of program days as a change', async () => {
    // Saved for three days a week; the program now has four.
    app.setState({ activeSplit: program(4) });
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();

    expect(host.textContent).toContain('Mon / Tue / Thu / Fri');
    expect(leaveGuarded).toBe(true);
    await act(async () => { saveButton().click(); });
    expect(save).toHaveBeenCalledWith('user-1', expect.objectContaining({ mode: 'fixed', weekdays: [1, 2, 4, 5] }));
  });

  it('is unchanged when the rhythm shown is the one saved', async () => {
    todayPlan.setState({ hero: { kind: 'rest' }, schedule: weekly, upNext: days[1] });
    await open();

    expect(host.textContent).toContain('Mon / Wed / Fri');
    expect(leaveGuarded).toBe(false);
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
