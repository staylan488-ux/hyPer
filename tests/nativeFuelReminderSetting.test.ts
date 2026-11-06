// @vitest-environment happy-dom
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as plan from '../native/src/lib/fuelReminderPlan';
import { loadNativeModule } from './helpers/loadNativeModule';

// You's Fuel reminder card through its real rules, with the Form rows,
// Capsule and Label stubbed to record what the card hands them.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);

type Toggle = { label: string; value: boolean; disabled?: boolean; list?: boolean; onChange: (value: boolean) => void };
type Picker = { label: string; mode: string; value: Date; min?: Date; max?: Date; onChange: (value: Date) => void };
type Note = { alert?: boolean; children: ReactNode };
type Button = { title: string; variant?: string; onPress: () => void };

// The latest props each row was drawn with; what is on the card is read from the page.
let toggle: Toggle | null;
let picker: Picker | null;

const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: 'user-1' } }));
const app = create(() => ({
  macroTarget: { calories: 2800, protein: 160 } as { calories: number; protein: number } | null,
  nutritionProfile: { goal: 'bulk' } as { goal: string } | null,
  macroTargetLoadedForUserId: 'user-1' as string | null,
}));
const reminder = create(() => ({
  userId: 'user-1' as string | null,
  settings: { enabled: false, minutes: 1200 },
  permission: 'granted' as string | null,
}));
const setFuelReminderEnabled = vi.fn();
const setFuelReminderTime = vi.fn();
const openSettings = vi.fn(async () => {});

let root: Root;
let host: HTMLDivElement;
let FuelReminderSetting: () => ReactNode;

const render = async () => {
  await act(async () => { root.render(createElement(FuelReminderSetting)); });
};
/** A change while the card is on screen. */
const change = async (step: () => void) => {
  await act(async () => { step(); });
};
const notes = () => [...host.querySelectorAll('p')].map((note) => ({ alert: note.dataset.alert === 'true', text: note.textContent }));
const noteText = () => notes().map((note) => note.text);
const buttons = () => [...host.querySelectorAll('button')];
const timeRow = () => host.querySelector('time');

beforeEach(() => {
  auth.setState({ user: { id: 'user-1' } });
  app.setState({ macroTarget: { calories: 2800, protein: 160 }, nutritionProfile: { goal: 'bulk' }, macroTargetLoadedForUserId: 'user-1' });
  reminder.setState({ userId: 'user-1', settings: { enabled: false, minutes: 1200 }, permission: 'granted' });
  toggle = null;
  picker = null;
  ({ FuelReminderSetting } = loadNativeModule<{ FuelReminderSetting: () => ReactNode }>('components/FuelReminderSetting.tsx', {
    'react-native': { Linking: { openSettings } },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: auth },
    '~/lib/fuelReminder': { setFuelReminderEnabled, setFuelReminderTime, useFuelReminderStore: reminder },
    '~/lib/fuelReminderPlan': plan,
    '~/lib/motion': { blockExit: 'blockExit', rowEnter: 'rowEnter', rowLayout: 'rowLayout' },
    '~/theme/blanc': { space: { section: 30, inset: 16 } },
    './Capsule': {
      Capsule: ({ title, variant, onPress }: Button) => createElement('button', { 'data-variant': variant, onClick: onPress }, title),
    },
    './Form': {
      FormNote: ({ alert, children }: Note) => createElement('p', { 'data-alert': String(Boolean(alert)) }, children),
      PickerRow: (props: Picker) => {
        picker = props;
        return createElement('time', null, props.label);
      },
      ToggleRow: (props: Toggle) => { toggle = props; return null; },
    },
    './Label': { Label: Wrap },
    './Row': { Hairline: () => null },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const GAINING = 'Reminds you when calories or protein are well below today’s targets. Stops once you reach them.';
const PROTEIN = 'Reminds you when protein is well below today’s target. Stops once you reach it.';
const DENIED = 'Notifications are off for hyPer. Allow them in Settings to get this reminder.';

describe('the Fuel reminder card', () => {
  it('starts with the switch alone and the quiet note', async () => {
    await render();
    expect(toggle).toMatchObject({ label: 'Fuel reminder', value: false, disabled: false, list: true });
    expect(picker).toBeNull();
    expect(timeRow()).toBeNull();
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);
    expect(buttons()).toEqual([]);

    toggle!.onChange(true);
    expect(setFuelReminderEnabled).toHaveBeenCalledWith(true);
  });

  it('keeps the quiet note while off, even with notifications refused', async () => {
    reminder.setState({ permission: 'denied' });
    await render();
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);
    expect(buttons()).toEqual([]);
  });

  it('shows the evening time when on, kept to 5:00 PM to 11:00 PM', async () => {
    reminder.setState({ settings: { enabled: true, minutes: 1230 } });
    await render();
    expect(toggle?.value).toBe(true);
    expect(timeRow()?.textContent).toBe('Time');
    expect(picker).toMatchObject({ label: 'Time', mode: 'time' });
    expect(plan.minutesOf(picker!.value)).toBe(1230);
    expect(plan.minutesOf(picker!.min!)).toBe(17 * 60);
    expect(plan.minutesOf(picker!.max!)).toBe(23 * 60);
    // The picker's range is a time of day: the same day as the value it shows.
    expect(picker!.min!.toDateString()).toBe(picker!.value.toDateString());
    expect(picker!.max!.toDateString()).toBe(picker!.value.toDateString());
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);

    picker!.onChange(new Date(2026, 0, 15, 21, 30));
    expect(setFuelReminderTime).toHaveBeenCalledWith(21 * 60 + 30);

    await change(() => reminder.setState({ settings: { enabled: false, minutes: 1290 } }));
    expect(toggle?.value).toBe(false);
    expect(timeRow()).toBeNull();
  });

  it('turns the note red with Open Settings when on and refused, and back once allowed', async () => {
    reminder.setState({ settings: { enabled: true, minutes: 1200 }, permission: 'denied' });
    await render();
    expect(notes()).toEqual([{ alert: true, text: DENIED }]);
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].textContent).toBe('Open Settings');
    expect(buttons()[0].dataset.variant).toBe('quiet');
    await change(() => buttons()[0].click());
    expect(openSettings).toHaveBeenCalledTimes(1);

    await change(() => reminder.setState({ permission: 'granted' }));
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);
    expect(buttons()).toEqual([]);
  });

  it('keeps the quiet note while the answer is still to come', async () => {
    reminder.setState({ settings: { enabled: true, minutes: 1200 }, permission: 'undetermined' });
    await render();
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);
    await change(() => reminder.setState({ permission: null }));
    expect(notes()).toEqual([{ alert: false, text: GAINING }]);
    expect(buttons()).toEqual([]);
  });

  it('asks for targets only once they have loaded without calories', async () => {
    app.setState({ macroTarget: { calories: 0, protein: 160 } });
    await render();
    expect(noteText()).toEqual(['Set your targets to get this reminder.']);

    await change(() => app.setState({ macroTarget: null }));
    expect(noteText()).toEqual(['Set your targets to get this reminder.']);

    // Still loading: the goal's note, not a flash of "Set your targets".
    await change(() => app.setState({ macroTargetLoadedForUserId: null }));
    expect(noteText()).toEqual([GAINING]);
    // Another account's targets do not count.
    await change(() => app.setState({ macroTargetLoadedForUserId: 'user-2' }));
    expect(noteText()).toEqual([GAINING]);
  });

  it('speaks of protein only off a bulk', async () => {
    app.setState({ nutritionProfile: { goal: 'cut' } });
    await render();
    expect(noteText()).toEqual([PROTEIN]);
    await change(() => app.setState({ nutritionProfile: { goal: 'maintain' } }));
    expect(noteText()).toEqual([PROTEIN]);
    await change(() => app.setState({ nutritionProfile: null }));
    expect(noteText()).toEqual([PROTEIN]);
    await change(() => app.setState({ nutritionProfile: { goal: 'lean_bulk' } }));
    expect(noteText()).toEqual([GAINING]);
  });

  it('holds the switch until this account’s setting has loaded', async () => {
    reminder.setState({ userId: null });
    await render();
    expect(toggle?.disabled).toBe(true);

    await change(() => {
      reminder.setState({ userId: 'user-1' });
      auth.setState({ user: { id: 'user-2' } });
    });
    expect(toggle?.disabled).toBe(true);

    await change(() => reminder.setState({ userId: 'user-2' }));
    expect(toggle?.disabled).toBe(false);
  });
});
