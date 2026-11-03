import { describe, expect, it } from 'vitest';

import { prepareWorkoutFinish, trackWorkoutSetSave } from '@/lib/workoutFinish';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('workout Finish confirmation', () => {
  for (const timing of ['before confirmation', 'while confirming'] as const) {
    it(`uses the saved set when its write succeeds ${timing}`, async () => {
      const workoutId = `success-${timing}`;
      let session = { workoutId, loggedSets: 0, volume: 0 };
      const request = deferred();
      const save = trackWorkoutSetSave(workoutId, request.promise.then(() => {
        session = { workoutId, loggedSets: 1, volume: 800 };
      }));
      const confirm = prepareWorkoutFinish(workoutId, () => session);
      if (timing === 'before confirmation') { request.resolve(); await save; }
      const finishing = confirm();
      if (timing === 'while confirming') request.resolve();
      expect(await finishing).toEqual({ kind: 'ready', session: { workoutId, loggedSets: 1, volume: 800 } });
    });

    it(`keeps the workout open when its write fails ${timing}`, async () => {
      const workoutId = `failure-${timing}`;
      const session = { workoutId, loggedSets: 0 };
      const request = deferred();
      const save = trackWorkoutSetSave(workoutId, request.promise).catch(() => undefined);
      const confirm = prepareWorkoutFinish(workoutId, () => session);
      if (timing === 'before confirmation') { request.reject(new Error('offline')); await save; }
      const finishing = confirm();
      if (timing === 'while confirming') request.reject(new Error('offline'));
      expect(await finishing).toEqual({ kind: 'save-failed' });
      await save;
      // A fresh Finish tap can intentionally finish with the unlogged set;
      // the failure does not permanently lock the workout.
      expect(await prepareWorkoutFinish(workoutId, () => session)()).toEqual({ kind: 'ready', session });
    });
  }

  it('also waits for a correction begun after the question opened', async () => {
    const workoutId = 'later-correction';
    let session = { workoutId, volume: 800 };
    const confirm = prepareWorkoutFinish(workoutId, () => session);
    const request = deferred();
    const save = trackWorkoutSetSave(workoutId, request.promise.then(() => { session = { workoutId, volume: 900 }; }));
    const finishing = confirm();
    request.resolve();
    await save;
    expect(await finishing).toEqual({ kind: 'ready', session: { workoutId, volume: 900 } });
  });

  it('always reads current state even when no set was pending', async () => {
    let session = { workoutId: 'current', name: 'Before' };
    const confirm = prepareWorkoutFinish(session.workoutId, () => session);
    session = { ...session, name: 'After' };
    expect(await confirm()).toEqual({ kind: 'ready', session });
  });

  it('does not finish a workout that was replaced or closed while confirming', async () => {
    let session: { workoutId: string } | null = { workoutId: 'old' };
    const confirm = prepareWorkoutFinish('old', () => session);
    session = { workoutId: 'new' };
    expect(await confirm()).toEqual({ kind: 'changed' });
    session = null;
    expect(await confirm()).toEqual({ kind: 'changed' });
  });

  it('does not wait for another workout or account’s set save', async () => {
    const request = deferred();
    const save = trackWorkoutSetSave('another-workout', request.promise).catch(() => undefined);
    const session = { workoutId: 'this-workout' };
    expect(await prepareWorkoutFinish(session.workoutId, () => session)()).toEqual({ kind: 'ready', session });
    request.reject(new Error('offline'));
    await save;
  });
});
