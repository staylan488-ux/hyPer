import { Stack } from 'expo-router';
import { useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useBlanc } from '~/theme/blanc';

import { GlassField, glassTouchHandlers } from './GlassField';

type TransitionEvents = {
  addListener(event: 'transitionStart', listener: (e: { data: { closing: boolean } }) => void): () => void;
  addListener(event: 'transitionEnd' | 'gestureCancel' | 'blur', listener: (e: { data?: { closing: boolean } }) => void): () => void;
  getState(): { index: number; routes: { key: string }[] };
};

/**
 * Each tab's navigation stack: Apple large titles over the page, with the
 * molten-glass field behind every page of the tab (its pages are clear). All
 * four tabs show the one shared field, which starts and stops itself as a tab
 * comes on and off screen, and follows the finger without ever taking a touch
 * from the controls above it.
 */
export function TabStack() {
  const c = useBlanc();
  return (
    <View style={{ flex: 1, backgroundColor: c.ground }} {...glassTouchHandlers}>
      <GlassField />
      <Stack
        screenLayout={({ children, navigation, route }: { children: ReactElement; navigation: unknown; route: { key: string } }) => (
          <PageFade navigation={navigation as TransitionEvents} routeKey={route.key}>
            {children}
          </PageFade>
        )}
        screenOptions={{
          headerLargeTitleEnabled: true,
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: false,
          headerLargeTitleStyle: { fontWeight: '600', color: c.ink },
          headerTitleStyle: { fontWeight: '600', color: c.ink },
          headerTintColor: c.ink,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </View>
  );
}

/**
 * Pages are clear, so during a push or a swipe back the page underneath
 * would show through the one sliding over it. The page that is leaving fades
 * out as the slide starts, and a page coming back waits until the slide has
 * finished before it fades in, so two pages' words never sit on top of each
 * other; the glass behind stays put. (A page that is popped is already out of
 * React's hands while iOS slides it away, so the returning page is the one
 * that waits.)
 */
function PageFade({ navigation, routeKey, children }: { navigation: TransitionEvents; routeKey: string; children: ReactElement }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    let safety: ReturnType<typeof setTimeout> | undefined;
    const show = (duration: number) => {
      clearTimeout(safety);
      opacity.set(withTiming(1, { duration }));
    };
    const offs = [
      navigation.addListener('transitionStart', (event) => {
        clearTimeout(safety);
        if (event.data.closing) {
          opacity.set(withTiming(0, { duration: 110 }));
        } else if (opacity.get() < 1) {
          // Coming back: wait for the slide to end; never stay hidden if that news gets lost.
          safety = setTimeout(() => show(160), 900);
        }
      }),
      // A page pushed over this one: out at once, before iOS starts the slide (a tab switch leaves it be).
      navigation.addListener('blur', () => {
        const state = navigation.getState();
        if (state.routes[state.index]?.key !== routeKey) opacity.set(withTiming(0, { duration: 90 }));
      }),
      navigation.addListener('transitionEnd', (event) => {
        if (!event.data?.closing) show(160);
      }),
      // A swipe back let go of: the page stays, whole.
      navigation.addListener('gestureCancel', () => show(120)),
    ];
    return () => {
      clearTimeout(safety);
      offs.forEach((off) => off());
    };
  }, [navigation, opacity, routeKey]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}
