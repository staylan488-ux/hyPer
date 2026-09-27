import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { indexAtX, type ScrubLayout } from '@/lib/chartGeometry';
import { selectionHaptic, selectionHapticEnd, selectionHapticStart, tapHaptic } from '@/lib/haptics';

/** Horizontal travel (px) before a touch counts as a scrub rather than a scroll. */
const INTENT_SLOP = 6;

interface ScrubOptions {
  count: number;
  layout: ScrubLayout;
}

/**
 * Finger scrubbing for charts. A horizontal drag walks the data with one
 * selection detent per datum; a vertical drag is left to the page scroller
 * (touch-action: pan-y); a tap selects, and tapping the same datum again
 * clears. Arrow keys walk the data when the chart has focus, Escape clears.
 */
export function useScrub({ count, layout }: ScrubOptions) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; scrubbing: boolean } | null>(null);
  const activeRef = useRef<number | null>(null);

  const commit = useCallback((next: number | null, detent: boolean) => {
    if (next === activeRef.current) return;
    activeRef.current = next;
    setActive(next);
    if (detent && next !== null) selectionHaptic();
  }, []);


  const indexFor = (clientX: number) => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return indexAtX(clientX - rect.left, rect.width, count, layout);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (count === 0 || event.button > 0) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, scrubbing: false };
    if (event.pointerType === 'mouse') {
      gesture.current.scrubbing = true;
      setScrubbing(true);
      commit(indexFor(event.clientX), false);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    if (!g.scrubbing) {
      const dx = Math.abs(event.clientX - g.x);
      const dy = Math.abs(event.clientY - g.y);
      if (dx < INTENT_SLOP || dx < dy) return;
      g.scrubbing = true;
      setScrubbing(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // capture is an optimisation
      }
      selectionHapticStart();
    }
    commit(indexFor(event.clientX), true);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.scrubbing) {
      setScrubbing(false);
      selectionHapticEnd();
      return;
    }
    if (cancelled || event.pointerType === 'mouse') return;
    // A tap: select, or clear when tapping the selected datum.
    const hit = indexFor(event.clientX);
    if (hit === null) return;
    tapHaptic();
    commit(hit === activeRef.current ? null : hit, false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const current = activeRef.current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const start = current ?? (step > 0 ? -1 : count);
      commit(Math.min(count - 1, Math.max(0, start + step)), false);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      commit(event.key === 'Home' ? 0 : count - 1, false);
    } else if (event.key === 'Escape' && current !== null) {
      commit(null, false);
    }
  };

  // A selection past the end of new data is dropped rather than reset in an effect.
  const visibleActive = active !== null && active < count ? active : null;

  return {
    ref,
    active: visibleActive,
    scrubbing,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
      onKeyDown,
      style: { touchAction: 'pan-y' as const },
    },
    clear: () => commit(null, false),
  };
}

/** Width of an element, tracked with ResizeObserver (0 until measured). */
/** `mounted` re-subscribes when the element appears after first render. */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>, mounted = true) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ResizeObserver reports the initial size on observe.
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}
