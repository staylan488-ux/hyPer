import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useReducedMotion } from 'react-native-reanimated';

import { maybeSeedPreview } from '@/preview/previewSeed';
import { useAuthStore } from '@/stores/authStore';
import { BrandIntro } from '~/components/BrandIntro';
import { DevLaunchRunner } from '~/components/DevLaunchRunner';
import { useAuthScreen } from '~/lib/auth';
import { introPlayed } from '~/lib/brand';
import { installLaunchCache } from '~/lib/launchCache';
import { backendOf } from '~/lib/launchSnapshot';
import { launchWaiting, takeNativeLaunch, useLaunchActions } from '~/lib/launch';
import { restoreAppearance } from '~/lib/you';
import { readDevLaunch } from '~/platform/devLaunch';
import { isPreviewActive } from '~/platform/previewFlag';
import { palettes } from '~/theme/blanc';

// Light or Dark chosen in You applies before anything draws.
restoreAppearance();
// Preview mode: fill the shared stores with the sample account before the
// first screen renders (no-op when preview is off).
maybeSeedPreview();
// The phone's copy of the last program, targets and today's food fills the
// screens the moment sign-in is restored; the account load then refreshes it. Never in preview.
installLaunchCache({
  preview: isPreviewActive(),
  backend: backendOf(process.env.EXPO_PUBLIC_SUPABASE_URL),
  build: `${Constants.expoConfig?.version ?? ''}+${Constants.expoConfig?.ios?.buildNumber ?? ''}`,
  // Saved as the app leaves the screen, the app switcher (where it can be closed) included.
  onLeave: (save) => {
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') save();
    });
  },
});
// A press of Snap a meal, Log food or Train that launched the app (lib/launch.ts).
takeNativeLaunch();
// Otherwise restore the saved session (Keychain) and follow auth changes, as
// the web app does on launch.
if (!isPreviewActive()) void useAuthStore.getState().initialize();
// Keep the launch screen up until the intro takes over, or without the intro
// until it is known whether someone is signed in.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  const p = dark ? palettes.dark : palettes.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: p.ink, background: p.ground, card: p.ground, text: p.ink, border: p.hairline },
  };
  const screen = useAuthScreen();
  // Cold launch only, and never under Reduce Motion, a scripted dev check or a launch from a press.
  const reducedMotion = useReducedMotion();
  const [introDone, setIntroDone] = useState(() => reducedMotion || introPlayed() || Boolean(readDevLaunch().skipIntro) || launchWaiting());
  // A press from outside the app goes straight to its screen; one that arrives during the intro hurries it.
  const hurryIntro = useLaunchActions(screen, introDone);

  useEffect(() => {
    if (introDone && screen !== 'boot') void SplashScreen.hideAsync().catch(() => {});
  }, [introDone, screen]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <ThemeProvider value={theme}>
        {/* Signing in or out flips these guards; iOS then leaves the screens
            that are no longer allowed and index sends you to the right one. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={screen === 'app'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="session-done"
              options={{ presentation: 'fullScreenModal', gestureEnabled: false, contentStyle: { backgroundColor: p.ground } }}
            />
            {/* A GPS run: set up, then live with no way out but finishing, then save. */}
            <Stack.Screen
              name="run"
              options={{ presentation: 'fullScreenModal', gestureEnabled: false, contentStyle: { backgroundColor: p.ground } }}
            />
            <Stack.Screen
              name="log-food"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="fuel-month"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="movement"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.72, 1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="rest"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="schedule"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="past-set"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="activity"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            {/* The program editor: its own stack (program, then a day) in a page sheet. */}
            <Stack.Screen name="program-edit" options={{ presentation: 'modal', contentStyle: { backgroundColor: p.ground } }} />
            <Stack.Screen
              name="program-exercise"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="program-reorder"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.72, 1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="log-weight"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="targets-edit"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="targets-calculate"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="targets-coach"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="saved-meal"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.ground },
              }}
            />
            <Stack.Screen
              name="swap"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                contentStyle: { backgroundColor: p.label },
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={screen === 'sign-in'}>
            <Stack.Screen name="sign-in" options={{ contentStyle: { backgroundColor: p.ground } }} />
          </Stack.Protected>
          <Stack.Protected guard={screen === 'offline'}>
            <Stack.Screen name="offline" options={{ contentStyle: { backgroundColor: p.ground } }} />
          </Stack.Protected>
        </Stack>
        {introDone ? null : <BrandIntro ready={screen !== 'boot'} hurry={hurryIntro} onDone={() => setIntroDone(true)} />}
        {__DEV__ ? <DevLaunchRunner /> : null}
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
