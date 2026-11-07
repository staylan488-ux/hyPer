// The "Rest over" notification. The app schedules it through
// native/src/platform/restNotifications.ts (expo-notifications), which
// native/metro.config.js swaps in for this file (it must stay so the swap can
// resolve). Outside the app there is nothing to schedule or cancel.
export const cancelRestEndNotification = async (): Promise<void> => {};
