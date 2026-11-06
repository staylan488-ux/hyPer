import { create } from 'zustand';

/**
 * Whether the live-workout bar is above the tab bar right now. The tab
 * layout decides it (the bar steps aside on Today and Train, which show the
 * workout themselves); tab pages read it to know what covers their foot.
 */
export const useWorkoutBarShown = create<{ shown: boolean }>(() => ({ shown: false }));
