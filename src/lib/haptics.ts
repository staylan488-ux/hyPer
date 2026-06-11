/**
 * Haptics — a light tactile tick for meaningful touches.
 *
 * iOS has no web Vibration API. As of iOS 18, Safari's native switch control
 * (<input type="checkbox" switch>) emits a real system haptic when toggled,
 * and a programmatic click inside a genuine user gesture still counts. We keep
 * one hidden switch around and click it. On Android we use navigator.vibrate.
 *
 * Tiers (by convention at call sites — the tick itself is single-intensity):
 *  - selection: nav tabs, segmented controls, chips, wheel detents
 *  - action: logging a set, finish, steppers, timer controls
 * Never wire it to typing, scrolling, or passive touches.
 *
 * Haptics are garnish: every path fails silently.
 */

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

let switchEl: HTMLInputElement | null = null;

function ensureSwitch(): HTMLInputElement {
  if (switchEl && document.body.contains(switchEl)) return switchEl;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.position = 'fixed';
  input.style.top = '-100px';
  input.style.left = '0';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  document.body.appendChild(input);
  switchEl = input;
  return input;
}

/** Fire a light haptic tick. Call synchronously from inside a tap handler. */
export function tapHaptic(): void {
  try {
    if (isIOS) {
      ensureSwitch().click();
      return;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  } catch {
    // Unsupported or denied — silently do nothing.
  }
}
