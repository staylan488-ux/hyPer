import { useEffect } from 'react';
import { subscribeMotionLight } from '@/lib/motionLight';
import { useMotionPolicy } from '@/lib/motionPolicy';

const LIT = '.material-glass, .bottom-nav, .studio-sheet, .material-toast';

/**
 * Lets the floating glass surfaces catch the motion light. Values are
 * written only on those few elements (not the root), so moving the light
 * never restyles the whole document.
 */
export function useAmbientLight() {
  // Resubscribe when Reduce Motion or Reduce Transparency changes mid-session:
  // turning either on tears down the sensors and loop, turning it off restarts them.
  const { reducedMotion, reducedTransparency } = useMotionPolicy();
  useEffect(() => {
    return subscribeMotionLight(({ x, y }) => {
      document.querySelectorAll<HTMLElement>(LIT).forEach((element) => {
        element.style.setProperty('--light-x', x.toFixed(3));
        element.style.setProperty('--light-y', y.toFixed(3));
        element.style.setProperty('--light-on', '1');
      });
    });
  }, [reducedMotion, reducedTransparency]);
}
