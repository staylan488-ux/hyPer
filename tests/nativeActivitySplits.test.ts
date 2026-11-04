// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as dateFns from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as activityMetrics from '@/lib/activityMetrics';
import * as activitySessions from '@/lib/activitySessions';
import * as runDisplay from '@/lib/runDisplay';
import { finishedRunToActivity, type FinishedRun } from '@/lib/runTracker';
import type { ActivitySegment, ActivitySession } from '@/types';
import * as format from '../native/src/lib/format';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// History's activity screen lists a saved run's splits. A rest is shown as on
// the finished run screen: its time, no distance or pace.

const run: FinishedRun = {
  runId: 'run-1',
  mode: 'intervals',
  startedAtMs: Date.parse('2026-10-27T07:00:00.000Z'),
  endedAtMs: Date.parse('2026-10-27T07:04:00.000Z'),
  totalDistanceM: 800,
  elapsedS: 240,
  laps: [
    { index: 1, startedAtMs: Date.parse('2026-10-27T07:00:00.000Z'), endedAtMs: Date.parse('2026-10-27T07:01:30.000Z'), pausedMs: 0, distanceM: 400, trigger: 'manual', kind: 'work' },
    { index: 2, startedAtMs: Date.parse('2026-10-27T07:01:30.000Z'), endedAtMs: Date.parse('2026-10-27T07:02:30.000Z'), pausedMs: 0, distanceM: 67, trigger: 'manual', kind: 'rest' },
    { index: 3, startedAtMs: Date.parse('2026-10-27T07:02:30.000Z'), endedAtMs: Date.parse('2026-10-27T07:04:00.000Z'), pausedMs: 0, distanceM: 333, trigger: 'finish', kind: 'work' },
  ],
  reps: [],
};

function savedSegments(raws?: Array<Record<string, unknown> | null>): ActivitySegment[] {
  return finishedRunToActivity(run, run.runId).segments.map((input, index) => ({
    id: `segment-${index + 1}`,
    user_id: 'user-1',
    session_id: 'activity-1',
    source: input.source,
    external_id: input.external_id,
    sport: input.sport ?? null,
    started_at: input.started_at,
    ended_at: input.ended_at,
    duration_seconds: input.duration_seconds ?? null,
    strain: null,
    avg_hr: null,
    max_hr: null,
    energy_kcal: null,
    distance_m: input.distance_m ?? null,
    raw: raws ? raws[index] : input.raw ?? null,
    created_at: input.started_at,
    updated_at: input.started_at,
  }));
}

const activity = {
  id: 'activity-1',
  activity_type: 'interval_run',
  title: null,
  custom_type: null,
  source: 'gps',
  started_at: '2026-10-27T07:00:00.000Z',
  duration_seconds: 240,
  distance_m: 800,
  notes: null,
  strain: null,
  avg_hr: null,
  max_hr: null,
  energy_kcal: null,
} as unknown as ActivitySession;

let root: Root;
let host: HTMLDivElement;
let segments: ActivitySegment[];

async function renderScreen() {
  const { default: ActivityViewScreen } = loadNativeModule<{ default: () => ReactNode }>('app/(tabs)/train/activity-view.tsx', {
    'date-fns': dateFns,
    'expo-router': {
      router: { back: vi.fn(), push: vi.fn() },
      Stack: { Screen: () => null },
      useFocusEffect: vi.fn(),
      useLocalSearchParams: () => ({ id: 'activity-1' }),
    },
    'react-native': {
      // A value row is one VoiceOver stop: the View around it carries the label.
      View: ({ children, accessible, accessibilityLabel }: { children?: ReactNode; accessible?: boolean; accessibilityLabel?: string }) =>
        createElement('div', accessible ? { role: 'group', 'aria-label': accessibilityLabel } : null, children),
      Pressable: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
    },
    '@/lib/activityMetrics': activityMetrics,
    '@/lib/activitySessions': activitySessions,
    '@/lib/runDisplay': runDisplay,
    '@/stores/appStore': {
      useAppStore: { getState: () => ({ fetchActivitySegmentsBySessionIds: async () => segments }) },
    },
    '~/components/BlancText': { BlancText: ({ children }: { children?: ReactNode }) => createElement('p', null, children) },
    '~/components/Label': { Label: ({ children }: { children?: ReactNode }) => createElement('div', null, children) },
    '~/components/Row': {
      Hairline: () => null,
      Row: (props: { title: string; detail?: string; trailing?: ReactNode }) =>
        createElement('div', { role: 'row' }, [props.title, props.detail].filter(Boolean).join(' | '), props.trailing ? ' | ' : null, props.trailing),
    },
    '~/components/Section': {
      Section: ({ title, children }: { title: string; children?: ReactNode }) => createElement('section', { 'aria-label': title }, children),
    },
    '~/components/TabScroll': { TabScroll: ({ children }: { children?: ReactNode }) => createElement('div', null, children) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: vi.fn() } },
    '~/lib/history': { useHistoryStore: (select: (state: { activities: ActivitySession[] }) => unknown) => select({ activities: [activity] }) },
    '~/lib/format': format,
    '~/theme/blanc': { space: { gutter: 16 }, useBlanc: () => ({ pressed: '#eee' }) },
  });
  await act(async () => { root.render(createElement(ActivityViewScreen)); });
}

function splitRows() {
  return [...host.querySelectorAll('section[aria-label="Splits"] [role="group"]')].map((row) => ({
    text: row.textContent,
    label: row.getAttribute('aria-label'),
  }));
}

describe('a saved run’s splits in History', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows a rest as a rest, with its time and no pace', async () => {
    segments = savedSegments();
    await renderScreen();

    expect(splitRows()).toEqual([
      { text: '1 | 400 m | 1:30 · 6:02 /mi', label: 'Split 1, 400 meters, 1 minute 30 seconds, 6 minutes 2 seconds per mile' },
      { text: '· | rest | 1:00', label: 'Rest, 1 minute' },
      { text: '3 | 333 m | 1:30 · 7:15 /mi', label: 'Split 3, 333 meters, 1 minute 30 seconds, 7 minutes 15 seconds per mile' },
    ]);
  });

  it('keeps a run saved before rests were marked as it was', async () => {
    segments = savedSegments([{ trigger: 'manual' }, { trigger: 'manual' }, { trigger: 'finish' }]);
    await renderScreen();

    expect(splitRows()[1]).toEqual({ text: '2 | 67 m | 1:00 · 24:01 /mi', label: 'Split 2, 67 meters, 1 minute, 24 minutes 1 second per mile' });
  });
});
