import * as Haptics from 'expo-haptics';

// Every call is fire-and-forget: a missing haptic engine never blocks a tap.
export const haptics = {
  /** A light tap for buttons and rows. */
  tap: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  /** A tick for changing a value or a choice. */
  select: () => void Haptics.selectionAsync().catch(() => {}),
  /** A saved set, a logged meal. */
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  /** A save that failed. */
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};
