import { Stack } from 'expo-router';

import { useBlanc } from '~/theme/blanc';

/** Each tab's navigation stack: Apple large titles over the chalk ground. */
export function TabStack() {
  const c = useBlanc();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerLargeTitleStyle: { fontWeight: '600', color: c.ink },
        headerTitleStyle: { fontWeight: '600', color: c.ink },
        headerTintColor: c.ink,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.ground },
      }}
    />
  );
}
