import { useEffect } from 'react';
import { subscribeMotionLight } from '@/lib/motionLight';

const LIT = '.material-glass, .bottom-nav, .studio-sheet, .material-toast';

/**
 * Lets the floating glass surfaces catch the motion light. Values are
 * written only on those few elements (not the root), so moving the light
 * never restyles the whole document.
 */
export function useAmbientLight() {
  useEffect(() => {
    return subscribeMotionLight(({ x, y }) => {
      document.querySelectorAll<HTMLElement>(LIT).forEach((element) => {
        element.style.setProperty('--light-x', x.toFixed(3));
        element.style.setProperty('--light-y', y.toFixed(3));
        element.style.setProperty('--light-on', '1');
      });
    });
  }, []);
}
