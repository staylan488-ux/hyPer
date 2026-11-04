// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as activitySessions from '@/lib/activitySessions';
import * as types from '@/types';
import type { ActivitySession, ActivitySessionInput } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The activity sheet (native/src/app/activity.tsx). Its form holds whole
// minutes and HH:mm, so an edit must keep the stored times it did not touch.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

type FieldProps = { value: string; onChangeText: (text: string) => void };
type PickerProps = { value: Date; max?: Date; onChange: (value: Date) => void };
let fields: Record<string, FieldProps>;
let pickers: Record<string, PickerProps>;
let saveButton: { onPress: () => void };
let params: { id?: string; day?: string };
const saveActivity = vi.fn<(editing: ActivitySession | null, input: ActivitySessionInput) => Promise<boolean>>(async () => true);

// A GPS run: 27:34 of running inside 29:03 on the clock (a pause), started at 14:05:17.
const run = {
  id: 'run-1', user_id: 'user-1', activity_type: 'run', custom_type: null, title: null, date: '2026-11-02',
  started_at: '2026-11-02T14:05:17.400Z', ended_at: '2026-11-02T14:34:20.400Z', duration_seconds: 1654,
  source: 'gps', notes: null, distance_m: 5000,
} as ActivitySession;

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: ActivitySheet } = loadNativeModule<{ default: () => ReactNode }>('app/activity.tsx', {
    'date-fns': dates,
    'expo-router': { router: { back: noop }, useLocalSearchParams: () => params },
    'react-native': {
      ActionSheetIOS: { showActionSheetWithOptions: noop },
      Pressable: ({ children }: { children: ReactNode | ((state: { pressed: boolean }) => ReactNode) }) =>
        createElement(Fragment, null, typeof children === 'function' ? children({ pressed: false }) : children),
      View: Wrap,
    },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: Wrap },
    '@/lib/activitySessions': activitySessions,
    '@/types': types,
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': {
      Capsule: (props: { title: string; onPress: () => void }) => {
        if (props.title === 'Save') saveButton = props;
        return null;
      },
    },
    '~/components/Form': {
      FieldRow: (props: FieldProps & { label: string }) => {
        fields[props.label] = props;
        return null;
      },
      FormNote: Wrap,
      PickerRow: (props: PickerProps & { label: string }) => {
        pickers[props.label] = props;
        return null;
      },
    },
    '~/components/GlassButton': { GlassButton: Empty },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/lib/accountData': { useCurrentDayKey: () => dates.format(new Date(), 'yyyy-MM-dd') },
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/history': {
      confirmDeleteActivity: async () => false,
      saveActivity,
      useHistoryStore: create(() => ({ activities: [run] })),
    },
    '~/lib/leaveGuard': { useLeaveGuard: noop },
    '~/theme/blanc': { space: { section: 28 }, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(ActivitySheet)); });
}

const save = async () => {
  await act(async () => { saveButton.onPress(); });
  expect(saveActivity).toHaveBeenCalledTimes(1);
  return saveActivity.mock.calls[0][1];
};

beforeEach(() => {
  fields = {};
  pickers = {};
  params = { id: 'run-1' };
  saveActivity.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('editing an activity', () => {
  it('keeps a run’s start, end and duration to the second when only its title changes', async () => {
    await open();
    expect(fields.Duration.value).toBe('28');
    await act(async () => { fields.Title.onChangeText('Tempo'); });

    const input = await save();
    expect(input).toMatchObject({
      title: 'Tempo',
      started_at: run.started_at,
      ended_at: run.ended_at,
      duration_seconds: 1654,
    });
  });

  it('keeps the start’s seconds when only the duration changes, and ends the run from there', async () => {
    await open();
    await act(async () => { fields.Duration.onChangeText('30'); });

    const input = await save();
    expect(input).toMatchObject({ started_at: run.started_at, duration_seconds: 1800, ended_at: '2026-11-02T14:35:17.400Z' });
  });

  it('keeps the duration to the second when the run moves to another day', async () => {
    await open();
    await act(async () => { pickers.Date.onChange(new Date(2026, 10, 1)); });

    const input = await save();
    expect(input.date).toBe('2026-11-01');
    expect(input.duration_seconds).toBe(1654);
    expect(new Date(input.ended_at!).getTime() - new Date(input.started_at!).getTime()).toBe(1654 * 1000);
    expect(dates.format(new Date(input.started_at!), 'yyyy-MM-dd')).toBe('2026-11-01');
  });
});

describe('adding an activity', () => {
  it('starts a future day from History on today, where the date picker ends', async () => {
    params = { day: '2999-01-01' };
    await open();
    const today = dates.format(new Date(), 'yyyy-MM-dd');
    expect(dates.format(pickers.Date.value, 'yyyy-MM-dd')).toBe(today);
    expect(pickers.Date.value.getTime()).toBeLessThanOrEqual(pickers.Date.max!.getTime());

    await act(async () => { fields.Duration.onChangeText('45'); });
    expect((await save()).date).toBe(today);
  });

  it('starts on a past day from History as chosen', async () => {
    params = { day: '2026-10-12' };
    await open();
    expect(dates.format(pickers.Date.value, 'yyyy-MM-dd')).toBe('2026-10-12');
  });
});
