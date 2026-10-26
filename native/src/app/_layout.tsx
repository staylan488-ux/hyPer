import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { maybeSeedPreview } from '@/preview/previewSeed';
import { DevLaunchRunner } from '~/components/DevLaunchRunner';
import { palettes } from '~/theme/blanc';

// Preview mode: fill the shared stores with the sample account before the
// first screen renders (no-op when preview is off).
maybeSeedPreview();

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  const p = dark ? palettes.dark : palettes.light;
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: p.ink, background: p.ground, card: p.ground, text: p.ink, border: p.hairline },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <ThemeProvider value={theme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
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
        </Stack>
        {__DEV__ ? <DevLaunchRunner /> : null}
      </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
