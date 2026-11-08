import { router } from 'expo-router';

/**
 * Train at its top level, with the workout: switches to the tab and closes any
 * page left open in its stack (History, Program), so the workout never opens
 * stacked over one with a back button to it. On React Navigation 7 a plain
 * navigate pushes Train's root again; expo-router's pop option (the one its
 * own dismissTo uses) pops back to it instead. dismissTo itself can't be used:
 * it doesn't switch tabs.
 */
export function openTrain() {
  router.navigate('/train', { __internal__popToNavigator: true } as Parameters<typeof router.navigate>[1]);
}
