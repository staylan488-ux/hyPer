// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';
import { savedLine, type FinishedSummary } from '../native/src/lib/finished';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Session complete (native/src/app/session-done.tsx) is top-anchored, its
// reward first: the day as the large title, one quiet line saying how the
// session ended and when, then the card with the tally, the beats in ink and
// the facts. A session left short is never called complete.

type Props = Record<string, unknown> & { children?: ReactNode };

// Native views as divs that keep what VoiceOver gets, in the order it reads them.
const View = ({ children, accessible, accessibilityRole, accessibilityLabel }: Props) =>
  createElement(
    'div',
    { 'data-accessible': accessible ? 'true' : undefined, 'data-role': accessibilityRole as string | undefined, 'aria-label': accessibilityLabel as string | undefined },
    children,
  );
const Text = ({ children, variant, tone, size, accessibilityRole, accessibilityElementsHidden }: Props) =>
  createElement(
    'span',
    {
      'data-variant': (variant as string | undefined) ?? 'body',
      'data-tone': (tone as string | undefined) ?? 'ink',
      'data-size': size as number | undefined,
      'data-role': accessibilityRole as string | undefined,
      'aria-hidden': accessibilityElementsHidden ? 'true' : undefined,
    },
    children,
  );
const Tally = ({ accessibilityLabel }: Props) => createElement('div', { 'data-tally': 'true', 'data-accessible': 'true', 'aria-label': accessibilityLabel as string });
const Capsule = ({ title }: Props) => createElement('button', { 'data-accessible': 'true' }, title as string);

let summary: FinishedSummary;

/** Upper A on Friday, November 6 at 1:17 AM: nine sets planned. */
function finished(sets: number, beat: number): FinishedSummary {
  return {
    dayName: 'Upper A',
    startedAt: new Date(2026, 10, 6, 1, 17),
    finishedAt: new Date(2026, 10, 6, 2, 9),
    marks: Array.from({ length: 9 }, (_, index) => index < sets),
    sets,
    beat,
    volume: 12400,
    minutes: 52,
    best: { name: 'Bench Press', weight: 185, reps: 6 },
    records: [],
  };
}

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: SessionDone } = loadNativeModule<{ default: () => ReactNode }>(
    'app/session-done.tsx',
    {
      'date-fns': dates,
      'expo-router': { router: { dismiss: vi.fn(), navigate: vi.fn() } },
      'react-native': { ScrollView: View, View },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) },
      '@/lib/supabase': { supabase: {} },
      '@/stores/appStore': { useAppStore: create(() => ({ activeSplit: { days_per_week: 4 } })) },
      // Signed out: the week's count never loads, so the footer only says where it went.
      '@/stores/authStore': { useAuthStore: create(() => ({ user: null })) },
      '~/components/BlancText': { BlancText: Text },
      '~/components/Capsule': { Capsule },
      '~/components/Label': { Label: View },
      '~/components/Tally': { Tally },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/finished': { savedLine, useFinishedStore: create(() => ({ summary })) },
      '~/lib/workoutBar': { useTabBarExpand: { getState: () => ({ expand: () => undefined }) } },
      '~/lib/format': format,
      '~/theme/blanc': { space: { gutter: 16, inset: 16, section: 26 }, useBlanc: () => ({}) },
    },
    { compile: true },
  );
  await act(async () => {
    root.render(createElement(SessionDone));
  });
}

const spans = () => [...host.querySelectorAll<HTMLElement>('span')];
const spanNamed = (words: string) => spans().find((span) => span.textContent === words);
/** What VoiceOver stops on, in reading order: accessible elements, and text that stands on its own (Text is accessible). */
const voiceOver = () =>
  [...host.querySelectorAll<HTMLElement>('[data-accessible="true"], span')]
    .filter((element) => element.tagName !== 'SPAN' || (!element.parentElement?.closest('[data-accessible="true"]') && element.getAttribute('aria-hidden') !== 'true'))
    .map((element) => element.getAttribute('aria-label') ?? element.textContent);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Session complete\'s title and line', () => {
  it('leads with the day as a 34 pt title, then one quiet line: complete, and when', async () => {
    summary = finished(9, 4);
    await open();
    const title = spanNamed('Upper A')!;
    expect(title.dataset.size).toBe('34');
    const line = spanNamed('Session complete · Friday, November 6 · 1:17 AM')!;
    expect({ variant: line.dataset.variant, tone: line.dataset.tone }).toEqual({ variant: 'secondary', tone: 'graphite' });
    // The title comes first on the screen, before the card.
    expect(spans().indexOf(title)).toBe(0);
    expect(spans().indexOf(line)).toBe(1);
  });

  it('never calls a session left short complete: it says how much was logged', async () => {
    summary = finished(5, 0);
    await open();
    expect(spanNamed('5 of 9 sets · Friday, November 6 · 1:17 AM')).toBeDefined();
    expect(host.textContent).not.toContain('complete');
  });

  it('announces the outcome first: the day, how it ended and when, as the screen\'s heading', async () => {
    summary = finished(5, 0);
    await open();
    const heading = host.querySelector<HTMLElement>('[data-role="header"]')!;
    expect(heading.getAttribute('aria-label')).toBe('Upper A. 5 of 9 sets, Friday, November 6, 1:17 AM');
    expect(voiceOver()[0]).toBe('Upper A. 5 of 9 sets, Friday, November 6, 1:17 AM');
    expect(host.querySelectorAll('[data-role="header"]')).toHaveLength(1);
  });
});

describe('Session complete\'s card', () => {
  it('leads with the beats in ink, after the tally and before the facts', async () => {
    summary = finished(9, 4);
    await open();
    const beats = spanNamed('4 sets beat last time')!;
    expect({ variant: beats.dataset.variant, tone: beats.dataset.tone }).toEqual({ variant: 'body', tone: 'ink' });
    expect(voiceOver()).toEqual([
      'Upper A. Session complete, Friday, November 6, 1:17 AM',
      '9 of 9 sets logged',
      '4 sets beat last time',
      'Volume, 12,400 pounds',
      'Time, 52 minutes',
      'Best set, 185 pounds × 6, Bench Press',
      'Saved to History',
      'Done',
    ]);
  });

  it('says one beat in the singular, and nothing when no set beat last time', async () => {
    summary = finished(9, 1);
    await open();
    expect(spanNamed('1 set beat last time')).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    summary = finished(9, 0);
    await open();
    expect(host.textContent).not.toContain('beat last time');
  });

  it('drops the Sets and Beat last time rows: the tally, the line and the lead say them', async () => {
    summary = finished(5, 2);
    await open();
    const rows = spans().filter((span) => span.dataset.tone === 'graphite' && span.dataset.variant === 'secondary').map((span) => span.textContent);
    expect(rows).toEqual(['5 of 9 sets · Friday, November 6 · 1:17 AM', 'Volume', 'Time', 'Best set']);
    expect(spanNamed('Sets')).toBeUndefined();
    expect(spanNamed('Beat last time')).toBeUndefined();
  });
});

describe('Session complete\'s records', () => {
  it('names each record after the beats, one stop each, and says a best set that is a record once', async () => {
    summary = {
      ...finished(9, 4),
      records: [
        { exerciseId: 'bench', name: 'Bench Press', kind: 'max', set: { weight: 185, reps: 6 } },
        { exerciseId: 'pullup', name: 'Pull-up', kind: 'reps', set: { weight: 0, reps: 14 } },
      ],
    };
    await open();
    const heading = spanNamed('2 new records')!;
    expect({ variant: heading.dataset.variant, tone: heading.dataset.tone }).toEqual({ variant: 'body', tone: 'ink' });
    expect(voiceOver()).toEqual([
      'Upper A. Session complete, Friday, November 6, 1:17 AM',
      '9 of 9 sets logged',
      '4 sets beat last time',
      'New record, Bench Press, 185 pounds × 6',
      'New record, Pull-up, 14 reps',
      'Volume, 12,400 pounds',
      'Time, 52 minutes',
      'Saved to History',
      'Done',
    ]);
  });

  it('says one record in the singular, keeps a best set that is not a record, and says nothing without one', async () => {
    summary = { ...finished(9, 0), records: [{ exerciseId: 'row', name: 'Barbell Row', kind: 'heaviest', set: { weight: 155, reps: 8 } }] };
    await open();
    expect(spanNamed('New record')).toBeDefined();
    expect(spanNamed('Best set')).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    summary = finished(9, 0);
    await open();
    expect(host.textContent).not.toContain('record');
  });
});
