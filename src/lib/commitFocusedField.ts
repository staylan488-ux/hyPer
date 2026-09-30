import { flushSync } from 'react-dom';

/**
 * Blurs the focused text field so its commit-on-blur runs before a submit
 * handler reads state. The iOS numeric keypad has no Enter key, and WebKit
 * does not always move focus when a button is tapped, so a typed value could
 * otherwise still be an uncommitted draft. flushSync applies the resulting
 * React updates before this returns.
 */
export function commitFocusedField(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
  flushSync(() => active.blur());
}
