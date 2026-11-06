// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WeeklyNutritionData } from '@/hooks/useWeeklyNutrition';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useWeeklyNutrition (src/hooks/useWeeklyNutrition.ts): seven days of calories
// and protein. Progress asks for the seven ending yesterday, so today (which
// Today and Fuel show) is never in its average; with no day given, the seven
// end today, as before.

type Log = { date: string; servings: number; food_id: string; food: { id: string; calories: number; protein: number } };
let logs: Log[] = [];
const fetchNutritionLogsWithFoods = vi.fn(async (_user: string, range: { from: string; to: string }) => ({
  // As the query does: only the logs within the range.
  data: logs.filter((log) => log.date >= range.from && log.date <= range.to),
  error: null,
}));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => 'me' }));
vi.mock('@/lib/nutritionLogQueries', () => ({ fetchNutritionLogsWithFoods: (...args: Parameters<typeof fetchNutritionLogsWithFoods>) => fetchNutritionLogsWithFoods(...args) }));

const { averageLoggedDays, useWeeklyNutrition } = await import('@/hooks/useWeeklyNutrition');

const log = (date: string, calories: number, protein = 0): Log => ({ date, servings: 1, food_id: date, food: { id: date, calories, protein } });

let root: Root;
let host: HTMLDivElement;
const seen: { current: WeeklyNutritionData | null } = { current: null };

function Probe({ lastDay }: { lastDay?: string }) {
  const data = useWeeklyNutrition(lastDay);
  useEffect(() => {
    seen.current = data;
  });
  return null;
}
async function read(lastDay?: string) {
  await act(async () => { root.render(createElement(Probe, { lastDay })); });
  await act(async () => { for (let tick = 0; tick < 5; tick += 1) await Promise.resolve(); });
  return seen.current!;
}

beforeEach(() => {
  logs = [];
  seen.current = null;
  fetchNutritionLogsWithFoods.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('useWeeklyNutrition', () => {
  it('reads the seven days ending the day it is given, oldest first, across a month', async () => {
    logs = [log('2026-10-28', 9999), log('2026-10-29', 1800, 120), log('2026-11-02', 2400, 150), log('2026-11-04', 2000, 130), log('2026-11-05', 700, 40)];
    const week = await read('2026-11-04');
    expect(fetchNutritionLogsWithFoods.mock.calls[0][1]).toEqual({ from: '2026-10-29', to: '2026-11-04' });
    expect(week.loading).toBe(false);
    expect(week.weeklyNutrition.map((day) => day.date)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    // Today's 700 (Nov 5) and the day before the seven are left out of the average.
    expect(averageLoggedDays(week.weeklyNutrition, 'calories')).toBe((1800 + 2400 + 2000) / 3);
    expect(averageLoggedDays(week.weeklyNutrition, 'protein')).toBe((120 + 150 + 130) / 3);
  });

  it('gives nothing to chart when nothing is logged in those days, even with today logged', async () => {
    logs = [log('2026-11-05', 700)];
    const week = await read('2026-11-04');
    expect(week.weeklyNutrition).toEqual([]);
    expect(week.error).toBeNull();
  });

  it('still ends today when no day is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
    logs = [log('2026-11-05', 700)];
    const week = await read();
    expect(fetchNutritionLogsWithFoods.mock.calls[0][1]).toEqual({ from: '2026-10-30', to: '2026-11-05' });
    expect(week.weeklyNutrition.at(-1)).toEqual({ date: '2026-11-05', calories: 700, protein: 0 });
  });

  it('reads again when the day it ends on moves on', async () => {
    await read('2026-11-04');
    await read('2026-11-05');
    expect(fetchNutritionLogsWithFoods.mock.calls.map((call) => call[1].to)).toEqual(['2026-11-04', '2026-11-05']);
  });
});
