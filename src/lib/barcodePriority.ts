/**
 * Starts every provider lookup at once, then returns the first non-null result
 * in the given priority order. It never takes whichever answers fastest: a
 * lower-priority hit waits until every higher-priority leg has missed. Each
 * leg's failure is caught the moment it starts, so a lower-priority rejection
 * while a higher leg is still pending can't surface as an unhandled rejection,
 * and it counts as a miss, the same as in a sequential chain.
 */
export async function resolveBarcodeByPriority<P extends string, T>(
  legs: ReadonlyArray<readonly [P, () => Promise<T | null>]>,
): Promise<{ provider: P; value: T } | null> {
  const started = legs.map(([provider, run]) => {
    let pending: Promise<T | null>;
    try {
      pending = run();
    } catch {
      pending = Promise.resolve(null);
    }
    return [provider, pending.catch(() => null)] as const;
  });

  for (const [provider, pending] of started) {
    const value = await pending;
    if (value) return { provider, value };
  }
  return null;
}
