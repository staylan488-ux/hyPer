import { useEffect, type RefObject } from 'react';
import { measureRestBand } from '@/lib/restBlocks';

/**
 * Marks a `position: sticky` header (History's month and weekday row) while
 * it is held under the page's scroll-edge band, as Calendar keeps a month's
 * labels with its grid:
 * - `data-stuck` once it rests at the band's solid edge: it then takes the
 *   stage colour and a short ramp below it, and the rest nudge judges blocks
 *   against its foot (`data-rest-band`, see `measureStuckBand`);
 * - `data-covered` once the large title has wholly collapsed, so its top
 *   padding also hides anything under the band's ramp. Before that the
 *   padding stays clear and the title passes under the band as everywhere.
 */
export function useStuckHeader(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (!element || !viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const band = document.querySelector('.page-scroll-edge');
      if (!band) return;
      const viewportTop = viewport.getBoundingClientRect().top;
      const { solid } = measureRestBand(band, viewport);
      const stuck = viewport.scrollTop > 0.5 && element.getBoundingClientRect().top - viewportTop <= solid + 0.5;
      const title = document.querySelector('.page-header-title');
      const covered = stuck && (!title || title.getBoundingClientRect().bottom - viewportTop <= solid + 0.5);
      element.toggleAttribute('data-stuck', stuck);
      element.toggleAttribute('data-covered', covered);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
