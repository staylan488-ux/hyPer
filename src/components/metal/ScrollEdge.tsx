import { useEffect, useRef } from 'react';

/**
 * The shell's top scroll edge: once the page scrolls, content fades into the
 * background under the status bar instead of ending on a hard line. Fades in
 * over the first 24pt so titles at rest stay crisp.
 */
export function ScrollEdge() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    const edge = ref.current;
    if (!viewport || !edge) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      edge.style.opacity = String(Math.min(1, Math.max(0, viewport.scrollTop / 24)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={ref} className="metal-scroll-edge" aria-hidden />;
}
