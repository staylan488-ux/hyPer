// @vitest-environment happy-dom
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { todayHero, type HeroState } from '@/lib/todayModel';
import type { Split } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Today's and Train's plan card for a day already trained
// (native/src/components/PlanCard.tsx). The day stays as its record, read
// from History, and holds the record's place while that read runs. A day
// shown from the phone's copy (Instant launch) says "Trained today" from the
// first frame instead, and keeps saying so until the record lands, also once
// this launch's own reads decide the day again.

type Finished = {
  id: string;
  title: string;
  splitDayId: string | null;
  marks: boolean[];
  sets: number;
  minutes: number | null;
};
type Props = { hero: HeroState; next: string | null; place: 'today' | 'train'; seeded?: boolean };

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const noop = () => {};
// History's read of today's workout: undefined while it runs.
const history = create<{ finished: Finished | null | undefined }>(() => ({ finished: undefined }));
const programs = create<{ splits: Split[] }>(() => ({ splits: [] }));
const push = vi.fn();

const { PlanCard } = loadNativeModule<{ PlanCard: (props: Props) => ReactNode }>(
  'components/PlanCard.tsx',
  {
    'expo-router': { router: { navigate: noop, push } },
    '@/stores/appStore': { useAppStore: programs },
    'react-native': {
      Pressable: ({ children }: PropsWithChildren) => createElement('div', { 'data-card': 'pressable' }, children),
      View: ({ children, style }: PropsWithChildren<{ style?: { height?: number } }>) =>
        createElement('div', { 'data-height': style?.height ?? '' }, children),
    },
    'react-native-reanimated': { default: { View: Wrap }, FadeIn: { duration: () => undefined } },
    '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
    '~/components/Capsule': {
      Capsule: ({ title, onPress }: { title: string; onPress: () => void }) => createElement('button', { onClick: onPress }, title),
    },
    '~/components/Label': {
      Label: ({ children, style }: PropsWithChildren<{ style?: unknown }>) => {
        const flat = [style].flat(2) as ({ minHeight?: number } | undefined)[];
        const minHeight = flat.find((entry) => entry?.minHeight)?.minHeight ?? '';
        return createElement('section', { 'data-min-height': minHeight }, children);
      },
    },
    '~/components/Tally': { Tally: ({ accessibilityLabel }: { accessibilityLabel: string }) => createElement('i', null, accessibilityLabel) },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/format': { formatMinutes: (minutes: number) => `${minutes} min` },
    '~/lib/haptics': { haptics: { tap: noop } },
    '~/lib/session': { useStartSession: () => ({ starting: null, start: async () => false }) },
    '~/lib/today': { useFinishedToday: (done: boolean) => history((state) => (done ? state.finished : null)) },
    '~/theme/blanc': { useBlanc: () => ({ pressed: '#eee' }) },
  },
  { compile: true },
);

const record: Finished = { id: 'w1', title: 'Push', splitDayId: 'push', marks: [true, true, false], sets: 2, minutes: 52 };
const done: HeroState = { kind: 'done', title: 'Session complete' };

let root: Root;
let host: HTMLDivElement;

async function show(props: Props) {
  await act(async () => {
    root.render(createElement(PlanCard, props));
  });
}

beforeEach(() => {
  history.setState({ finished: undefined });
  programs.setState({ splits: [] });
  push.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

describe('Plan card without an active program', () => {
  it.each(['today', 'train'] as const)('offers existing programs on %s and creation only when none remain', async (place) => {
    const saved = { id: 'saved', name: 'Upper lower', is_active: false, days: [] } as unknown as Split;
    programs.setState({ splits: [saved] });
    const hero = todayHero({
      heroLoading: false, currentWorkout: null, currentWorkoutDayPlan: null,
      splits: [saved], todayDone: null, workoutMode: 'split', activeSplit: null,
      schedule: null, scheduleLoading: false, scheduleWorkoutsLoading: false,
      scheduleWorkouts: [], scheduleError: false, retrySchedule: noop,
      refreshedAt: Date.parse('2026-11-04T12:00:00Z'), dayKey: '2026-11-04', adaptiveSchedulingEnabled: false,
    });
    await show({ hero, next: null, place });
    expect(host.textContent).toContain('No active program');
    expect(host.textContent).toContain('Choose a program to use');
    expect(host.querySelector('button')?.textContent).toBe('Choose');
    await act(async () => host.querySelector('button')?.click());
    expect(push).toHaveBeenCalledWith('/train/program');

    // Deleting the last saved program changes the still-open card.
    await act(async () => programs.setState({ splits: [] }));
    expect(host.textContent).toContain('No program yet');
    expect(host.textContent).toContain('Five questions, or start blank');
    expect(host.querySelector('button')?.textContent).toBe('Create');
    await act(async () => host.querySelector('button')?.click());
    expect(push).toHaveBeenLastCalledWith('/train/program');
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Plan card for a day already trained', () => {
  it('holds the record\'s place, blank, while History is read for a day decided this launch', async () => {
    await show({ hero: done, next: 'Tomorrow · Legs', place: 'today' });

    expect(host.textContent).toBe('');
    expect(host.querySelector('[data-height="104"]')).not.toBeNull();

    await act(async () => history.setState({ finished: record }));
    expect(host.textContent).toContain('Push');
    expect(host.textContent).toContain('Trained today · 52 min · Next: Legs');
    expect(host.textContent).toContain('2 of 3 sets logged');
  });

  it('says "Trained today" from the first frame when the day comes from the phone\'s copy', async () => {
    await show({ hero: done, next: 'Tomorrow · Legs', place: 'today', seeded: true });
    expect(host.textContent).toContain('Trained today');
    expect(host.textContent).toContain('Next: Tomorrow · Legs');

    await show({ hero: done, next: 'Tomorrow · Legs', place: 'train', seeded: true });
    expect(host.textContent).toContain('Trained today');
    // At the record's height, so the record fills in without the card changing size.
    expect(host.querySelector('[data-min-height="104"]')).not.toBeNull();
  });

  it('keeps saying so once this launch decides the day again, until the record lands', async () => {
    await show({ hero: done, next: 'Tomorrow · Legs', place: 'train', seeded: true });
    expect(host.textContent).toContain('Trained today');

    // This launch's own reads decide the same day; History's read still runs.
    await show({ hero: done, next: null, place: 'train', seeded: false });
    expect(host.textContent).toContain('Trained today');
    expect(host.querySelector('[data-height="104"]')).toBeNull();

    await act(async () => history.setState({ finished: record }));
    expect(host.textContent).toContain('Push');
    expect(host.textContent).toContain('2 of 3 sets logged');
  });

  it('holds the place again for a later day trained after the seeded one has left', async () => {
    await show({ hero: done, next: null, place: 'train', seeded: true });
    await show({ hero: { kind: 'rest' }, next: null, place: 'train', seeded: false });
    expect(host.textContent).toContain('Rest day');

    await show({ hero: done, next: null, place: 'train', seeded: false });
    expect(host.textContent).toBe('');
    expect(host.querySelector('[data-height="104"]')).not.toBeNull();
  });

  it('says "Trained today" when History has no record of it', async () => {
    history.setState({ finished: null });
    await show({ hero: done, next: 'Tomorrow · Legs', place: 'today' });

    expect(host.textContent).toContain('Trained today');
    expect(host.textContent).toContain('Next: Tomorrow · Legs');
  });
});
