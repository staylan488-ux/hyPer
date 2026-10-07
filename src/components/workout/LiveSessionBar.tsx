import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useMotionValue, useTransform, type MotionStyle } from 'motion/react';
import { readMotionPolicy } from '@/lib/motionPolicy';
import { ScrollEdgeVeil } from '@/components/shared/PageTitle';
import { restNudgeTarget } from '@/lib/titleSnap';
import { measureRestBand, measureRestBlocks } from '@/lib/restBlocks';
import { compactSessionPrefix, formatSessionDuration, liveHeaderCollapseOffset, liveHeaderSnapTarget, liveScrollEnd } from './workoutFocus';

// The bar row under the status bar; the session title starts to hand over to
// the compact title once it reaches the bar's bottom edge.
const BAR = 44;
// Scroll distance over which the scroll-edge band comes in, before anything
// but the header's top margin has reached the bar.
const BAND_RAMP = 16;
// The band's solid height when its stylesheet cannot be read.
const EDGE_SOLID_FALLBACK = 40;
const EDGE_FADE_FALLBACK = 24;
// Quiet time after the last scroll event that counts as "scrolling ended"
// where `scrollend` is unavailable (older WebKit).
const SETTLE_MS = 140;

/**
 * The live session's navigation bar, pinned under the status bar like a
 * full-screen cover's bar: minimise (leading), the elapsed clock (centre) and
 * Finish (trailing) never scroll away. It sits on the shared scroll-edge band
 * (the same blurred veil as every PageTitle), so content passing under it
 * dissolves instead of meeting a line. Once the session title has scrolled
 * under it, the clock cross-fades in place to the compact title "Upper A ·
 * 24m", centred like every compact title; nothing slides sideways.
 *
 * The session header (title and ring) behaves like a large title: when
 * scrolling ends part-way it settles expanded or wholly collapsed under the
 * bar's solid edge, with the first movement's content starting at the ramp's
 * foot, and the page always has room to collapse it, so neither the ring nor
 * a row rests split in the fade. Once collapsed, a rest that would leave a
 * row split by the bar is nudged by at most 32px (`restNudgeTarget`), never
 * under a finger or a focused field. Fixed inside the untransformed route content;
 * scroll-linked only. Its in-flow spacer keeps the header below it in place.
 */
export function LiveSessionBar({ title, createdAt, titleRef, headerRef, pageRef, finishing, onMinimise, onFinish }: {
  title: string;
  createdAt: string | null;
  /** The session's large title, whose passage under the bar drives the hand-over. */
  titleRef: RefObject<HTMLElement | null>;
  /** The collapsible session header (title and ring). */
  headerRef: RefObject<HTMLElement | null>;
  /** The session page, given room to collapse the header however short it is. */
  pageRef: RefObject<HTMLElement | null>;
  finishing: boolean;
  onMinimise: () => void;
  onFinish: () => void;
}) {
  // One tick for the bar, so the session page never re-renders every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!createdAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [createdAt]);
  const elapsed = formatSessionDuration(createdAt, now);

  const barRef = useRef<HTMLDivElement>(null);
  const scrolled = useMotionValue(0);
  const covered = useMotionValue(0);
  const band = useTransform(scrolled, [0, BAND_RAMP], [0, 1]);
  // Like UIKit's title hand-over, the two bar labels cross-fade in place with
  // no sideways travel: the lone clock, centred, gives way to the compact
  // title, centred as a whole. The fades barely overlap, so the two sets of
  // digits never show at once, and the header settles expanded or collapsed,
  // never between (see .studio-session-centre).
  const soloClock = useTransform(covered, [0.55, 0.8], [1, 0]);
  const condensed = useTransform(covered, [0.76, 1], [0, 1]);
  const prefix = compactSessionPrefix(title);

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (!viewport) return;
    let frame = 0;
    let settleTimer = 0;
    let touching = false;
    let collapse = 0;
    const inColumn = (element: HTMLElement, edge: 'top' | 'bottom') =>
      element.getBoundingClientRect()[edge] - viewport.getBoundingClientRect().top + viewport.scrollTop;

    const measure = () => {
      frame = 0;
      const top = Math.max(0, viewport.scrollTop);
      scrolled.set(top);
      const heading = titleRef.current;
      if (!heading) return;
      // The title's resting place in the scroll column, independent of the
      // current scroll, as PageTitle measures it.
      const rest = inColumn(heading, 'top');
      const start = Math.max(0, rest - BAR);
      covered.set(Math.min(1, Math.max(0, (top - start) / Math.max(1, heading.offsetHeight))));
    };

    // The collapsed rest: the header wholly under the band's solid part. A
    // short session gets just enough height to reach it.
    const layout = () => {
      const header = headerRef.current;
      const page = pageRef.current;
      if (!header || !page) return;
      const band = barRef.current ? getComputedStyle(barRef.current) : null;
      const solidValue = parseFloat(band?.getPropertyValue('--edge-solid') ?? '');
      const fadeValue = parseFloat(band?.getPropertyValue('--edge-fade') ?? '');
      const solid = Number.isFinite(solidValue) ? solidValue : EDGE_SOLID_FALLBACK;
      const fade = Number.isFinite(fadeValue) ? fadeValue : EDGE_FADE_FALLBACK;
      const foot = solid + fade;
      // Each movement's content (inside its row padding) at the ramp's foot:
      // the scroll offsets where no movement rests split under the bar.
      const rests = Array.from(page.querySelectorAll<HTMLElement>('.studio-movement'))
        .map((movement) => inColumn(movement, 'top') + (parseFloat(getComputedStyle(movement).paddingTop) || 0) - foot);
      const firstRest = rests[0];
      collapse = liveHeaderCollapseOffset(inColumn(header, 'bottom'), solid,
        firstRest === undefined ? undefined : { contentTop: firstRest + foot, edgeFoot: foot });
      // Measure the session's own end, then give it just enough room to
      // collapse the header and to end on a rest (at most half a screen more; a live session has few, tall rows).
      // (Measured from the content, without clearing min-height, so a page
      // resting at its end is never clamped upward while it is re-measured.)
      const pageTop = inColumn(page, 'top');
      const last = page.lastElementChild instanceof HTMLElement ? page.lastElementChild : null;
      const naturalHeight = last
        ? inColumn(last, 'bottom') - pageTop + (parseFloat(getComputedStyle(page).paddingBottom) || 0)
        : page.offsetHeight;
      const after = viewport.scrollHeight - (pageTop + page.offsetHeight);
      const naturalEnd = pageTop + naturalHeight + Math.max(0, after) - viewport.clientHeight;
      const end = liveScrollEnd(naturalEnd, collapse, rests, viewport.clientHeight * 0.5);
      page.style.minHeight = end > naturalEnd + 0.5 ? `${Math.ceil(naturalHeight + end - naturalEnd)}px` : '';
    };

    const settle = () => {
      settleTimer = 0;
      // Never move the page under a finger, or away from a field being typed into.
      if (touching) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches('input, textarea, select')) return;
      if (viewport.hasAttribute('data-restoring-scroll')) return;
      let target = liveHeaderSnapTarget(viewport.scrollTop, collapse) ?? viewport.scrollTop;
      // Collapsed: no movement row, set row or action rests split by the bar
      // (the same rest nudge as every PageTitle page).
      const page = pageRef.current;
      const bar = barRef.current;
      const max = viewport.scrollHeight - viewport.clientHeight;
      if (page && bar && collapse > 1 && target >= collapse - 0.5) {
        target = restNudgeTarget(target, measureRestBlocks(page, viewport), measureRestBand(bar, viewport), { min: Math.min(collapse, max), max }) ?? target;
      }
      if (Math.abs(target - viewport.scrollTop) < 0.5) return;
      viewport.scrollTo({ top: target, behavior: readMotionPolicy().reducedMotion ? 'auto' : 'smooth' });
    };
    const hasScrollEnd = 'onscrollend' in viewport;
    const scheduleSettle = () => {
      if (hasScrollEnd) return;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
      scheduleSettle();
    };
    const onTouchStart = () => { touching = true; window.clearTimeout(settleTimer); };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      touching = false;
      // A release without momentum fires no further scroll events.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };
    const onResize = () => { layout(); onScroll(); };

    layout();
    measure();
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    // The header moves when an error line appears above it; the page grows
    // and shrinks as movements open.
    if (headerRef.current) resizeObserver?.observe(headerRef.current);
    if (pageRef.current) resizeObserver?.observe(pageRef.current);
    resizeObserver?.observe(viewport);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    if (hasScrollEnd) viewport.addEventListener('scrollend', settle);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('resize', onResize);
    const page = pageRef.current;
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('scrollend', settle);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      window.clearTimeout(settleTimer);
      if (frame) cancelAnimationFrame(frame);
      if (page) page.style.minHeight = '';
    };
  }, [covered, headerRef, pageRef, scrolled, titleRef]);

  return <>
    <motion.div ref={barRef} className="page-scroll-edge studio-live-bar" style={{ '--band': band } as MotionStyle}>
      <ScrollEdgeVeil />
      {/* The full-screen cover minimises (the session keeps running) rather
          than going back. The clock sits on the screen's centre line. */}
      <div className="studio-session-top">
        <button type="button" className="studio-session-minimise pressable" aria-label="Minimise workout" onClick={onMinimise}>
          <ChevronDown size={24} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="studio-session-centre">
          <motion.span className="page-scroll-edge-title studio-session-solo" style={{ opacity: soloClock }} aria-hidden>{elapsed}</motion.span>
          <motion.span className="page-scroll-edge-title studio-session-line" style={{ opacity: condensed }}>
            <span className="studio-session-prefix" aria-hidden>{prefix}</span>
            <span className="studio-session-clock" role="timer">{elapsed}</span>
          </motion.span>
        </span>
        <button type="button" className="studio-session-finish" onClick={onFinish} disabled={finishing}>{finishing ? 'Finishing…' : 'Finish'}</button>
      </div>
    </motion.div>
    <div className="studio-live-bar-spacer" aria-hidden />
  </>;
}
