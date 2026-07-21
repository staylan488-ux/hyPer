/**
 * Haptics — a light tactile tick for meaningful touches.
 *
 * iOS has no web Vibration API. Since iOS 18, Safari's native switch control
 * (<input type="checkbox" switch>) emits a real system haptic when toggled.
 * Crucially, the haptic fires on LABEL-driven activation: we create a
 * label-wrapped switch, click the label inside the user gesture, and remove
 * it. The pair never needs to render — document.head works.
 *
 * Android uses navigator.vibrate. Everything fails silently.
 *
 * Tiers (by convention at call sites — the tick itself is single-intensity):
 *  - selection: nav tabs, segmented controls, chips, wheel detents
 *  - action: logging a set, finish, steppers, timer controls
 * Never wire it to typing, scrolling, or passive touches.
 *
 * In the native app the Capacitor Haptics engine takes over (works on every
 * iOS version and gives calibrated intensities); the tricks below remain the
 * web fallback.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Fire a light haptic tick. Call synchronously from inside a tap handler. */
export function tapHaptic(): void {
  try {
    if (Capacitor.isNativePlatform()) {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      return;
    }

    if (isIOS) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);

      document.head.appendChild(label);
      label.click();
      document.head.removeChild(label);
      return;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  } catch {
    // Unsupported or denied — haptics are garnish.
  }
}

/** A firmer "something finished" pattern — rest timer done, workout complete. */
export function completionHaptic(): void {
  try {
    if (Capacitor.isNativePlatform()) {
      void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      return;
    }

    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch {
    // Unsupported or denied — haptics are garnish.
  }
}
