// Captured before the first await of an account-bound operation. Resetting
// the store invalidates work even if the same user signs back in later.
let generation = 0;

export function getAccountScopeGeneration(): number {
  return generation;
}

export function captureAccountScope(): () => boolean {
  const startedIn = generation;
  return () => generation === startedIn;
}

export function invalidateAccountScope(): void {
  generation += 1;
}
