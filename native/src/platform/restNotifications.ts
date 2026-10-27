// Replaces ../src/lib/restNotifications.ts (see metro.config.js): the "Rest
// over" notification, scheduled for the rest's end so it reaches you with the
// phone locked or the app in the background. Same words and single slot as the
// web app's. Local only: the app asks for no push permission.
import * as Notifications from 'expo-notifications';

/** One slot: scheduling again replaces the pending one. */
const REST_NOTIFICATION_ID = 'hyper-rest-over';

// With the app in front, rest ends with a haptic and the sound, no banner: the
// screen already shows it. Anything else presents normally.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const rest = notification.request.identifier === REST_NOTIFICATION_ID;
    return { shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: !rest, shouldShowList: !rest };
  },
});

let permissionRequested = false;

/** Ask once, the first time a rest runs, so the iOS prompt appears in context. */
async function ensurePermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync();
  if (status.granted) return true;
  if (permissionRequested || !status.canAskAgain) return false;
  permissionRequested = true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return requested.granted;
}

// Schedule and cancel run in call order, so a pause right after a start can
// never leave the start's notification behind.
let tail: Promise<void> = Promise.resolve();
function inOrder(step: () => Promise<void>): Promise<void> {
  tail = tail.then(step).catch(() => {
    // A safety net, not the timer itself: fail quietly.
  });
  return tail;
}

/** Schedules "Rest over" for the rest's end, naming the set that's up. */
export function scheduleRestEndNotification(endsAtIso: string, nextUpLabel?: string | null): Promise<void> {
  const endsAt = new Date(endsAtIso).getTime();
  return inOrder(async () => {
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return;
    if (!(await ensurePermission()) || endsAt <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: REST_NOTIFICATION_ID,
      content: { title: 'Rest over', body: nextUpLabel || 'Next set', sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt },
    });
  });
}

export function cancelRestEndNotification(): Promise<void> {
  return inOrder(() => Notifications.cancelScheduledNotificationAsync(REST_NOTIFICATION_ID));
}

/** Clears a delivered "Rest over" from the lock screen once the app is back in front. */
export function dismissDeliveredRestNotification(): Promise<void> {
  return inOrder(() => Notifications.dismissNotificationAsync(REST_NOTIFICATION_ID));
}
