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
  /** A row lifted to be dragged into place. */
  lift: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  /** The launch intro's P settling into its corner; a dragged row set down. */
  land: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}),
};
