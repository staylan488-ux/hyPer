import { createContext } from 'react';

// First-use hints (native/src/lib/hints.ts) for screen tests that don't test
// them: no hint shows, and a swipe or hold marks nothing.
const HintScope = createContext<string | null>(null);
export const hintImports = {
  '~/components/Hint': { Hint: () => null },
  '~/lib/hints': { HintScope, useHintScope: () => null, markHintDone: () => {}, resetHints: () => {}, setHintAccount: () => {} },
};
