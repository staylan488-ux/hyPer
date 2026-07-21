import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/** Single slot: rescheduling replaces the pending one, so there is never more
 *  than one rest notification in flight. */
const REST_NOTIFICATION_ID = 1001;

let permissionRequested = false;

/** Ask once, lazily, the first time a timer actually runs — so the iOS
 *  permission sheet appears in context instead of at app launch. */
async function ensurePermission(): Promise<boolean> {
  const status = await LocalNotifications.checkPermissions();
  if (status.display === 'granted') return true;
  if (permissionRequested) return false;

  permissionRequested = true;
  const requested = await LocalNotifications.requestPermissions();
  return requested.display === 'granted';
}

/** Schedule the "rest over" banner for the timer's absolute end time. Fires
 *  only if the app is backgrounded/locked when the timer lapses — in the
 *  foreground the in-app chime and haptic already cover it. */
export async function scheduleRestEndNotification(endsAtIso: string, nextUpLabel?: string | null): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const endsAt = new Date(endsAtIso);
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) return;

  try {
    if (!(await ensurePermission())) return;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title: 'Rest over',
          // Data over decoration: name the set that's up, nothing else.
          body: nextUpLabel || 'Next set',
          schedule: { at: endsAt },
        },
      ],
    });
  } catch {
    // Notification is a safety net, not the timer itself — fail quietly.
  }
}

export async function cancelRestEndNotification(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
  } catch {
    // Nothing pending, or plugin unavailable — either way we're done.
  }
}
