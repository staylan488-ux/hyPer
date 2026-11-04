// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as calendar from '@/lib/nutritionCalendar';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Read = { data: { date: string }[] | null; error: unknown };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => { root?.unmount(); root = undefined; });
  vi.useRealTimers();
});

/** The real month sheet; only views, the store and the date read are stand-ins. */
async function openMonthSheet(reads: Array<Promise<Read>>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T10:00:00'));
  const read = vi.fn(() => reads.shift() ?? Promise.resolve({ data: [], error: null }));
  const query = { select: () => query, eq: () => query, gte: () => query, lte: read };
  const fuel = { selected: '2026-11-03', loadedMonth: '2026-11', logs: [{ date: '2026-11-02' }], select: vi.fn() };
  const pan = { activeOffsetX: () => pan, failOffsetY: () => pan, runOnJS: () => pan, onEnd: () => pan };
  const Box = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  const Press = ({ accessibilityLabel, onPress, children }: { accessibilityLabel?: string; onPress?: () => void; children?: ReactNode }) =>
    createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }, children);
  const Sheet = loadNativeModule<{ default: ComponentType }>('app/fuel-month.tsx', {
    'date-fns': dates,
    'expo-router': { router: { back: vi.fn() } },
    'react-native': { Pressable: Press, View: Box },
    'react-native-gesture-handler': { Gesture: { Pan: () => pan }, GestureDetector: Box },
    '@/lib/nutritionCalendar': calendar,
    '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
    '@/lib/supabase': { supabase: { from: () => query } },
    '~/components/BlancText': { BlancText: ({ children }: { children?: ReactNode }) => createElement('span', null, children) },
    '~/components/GlassButton': { GlassButton: ({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress }) },
    '~/lib/fuel': { dayKey: (date: Date) => dates.format(date, 'yyyy-MM-dd'), useFuelStore: { getState: () => fuel } },
    '~/lib/haptics': { haptics: { tap: vi.fn(), select: vi.fn() } },
    '~/theme/blanc': { useBlanc: () => ({}) },
  }).default;
  const container = document.createElement('div');
  root = createRoot(container);
  await act(async () => { root!.render(createElement(Sheet)); });
  const press = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent === label);
    expect(button, label).toBeDefined();
    await act(async () => { button!.click(); });
  };
  const hasEntries = (day: string) => container.querySelector(`[aria-label="${day}, has entries"]`) !== null;
  return { container, press, hasEntries, read };
}

const FAILED = 'Couldn’t load this month. Tap to try again.';

describe('Fuel month sheet', () => {
  it('says another month could not load instead of showing it empty, and tries again on a tap', async () => {
    const sheet = await openMonthSheet([
      Promise.resolve({ data: null, error: new Error('offline') }),
      Promise.resolve({ data: [{ date: '2026-10-12' }], error: null }),
    ]);
    expect(sheet.hasEntries('Monday, November 2')).toBe(true);
    expect(sheet.container.textContent).not.toContain(FAILED);
    await sheet.press('Previous month');
    expect(sheet.container.textContent).toContain('October 2026');
    expect(sheet.container.textContent).toContain(FAILED);
    await sheet.press(FAILED);
    expect(sheet.read).toHaveBeenCalledTimes(2);
    expect(sheet.container.textContent).not.toContain(FAILED);
    expect(sheet.hasEntries('Monday, October 12')).toBe(true);
  });

  it('drops the failure on the way back to the month Fuel has loaded', async () => {
    const sheet = await openMonthSheet([Promise.resolve({ data: null, error: new Error('offline') })]);
    await sheet.press('Previous month');
    expect(sheet.container.textContent).toContain(FAILED);
    await sheet.press('Next month');
    expect(sheet.container.textContent).toContain('November 2026');
    expect(sheet.container.textContent).not.toContain(FAILED);
    expect(sheet.hasEntries('Monday, November 2')).toBe(true);
  });

  it('treats a read that throws as not loaded', async () => {
    const october = deferred<Read>();
    const sheet = await openMonthSheet([october.promise]);
    await sheet.press('Previous month');
    await act(async () => { october.reject(new Error('network')); });
    expect(sheet.container.textContent).toContain(FAILED);
  });

  it('never marks the month on screen with a failure from a month left behind', async () => {
    const october = deferred<Read>();
    const sheet = await openMonthSheet([october.promise, Promise.resolve({ data: [{ date: '2026-09-30' }], error: null })]);
    await sheet.press('Previous month');
    await sheet.press('Previous month');
    expect(sheet.container.textContent).toContain('September 2026');
    await act(async () => { october.reject(new Error('late failure')); });
    expect(sheet.container.textContent).not.toContain(FAILED);
    expect(sheet.hasEntries('Wednesday, September 30')).toBe(true);
  });
});
