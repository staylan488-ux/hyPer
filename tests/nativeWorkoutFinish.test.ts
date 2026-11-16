// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { captureAccountScope, invalidateAccountScope } from '@/lib/accountScope';
import * as finishRules from '@/lib/workoutFinish';
import type { SessionModel } from '../native/src/lib/sessionModel';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Button = { text: string; onPress?: () => void };
const session = (workoutId: string) => ({
  workoutId, flexible: true, dayName: 'Pull', doneCount: 1, sets: [{}],
  movements: [{ exerciseId: 'row', skipped: false }],
}) as unknown as SessionModel;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

let root: Root;
let host: HTMLDivElement;
let buttons: Button[];
let currentSession: SessionModel | null;
let useFinishWorkout: (value: SessionModel | null) => { finish: () => void; closing: boolean };
const push = vi.fn();
const showSummary = vi.fn();
const flushNotes = vi.fn<() => Promise<boolean>>();
const store = {
  currentWorkout: { id: 'workout-A' } as { id: string } | null,
  currentWorkoutDayPlan: { day_label: 'Pull' },
  flexTemplates: [],
  saveFlexibleTemplateFromCurrentWorkout: vi.fn<() => Promise<void>>(),
  completeWorkout: vi.fn<() => Promise<void>>(),
  fetchFlexTemplates: vi.fn<() => Promise<void>>(),
  removeUnloggedSets: vi.fn<() => Promise<void>>(),
};
function Probe() {
  const { finish, closing } = useFinishWorkout(currentSession);
  return createElement('button', { onClick: finish, disabled: closing }, 'Finish');
}
async function confirm(saveTemplate = true) {
  await act(async () => { host.querySelector('button')!.click(); });
  await act(async () => {
    buttons.find((button) => button.text === (saveTemplate ? 'Finish and save as quick start' : 'Finish'))?.onPress?.();
  });
}

describe('Finish keeps the confirmed workout and account', () => {
  beforeEach(async () => {
    invalidateAccountScope();
    currentSession = session('workout-A');
    store.currentWorkout = { id: 'workout-A' };
    push.mockReset();
    showSummary.mockReset();
    flushNotes.mockReset().mockResolvedValue(true);
    store.saveFlexibleTemplateFromCurrentWorkout.mockReset().mockResolvedValue();
    store.completeWorkout.mockReset().mockImplementation(async () => { store.currentWorkout = null; currentSession = null; });
    store.fetchFlexTemplates.mockReset().mockResolvedValue();
    store.removeUnloggedSets.mockReset().mockResolvedValue();
    ({ useFinishWorkout } = loadNativeModule<{ useFinishWorkout: typeof useFinishWorkout }>('lib/finishWorkout.ts', {
      'expo-router': { router: { push } },
      'react-native': { Keyboard: { dismiss: vi.fn() }, Alert: { alert: (_title: string, _message: string, next: Button[]) => { buttons = next; } } },
      zustand: { create },
      '@/lib/accountScope': { captureAccountScope },
      '@/stores/appStore': { useAppStore: { getState: () => store } },
      '@/lib/workoutFinish': finishRules,
      './finished': { summarize: (value: SessionModel) => ({ workoutId: value.workoutId }), useFinishedStore: { getState: () => ({ set: showSummary }) } },
      './haptics': { haptics: { error: vi.fn(), success: vi.fn() } },
      './notes': { flushNotes },
      './rest': { stopRest: vi.fn() },
      './session': { liveSessionModel: () => currentSession, previousHistoryFor: () => ({}), previousTargetsFor: () => ({}) },
      './records': { priorRecordsFor: () => ({}) },
      './sessionModel': { skippedLine: () => '' },
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(Probe)); });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('still completes the confirmed session and shows its summary after the template saves', async () => {
    await confirm();
    expect(store.completeWorkout).toHaveBeenCalledTimes(1);
    expect(showSummary).toHaveBeenCalledWith({ workoutId: 'workout-A' });
    expect(push).toHaveBeenCalledWith('/session-done');
  });

  it('takes out the skipped movements’ unlogged sets before closing, and stays open to try again when that fails', async () => {
    currentSession = { ...session('workout-A'), movements: [{ exerciseId: 'row', skipped: false }, { exerciseId: 'curl', skipped: true }] } as unknown as SessionModel;
    store.removeUnloggedSets.mockRejectedValueOnce(new Error('Could not save that change.'));
    await confirm(false);
    expect(store.removeUnloggedSets).toHaveBeenCalledWith('workout-A', ['curl']);
    // Nothing says it finished while the saved workout would still hold the skipped sets.
    expect(store.completeWorkout).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(showSummary).not.toHaveBeenCalled();

    await confirm(false);
    expect(store.removeUnloggedSets).toHaveBeenCalledTimes(2);
    expect(store.completeWorkout).toHaveBeenCalledTimes(1);
    expect(store.removeUnloggedSets.mock.invocationCallOrder[1]).toBeLessThan(store.completeWorkout.mock.invocationCallOrder[0]);
    expect(push).toHaveBeenCalledWith('/session-done');
  });

  it('does not finish a replacement workout while the quick start is saving', async () => {
    const saved = deferred();
    store.saveFlexibleTemplateFromCurrentWorkout.mockReturnValue(saved.promise);
    await confirm();
    expect(store.saveFlexibleTemplateFromCurrentWorkout).toHaveBeenCalledTimes(1);
    currentSession = session('workout-B');
    store.currentWorkout = { id: 'workout-B' };
    await act(async () => { saved.resolve(); });

    expect(store.completeWorkout).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(showSummary).not.toHaveBeenCalled();
  });

  it('does not reuse an old confirmation after signing out and back into the same workout', async () => {
    await act(async () => { host.querySelector('button')!.click(); });
    invalidateAccountScope();
    await act(async () => { buttons.find((button) => button.text === 'Finish')?.onPress?.(); });

    expect(flushNotes).not.toHaveBeenCalled();
    expect(store.completeWorkout).not.toHaveBeenCalled();
  });

  it('does not navigate or publish the previous account’s summary after completion returns', async () => {
    const completed = deferred();
    store.completeWorkout.mockReturnValue(completed.promise);
    await confirm(false);
    expect(store.completeWorkout).toHaveBeenCalledTimes(1);
    invalidateAccountScope();
    currentSession = session('workout-B');
    store.currentWorkout = { id: 'workout-B' };
    await act(async () => { completed.resolve(); });

    expect(showSummary).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps editing disabled through the quick-start and completion saves', async () => {
    const template = deferred();
    const completed = deferred();
    store.saveFlexibleTemplateFromCurrentWorkout.mockReturnValue(template.promise);
    store.completeWorkout.mockReturnValue(completed.promise);
    await confirm();
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => { template.resolve(); });
    expect(store.completeWorkout).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => { completed.resolve(); });
    expect(host.querySelector('button')!.disabled).toBe(false);
  });

  it('finishes a fully logged program session without asking', async () => {
    buttons = [];
    currentSession = { ...session('workout-A'), flexible: false } as SessionModel;
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { host.querySelector('button')!.click(); });
    expect(buttons).toEqual([]);
    expect(store.completeWorkout).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/session-done');
  });

  it('still asks before finishing a program session with sets left', async () => {
    buttons = [];
    currentSession = { ...session('workout-A'), flexible: false, doneCount: 1, sets: [{}, {}] } as unknown as SessionModel;
    await act(async () => { root.render(createElement(Probe)); });
    await act(async () => { host.querySelector('button')!.click(); });
    expect(buttons.map((button) => button.text)).toEqual(['Finish', 'Keep going']);
    expect(store.completeWorkout).not.toHaveBeenCalled();
  });

  it('reenables editing when Finish cannot save', async () => {
    store.saveFlexibleTemplateFromCurrentWorkout.mockRejectedValue(new Error('offline'));
    await confirm();
    expect(store.completeWorkout).not.toHaveBeenCalled();
    expect(host.querySelector('button')!.disabled).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
