import { create } from 'zustand';

/**
 * Whether the live-workout bar is above the tab bar right now. The tab
 * layout decides it (the bar steps aside on Today and Train, which show the
 * workout themselves); tab pages read it to know what covers their foot.
 */
export const useWorkoutBarShown = create<{ shown: boolean }>(() => ({ shown: false }));

/**
 * Asks the tab bar to open out again. iOS keeps a tab bar it shrank on a
 * scroll shrunk across tabs, so after Session complete Today could show one
 * icon at its top with the other tabs hidden; iOS has no call to expand it,
 * but turning its shrinking off for a moment does.
 */
export const useTabBarExpand = create<{ requests: number; expand: () => void }>((set) => ({
  requests: 0,
  expand: () => set((state) => ({ requests: state.requests + 1 })),
}));
