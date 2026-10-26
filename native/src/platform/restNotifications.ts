// Replaces ../src/lib/restNotifications.ts (see metro.config.js).
//
// The native app does not schedule the "Rest over" notification yet; it comes
// with the rest timer's Live Activity (milestone 3). Until then these keep the
// shared API and do nothing, so shared rest code can run here safely.
export async function scheduleRestEndNotification(
  _endsAtIso: string,
  _nextUpLabel?: string | null,
): Promise<void> {}

export async function cancelRestEndNotification(): Promise<void> {}
