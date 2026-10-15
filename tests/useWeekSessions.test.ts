// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const read = vi.hoisted(() => ({ impl: (() => Promise.resolve<string[]>([])) as (userId: string, dayKey: string) => Promise<string[]> }));
vi.mock('@/lib/weekSessions', () => ({ readWeekSessionDates: (userId: string, dayKey: string) => read.impl(userId, dayKey) }));

import { useWeekSessions, type WeekSessions } from '@/hooks/useWeekSessions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

function Probe({ refresh }: { refresh: number }) {
  const sessions = useWeekSessions('user-1', '2026-10-15', refresh);
  return createElement('output', { 'data-state': JSON.stringify(sessions) });
}

const latest = (): WeekSessions => JSON.parse(host.querySelector('output')?.getAttribute('data-state') ?? 'null');

const render = async (refresh = 0) => {
  await act(async () => { root.render(createElement(Probe, { refresh })); });
  await act(async () => { await Promise.resolve(); });
};

describe('useWeekSessions', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('returns the week’s dates once the read lands', async () => {
    read.impl = () => Promise.resolve(['2026-10-13', '2026-10-15']);
    await render();
    expect(latest()).toEqual({ dates: ['2026-10-13', '2026-10-15'], failed: false });
  });

  it('reports a failed read instead of waiting forever', async () => {
    read.impl = () => Promise.reject(new Error('offline'));
    await render();
    expect(latest()).toEqual({ dates: null, failed: true });
  });

  it('keeps the last good dates when a refresh fails', async () => {
    read.impl = () => Promise.resolve(['2026-10-13']);
    await render(0);
    read.impl = () => Promise.reject(new Error('offline'));
    await render(1);
    expect(latest()).toEqual({ dates: ['2026-10-13'], failed: false });
  });
});
