// Coalesces concurrent calls per key: while a run for a key is in flight, a
// later run(key) shares that promise instead of starting a second one. The
// entry clears when the run settles (success, null or rejection), so the next
// call after that starts fresh.
export function createKeyedSingleFlight<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    run(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise: Promise<T> = (async () => fn())().finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
  };
}

// Coalesces concurrent reads per key that commit their result to shared
// state. Nothing is kept after a read settles, so a failure is never reused
// and the next call reads again. invalidate() is for writers: a read already
// running may hold rows from before the write, so it stops being current (its
// isCurrent() check fails and it must not commit), and the next run() starts
// a new read instead of sharing it.
export function createReadFlight() {
  const inFlight = new Map<string, Promise<void>>();
  let generation = 0;

  return {
    run(key: string, read: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const startedIn = generation;
      const isCurrent = () => generation === startedIn;
      const promise: Promise<void> = (async () => read(isCurrent))().finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    invalidate() {
      generation += 1;
      inFlight.clear();
    },
  };
}
