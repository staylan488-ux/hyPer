// @vitest-environment happy-dom
import { act, createElement, Fragment, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutSet } from '@/types';

// happy-dom's Web Animations reject `finished` on cancel, which motion leaves
// unhandled; without them motion animates in JS, as in older WebViews.
vi.hoisted(() => {
  for (const proto of [Element.prototype, HTMLElement.prototype]) delete (proto as { animate?: unknown }).animate;
});

// The row reads `logSet` and the live workout from the store; nothing else.
const store = vi.hoisted(() => ({
  state: {
    logSet: (() => Promise.resolve()) as (...args: unknown[]) => Promise<void>,
    currentWorkout: null as { id: string; sets: WorkoutSet[] } | null,
  },
}));
vi.mock('@/stores/appStore', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof store.state) => unknown) => selector(store.state),
    { getState: () => store.state },
  );
  return { useAppStore };
});
vi.mock('@/lib/haptics', () => ({ tapHaptic: () => {}, celebrationHaptic: () => {} }));
vi.mock('@/lib/fx', () => ({ emitBurstFrom: () => {} }));

import { CommandCapsule } from '@/components/metal/CommandCapsule';
import { WorkoutSetRow } from '@/components/workout/WorkoutSetRow';
import { WorkoutCommandCapsule } from '@/components/workout/WorkoutCommandCapsule';
import { getSetEntry } from '@/components/workout/setEntryRegistry';
import { resetCommandCapsule } from '@/lib/commandCapsule';
import { resetWebGLProbe } from '@/lib/motionPolicy';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rowSet = (weight: number | null, reps: number | null, rpe: number | null): WorkoutSet => ({
  id: 'set-row-1', workout_id: 'w1', exercise_id: 'ex-row', set_number: 1, weight, reps, rpe, completed: false, completed_at: null,
});

interface HarnessProps {
  set: WorkoutSet;
  previous?: PreviousWorkoutSetMap;
  initiallyEditing?: boolean;
  onComplete: (set: WorkoutSet) => void;
  onSelect: () => void;
  onBeforeComplete?: (set: WorkoutSet) => Promise<true | string> | true | string;
}

/** Workout.tsx's wiring in miniature: the rows, the capsule hook and the shell's capsule. */
function Harness({ set, previous = {}, initiallyEditing = false, onComplete, onSelect, onBeforeComplete }: HarnessProps) {
  const [editing, setEditing] = useState(initiallyEditing);
  return createElement(Fragment, null,
    createElement(WorkoutCommandCapsule, {
      active: true,
      orderedSets: [set],
      focusOrder: [set.exercise_id],
      editorSet: editing ? set : undefined,
      previousWorkoutSetsByExercise: previous,
      exerciseName: () => 'Barbell Row',
      completedSets: 0,
      totalSets: 1,
      finishing: false,
      onFinish: () => {},
    }),
    createElement(WorkoutSetRow, {
      set, setNumber: 1, editing, exerciseName: 'Barbell Row',
      onSelect: () => { onSelect(); setEditing(true); },
      onHide: () => setEditing(false),
      onBeforeComplete,
      onComplete,
    }),
    createElement(CommandCapsule),
  );
}

let container: HTMLDivElement;
let root: Root;

async function render(props: HarnessProps) {
  store.state.currentWorkout = { id: 'w1', sets: [props.set] };
  await act(async () => { root.render(createElement(Harness, props)); });
  await act(async () => { await Promise.resolve(); });
}

const ring = () => container.querySelector<HTMLButtonElement>('[data-command-capsule] .metal-ring')!;
const inlineCheck = () => container.querySelector<HTMLButtonElement>('.studio-save-set')!;
const click = async (element: HTMLElement) => {
  await act(async () => { element.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
  resetWebGLProbe(false); // the static ring; no GL in happy-dom
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  resetCommandCapsule();
  resetWebGLProbe(null);
});

describe('command capsule logging', () => {
  it.each(['inline', 'capsule'])('saves the selected row through %s when another set has the same number', async (path) => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const onComplete = vi.fn();
    const set = rowSet(200, 5, null);
    await render({ set, onComplete, onSelect: vi.fn(), initiallyEditing: true });
    // Two overlapping Add set requests can produce distinct rows with the
    // same set_number. The ledger displays their positions as set 3 / set 4.
    store.state.currentWorkout!.sets.unshift({ ...set, id: 'earlier-set', completed: true });

    await click(path === 'inline' ? inlineCheck() : ring());

    expect(logSet).toHaveBeenCalledWith(set.id, 200, 5, undefined);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getSetEntry(set.id)!.read().error).toBeNull();
  });

  it('keeps the same row identity if set numbers change while the superset guard is pending', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const set = rowSet(200, 5, null);
    const onComplete = vi.fn();
    let allow!: (verdict: true) => void;
    const verdict = new Promise<true>((resolve) => { allow = resolve; });
    await render({ set, onComplete, onSelect: vi.fn(), onBeforeComplete: () => verdict });
    await click(ring());
    expect(logSet).not.toHaveBeenCalled();
    // A successful guard may await data while another edit compacts numbers.
    store.state.currentWorkout!.sets = [{ ...set, set_number: 2 }];
    await act(async () => { allow(true); await verdict; });
    expect(logSet).toHaveBeenCalledWith(set.id, 200, 5, undefined);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('never saves a replacement row after the selected row is removed', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const onComplete = vi.fn();
    const set = rowSet(200, 5, null);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render({ set, onComplete, onSelect: vi.fn() });
    store.state.currentWorkout!.sets = [{ ...set, id: 'replacement-row' }];

    await click(ring());

    expect(logSet).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(getSetEntry(set.id)!.read()).toMatchObject({ weight: '200', reps: '5' });
    expect(getSetEntry(set.id)!.read().error).toMatch(/Couldn’t confirm/);
    consoleError.mockRestore();
  });

  it('the ring and the inline check run the same save with the same arguments', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const onComplete = vi.fn();
    const onSelect = vi.fn();
    const set = rowSet(80, 10, 7);
    await render({ set, onComplete, onSelect, initiallyEditing: true });

    expect(inlineCheck().getAttribute('aria-label')).toBe('Save set 1 of Barbell Row');
    await click(inlineCheck());
    const inlineCall = logSet.mock.calls[0];
    expect(inlineCall).toEqual(['set-row-1', 80, 10, 7]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(set);

    expect(ring().getAttribute('aria-label')).toBe('Log Barbell Row set 1: 80 pounds, 10 reps, RPE 7');
    await click(ring());
    expect(logSet).toHaveBeenCalledTimes(2);
    expect(logSet.mock.calls[1]).toEqual(inlineCall);
    expect(onComplete).toHaveBeenCalledTimes(2);
    // With the editor open both paths pin it, exactly like the inline check.
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('logs from a closed row without opening it', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const onSelect = vi.fn();
    const onComplete = vi.fn();
    await render({ set: rowSet(80, 10, null), onComplete, onSelect });

    await click(ring());
    expect(logSet).toHaveBeenCalledWith('set-row-1', 80, 10, undefined);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a failed save keeps the shown values as a draft, offers Retry, and completes only after success', async () => {
    const logSet = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    store.state.logSet = logSet;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onComplete = vi.fn();
    const set = rowSet(null, null, null);
    // Nothing typed: the capsule offers last workout's set 1 as a suggestion.
    await render({ set, onComplete, onSelect: vi.fn(), previous: { 'ex-row': { 1: { weight: 75, reps: 9, rpe: 8 } } } });
    expect(container.querySelectorAll('[data-command-capsule] .metal-capsule-value.is-suggested')).toHaveLength(3);

    await click(ring());
    expect(logSet).toHaveBeenLastCalledWith('set-row-1', 75, 9, 8);
    expect(onComplete).not.toHaveBeenCalled(); // no rest timer after a failed save
    const entry = getSetEntry(set.id)!.read();
    expect(entry).toMatchObject({ weight: '75', reps: '9', rpe: '8', hasDraft: true, saving: false });
    expect(entry.error).toMatch(/Couldn’t confirm this set was saved/);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/tap Retry/);
    expect(ring().getAttribute('aria-label')).toBe('Retry saving Barbell Row set 1: 75 pounds, 9 reps, RPE 8');
    expect(container.querySelector('[data-command-capsule] .metal-capsule-caption')?.textContent).toBe('Not saved · Barbell Row · Set 1');

    await click(ring());
    expect(logSet).toHaveBeenCalledTimes(2);
    expect(logSet).toHaveBeenLastCalledWith('set-row-1', 75, 9, 8);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getSetEntry(set.id)!.read()).toMatchObject({ error: null, hasDraft: false });
    expect(consoleError).toHaveBeenCalledWith('Failed to log set:', expect.any(Error));
    consoleError.mockRestore();
  });

  it('allows 0 lb and 0 reps', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    await render({ set: rowSet(0, 0, null), onComplete: vi.fn(), onSelect: vi.fn() });
    await click(ring());
    expect(logSet).toHaveBeenCalledWith('set-row-1', 0, 0, undefined);
  });

  it('runs the superset order guard before saving', async () => {
    const logSet = vi.fn(() => Promise.resolve());
    store.state.logSet = logSet;
    const onComplete = vi.fn();
    const set = rowSet(80, 10, null);
    await render({ set, onComplete, onSelect: vi.fn(), onBeforeComplete: () => 'Complete A1 before logging B1.' });
    await click(ring());
    expect(logSet).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(getSetEntry(set.id)!.read().error).toBe('Complete A1 before logging B1.');
  });

  it('a value tap opens the row and focuses that field', async () => {
    store.state.logSet = vi.fn(() => Promise.resolve());
    const onSelect = vi.fn();
    await render({ set: rowSet(80, 10, 7), onComplete: vi.fn(), onSelect });
    expect(container.querySelector<HTMLFormElement>('.studio-set-editor')!.hidden).toBe(true);

    const reps = container.querySelector<HTMLButtonElement>('[data-command-capsule] [aria-label="10 reps. Edit"]')!;
    await click(reps);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLFormElement>('.studio-set-editor')!.hidden).toBe(false);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Reps');
  });
});
