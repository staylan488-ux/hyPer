import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { maybeSeedPreview } from '@/preview/previewSeed';
import { useAuthStore } from '@/stores/authStore';
import { DevLaunchRunner } from '~/components/DevLaunchRunner';
import { useAuthScreen } from '~/lib/auth';
import { isPreviewActive } from '~/platform/previewFlag';
import { palettes } from '~/theme/blanc';

// Preview mode: fill the shared stores with the sample account before the
// first screen renders (no-op when preview is off).
maybeSeedPreview();
// Otherwise restore the saved session (Keychain) and follow auth changes, as
// the web app does on launch.
if (!isPreviewActive()) void useAuthStore.getState().initialize();
// Keep the launch screen up until it is known whether someone is signed in.
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

  useEffect(() => {
    if (screen !== 'boot') void SplashScreen.hideAsync().catch(() => {});
  }, [screen]);

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
            <Stack.Screen
              name="log-food"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.72, 1],
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
        {__DEV__ ? <DevLaunchRunner /> : null}
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
