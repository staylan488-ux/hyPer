// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';

import * as howToLines from '@/lib/movementHowTo';
import type { HowTo } from '@/lib/movementHowTo';
import { loadNativeModule } from './helpers/loadNativeModule';

// The movement sheet's "How to do it" row: which movements have one, and
// when it starts open (docs/movement-how-to.md).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Fold = { open: boolean; toggle: () => void };
type Module = {
  howToFor: (movement: { name: string; sets: Array<{ exercise?: { name: string; equipment: string | null } }> }) => HowTo | null;
  howToStartsOpen: (sessions: number | null) => boolean;
  useHowToFold: (workoutId: string, exerciseId: string) => Fold;
};
type Lookup = { workoutId: string | null; history: Record<string, unknown[]> };

let root: Root;
let host: HTMLDivElement;
let howTo: Module;
let fold: Fold;
const lookup = create<Lookup>(() => ({ workoutId: null, history: {} }));

function Probe({ id }: { id: string }) {
  fold = howTo.useHowToFold('live', id);
  return null;
}
const open = (id: string) => act(async () => { root.render(createElement(Probe, { id, key: `${id}-${Math.random()}` })); });

describe('the How to do it row', () => {
  beforeEach(() => {
    lookup.setState({ workoutId: 'live', history: { curl: [{}], squat: [{}, {}, {}] } });
    howTo = loadNativeModule<Module>('lib/howTo.ts', {
      zustand: { create },
      '@/lib/movementHowTo': howToLines,
      './session': { usePreviousTargetsStore: lookup },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('reads the lines from the exercise the sets hold, else from the name', () => {
    expect(howTo.howToFor({ name: 'Curl', sets: [{}, { exercise: { name: 'Seated Leg Curl', equipment: 'machine' } }] })?.study).toBe('maeo2021');
    expect(howTo.howToFor({ name: 'Hack Squat', sets: [] })?.study).toBe('haugen2023');
    expect(howTo.howToFor({ name: 'Mystery Lift', sets: [] })).toBeNull();
  });

  it('starts open while the movement is new, and folded when the lookup has not landed', () => {
    expect([0, 1, 2, 3, 30].map(howTo.howToStartsOpen)).toEqual([true, true, true, false, false]);
    expect(howTo.howToStartsOpen(null)).toBe(false);
  });

  it('opens for a movement done fewer than three times, and stays folded for a familiar one', async () => {
    await open('new');
    expect(fold.open).toBe(true);
    await open('curl');
    expect(fold.open).toBe(true);
    await open('squat');
    expect(fold.open).toBe(false);
  });

  it('stays folded when the lookup belongs to another workout', async () => {
    lookup.setState({ workoutId: 'earlier' });
    await open('new');
    expect(fold.open).toBe(false);
  });

  it('keeps the person’s choice for that movement when the sheet opens again', async () => {
    await open('new');
    await act(async () => fold.toggle());
    expect(fold.open).toBe(false);
    await open('new');
    expect(fold.open).toBe(false);
    // Another movement keeps its own state.
    await open('curl');
    expect(fold.open).toBe(true);
    await open('squat');
    await act(async () => fold.toggle());
    expect(fold.open).toBe(true);
  });
});
