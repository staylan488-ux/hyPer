import { useCallback, type RefCallback, type RefObject } from 'react';
import { registerLitSurface } from '@/lib/litSurfaces';

type OwnRef<T> = RefObject<T | null> | ((element: T | null) => void);

/**
 * A callback ref that lets a floating glass surface catch the motion light
 * while it is mounted. Pass the element's own ref (a ref object or a stable
 * setter) to keep it working exactly as before.
 */
export function useLitSurface<T extends HTMLElement>(own?: OwnRef<T>): RefCallback<T> {
  return useCallback((element: T | null) => {
    assign(own, element);
    if (!element) return;
    const release = registerLitSurface(element);
    return () => {
      release();
      assign(own, null);
    };
  }, [own]);
}

function assign<T>(own: OwnRef<T> | undefined, element: T | null) {
  if (typeof own === 'function') own(element);
  else if (own) own.current = element;
}
