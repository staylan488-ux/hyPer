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
