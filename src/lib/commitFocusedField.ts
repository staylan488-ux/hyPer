// Commits the focused text field before a submit handler reads state. The app
// does it through native/src/platform/commitFocusedField.ts, which
// native/metro.config.js swaps in for this file (it must stay so the swap can
// resolve). Outside the app there is no field to commit, so this does nothing.
export function commitFocusedField(): void {}
