import { makeMutable, useAnimatedStyle } from 'react-native-reanimated';
import { create } from 'zustand';

import type { MarkAnchor } from '~/lib/brandGeometry';

/**
 * Opacity of the resting marks that the launch intro lands on. The intro hides
 * them while the P flies in, then hands over in the frame it arrives.
 */
export const markShown = makeMutable(1);

/** 0 → 1 while the intro reveals the app. See useIntroRise. */
export const introReveal = makeMutable(1);

// The intro plays once per app process: a cold launch, not a return from the background.
let played = false;
export const introPlayed = () => played;
export const markIntroPlayed = () => {
  played = true;
};

type MeasureAnchor = () => Promise<MarkAnchor | null>;

/** Resting marks currently mounted; the intro lands on the newest. */
export const useMarkAnchors = create<{ anchors: MeasureAnchor[] }>(() => ({ anchors: [] }));

export function registerMarkAnchor(measure: MeasureAnchor): () => void {
  useMarkAnchors.setState((state) => ({ anchors: [...state.anchors, measure] }));
  return () => useMarkAnchors.setState((state) => ({ anchors: state.anchors.filter((item) => item !== measure) }));
}

/** Content that rises into place as the intro reveals its screen. */
export function useIntroRise() {
  return useAnimatedStyle(() => {
    const reveal = introReveal.value;
    return { transform: [{ translateY: (1 - reveal) * 14 }, { scale: 0.985 + 0.015 * reveal }] };
  });
}
