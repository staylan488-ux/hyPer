// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as warmupPlates from '@/lib/warmupPlates';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Warm-up sheet (native/src/app/warm-up.tsx), opened from the set card's
// Warm-up or Plates chip with the weight typed there. Before a movement's
// first set it lists warm-ups to tick off (never logged); on a barbell it
// draws the plates for the working weight and keeps the bar picked for the
// movement on this phone.

type Props = Record<string, unknown> & { children?: ReactNode };

const Box = ({ children }: Props) => createElement('div', null, children);
const Empty = () => null;
const Text = ({ children }: Props) => createElement('span', null, children);
const Section = ({ title, note, children }: Props) =>
  createElement('section', { 'data-title': title as string, 'data-note': note as string | undefined }, children);
const Row = ({ title, detail, quiet, accessibilityLabel, onPress }: Props) =>
  createElement(
    'button',
    { 'data-row': title as string, 'data-quiet': quiet ? 'true' : undefined, 'aria-label': accessibilityLabel as string, onClick: onPress as () => void },
    [title, detail].filter(Boolean).join(' | '),
  );
const PlateBar = ({ perSide, accessibilityLabel }: Props) =>
  createElement('figure', { 'data-plates': (perSide as number[]).join(','), 'aria-label': accessibilityLabel as string });
let menuChange: ((value: string) => void) | null = null;
const MenuRow = ({ label, value, options, onChange }: Props) => {
  menuChange = onChange as (value: string) => void;
  return createElement('div', { 'data-menu': label as string, 'data-value': value as string }, (options as { label: string }[]).map((option) => option.label).join(','));
};

const storage = new Map<string, string>();
const authStore = create(() => ({ user: { id: 'me' } as { id: string } | null }));
const warmup = loadNativeModule<typeof import('../native/src/lib/warmup')>('lib/warmup.ts', {
  zustand: { create },
  '@/lib/warmupPlates': warmupPlates,
  '@/stores/authStore': { useAuthStore: authStore },
});

let params: { id: string; weight?: string };
let session: Record<string, unknown> | null;
const set = (id: string, completed: boolean) => ({
  id,
  exercise_id: 'squat',
  completed,
  exercise: { id: 'squat', name: 'Barbell Back Squat', equipment: 'barbell', is_compound: true },
});

function liveSession(done: number, equipment = 'barbell') {
  const sets = [set('s1', done > 0), set('s2', done > 1), set('s3', false)].map((entry) => ({
    ...entry,
    exercise: { ...entry.exercise, equipment, name: equipment === 'barbell' ? 'Barbell Back Squat' : 'Leg Press' },
  }));
  return {
    workoutId: 'w1',
    movements: [{ exerciseId: 'squat', name: equipment === 'barbell' ? 'Barbell Back Squat' : 'Leg Press', sets, done }],
  };
}

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: WarmUpSheet } = loadNativeModule<{ default: () => ReactNode }>('app/warm-up.tsx', {
    'expo-router': { router: { back: vi.fn() }, useLocalSearchParams: () => params },
    'expo-symbols': { SymbolView: ({ name }: Props) => createElement('i', { 'data-symbol': name as string }) },
    'react-native': { ScrollView: Box, View: Box },
    '@/lib/warmupPlates': warmupPlates,
    '~/components/BlancText': { BlancText: Text },
    '~/components/Form': { FormNote: Text, MenuRow },
    '~/components/GlassButton': { GlassButton: Empty },
    '~/components/Label': { Label: Box },
    '~/components/PlateBar': { PlateBar, spokenPlates: (perSide: number[], bar: number) => `${perSide.join(' ')} on a ${bar}` },
    '~/components/Row': { Hairline: Empty, Row },
    '~/components/Section': { Section },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/format': format,
    '~/lib/session': { useSessionModel: () => session },
    '~/lib/setEntry': { parseNumber: (text: string) => (text.trim() === '' ? null : Number(text)) },
    '~/lib/warmup': warmup,
    '~/theme/blanc': { space: { gutter: 16, inset: 16, section: 26 }, useBlanc: () => ({}) },
  });
  await act(async () => {
    root.render(createElement(WarmUpSheet));
  });
}

const rows = () => [...host.querySelectorAll<HTMLButtonElement>('[data-row]')].map((row) => row.textContent);
const row = (title: string) => host.querySelector<HTMLButtonElement>(`[data-row="${title}"]`)!;
const sections = () => [...host.querySelectorAll<HTMLElement>('section')].map((section) => [section.dataset.title, section.dataset.note ?? null]);

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  });
  storage.clear();
  authStore.setState({ user: { id: 'me' } });
  warmup.useWarmupStore.setState({ userId: null, bars: {}, ticked: {} });
  params = { id: 'squat', weight: '225' };
  session = liveSession(0);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the warm-up sheet', () => {
  it('lists the ramp before the first set, with each step\'s plates, then the working set\'s', async () => {
    await open();
    expect(sections()).toEqual([
      ['Warm-up sets', null],
      ['Working set', '225 lb'],
    ]);
    expect(rows()).toEqual(['Bar × 10 | Empty bar', '95 × 5 | 25 each side', '135 × 3 | 45 each side', '185 × 2 | 45 · 25 each side']);
    expect(row('135 × 3').getAttribute('aria-label')).toBe('135 pounds for 3 reps, 45 each side');
    expect(row('Bar × 10').getAttribute('aria-label')).toBe('The bar, 45 pounds for 10 reps');
    expect(host.querySelector('figure')?.dataset.plates).toBe('45,45');
    expect(host.textContent).toContain('45 · 45 each side');
  });

  it('ticks a warm-up off and on, and keeps it when the sheet opens again', async () => {
    await open();
    await act(async () => row('135 × 3').click());
    expect(row('135 × 3').dataset.quiet).toBe('true');
    expect(row('135 × 3').getAttribute('aria-label')).toBe('135 pounds for 3 reps, 45 each side, done');
    act(() => root.unmount());
    root = createRoot(host);
    await open();
    expect(row('135 × 3').dataset.quiet).toBe('true');
    await act(async () => row('135 × 3').click());
    expect(row('135 × 3').dataset.quiet).toBeUndefined();
  });

  it('is the plates alone once a set is logged', async () => {
    session = liveSession(1);
    await open();
    expect(rows()).toEqual([]);
    expect(sections()).toEqual([['225 lb', null]]);
  });

  it('says when the weight sits between plate steps, or under the bar', async () => {
    session = liveSession(1);
    params = { id: 'squat', weight: '187' };
    await open();
    expect(host.textContent).toContain('45 · 25 each side');
    expect(host.textContent).toContain('Loads 185 lb, the closest under 187');
    params = { id: 'squat', weight: '30' };
    act(() => root.unmount());
    root = createRoot(host);
    await open();
    expect(host.textContent).toContain('Lighter than the 45 lb bar');
  });

  it('keeps the bar picked for the movement, and loads from it', async () => {
    await open();
    expect(host.querySelector<HTMLElement>('[data-menu="Bar"]')?.dataset.value).toBe('45');
    await act(async () => menuChange?.('35'));
    expect(host.querySelector<HTMLElement>('[data-menu="Bar"]')?.dataset.value).toBe('35');
    expect(rows()[0]).toBe('Bar × 10 | Empty bar');
    expect(host.querySelector('figure')?.dataset.plates).toBe('45,45,5');
    expect(JSON.parse(storage.get('hyper:bar-weights:me') ?? '{}')).toEqual({ squat: 35 });
  });

  it('gives a machine movement its ramp without plates or a bar', async () => {
    session = liveSession(0, 'machine');
    params = { id: 'squat', weight: '300' };
    await open();
    expect(rows()).toEqual(['150 × 8', '225 × 4']);
    expect(host.querySelector('figure')).toBeNull();
    expect(host.querySelector('[data-menu]')).toBeNull();
  });
});
