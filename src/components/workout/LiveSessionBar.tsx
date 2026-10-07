import { useEffect, useState, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useMotionValue, useTransform, type MotionStyle } from 'motion/react';
import { compactSessionTitle, formatSessionDuration } from './workoutFocus';

// The bar row under the status bar; the session title starts to hand over to
// the compact title once it reaches the bar's bottom edge.
const BAR = 44;
// Scroll distance over which the scroll-edge band comes in, before anything
// but the header's top margin has reached the bar.
const BAND_RAMP = 16;

/**
 * The live session's navigation bar, pinned under the status bar like a
 * full-screen cover's bar: minimise (leading), the elapsed clock (centre) and
 * Finish (trailing) never scroll away. It sits on the shared scroll-edge band
 * (the same veil and progressive blur as every PageTitle), so content passing
 * under it dissolves instead of meeting a line. Once the session title has
 * scrolled under it, the centre cross-fades to the compact "Upper A · 24m".
 *
 * Fixed inside the untransformed route content; scroll-linked only. Its
 * in-flow spacer keeps the header below it at the same height as before.
 */
export function LiveSessionBar({ title, createdAt, titleRef, finishing, onMinimise, onFinish }: {
  title: string;
  createdAt: string | null;
  /** The session's large title, whose passage under the bar drives the hand-over. */
  titleRef: RefObject<HTMLElement | null>;
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

  const scrolled = useMotionValue(0);
  const covered = useMotionValue(0);
  const band = useTransform(scrolled, [0, BAND_RAMP], [0, 1]);
  const clockOpacity = useTransform(covered, [0.4, 0.85], [1, 0]);
  const compactOpacity = useTransform(covered, [0.55, 1], [0, 1]);
  const compactY = useTransform(covered, [0.55, 1], [6, 0]);

  useEffect(() => {
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = Math.max(0, viewport.scrollTop);
      scrolled.set(top);
      const heading = titleRef.current;
      if (!heading) return;
      // The title's resting place in the scroll column, independent of the
      // current scroll, as PageTitle measures it.
      const rest = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top + top;
      const start = Math.max(0, rest - BAR);
      covered.set(Math.min(1, Math.max(0, (top - start) / Math.max(1, heading.offsetHeight))));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [covered, scrolled, titleRef]);

  return <>
    <motion.div className="page-scroll-edge studio-live-bar" style={{ '--band': band } as MotionStyle}>
      <span className="page-scroll-edge-veil" aria-hidden />
      {/* The full-screen cover minimises (the session keeps running) rather
          than going back. The clock sits on the screen's centre line. */}
      <div className="studio-session-top">
        <button type="button" className="studio-session-minimise pressable" aria-label="Minimise workout" onClick={onMinimise}>
          <ChevronDown size={24} strokeWidth={1.75} aria-hidden />
        </button>
        <span className="studio-session-centre">
          <motion.span className="studio-session-clock" style={{ opacity: clockOpacity }}
            role="timer">{elapsed}</motion.span>
          <motion.span className="page-scroll-edge-title studio-session-compact" style={{ opacity: compactOpacity, y: compactY }} aria-hidden>
            {compactSessionTitle(title, elapsed)}
          </motion.span>
        </span>
        <button type="button" className="studio-session-finish" onClick={onFinish} disabled={finishing}>{finishing ? 'Finishing…' : 'Finish'}</button>
      </div>
    </motion.div>
    <div className="studio-live-bar-spacer" aria-hidden />
  </>;
}
