import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { motion, useMotionValue, useTransform, type MotionStyle } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tapHaptic } from '@/lib/haptics';
import { titleSnapTarget } from '@/lib/titleSnap';
import './page-header.css';

/** Where a pushed screen's back control returns. */
export type PageBack =
  | { label: string; to: string; onClick?: never }
  | { label: string; onClick: () => void; to?: never };

interface PageTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  /** Plain-text title for the condensed bar; defaults to string children. */
  compactTitle?: string;
  /** Repeats the back control in the condensed bar once the title has gone. */
  back?: PageBack;
}

// Height of the scroll-edge band's bar row: the title starts to pass under
// the band once it reaches it.
const BAR = 44;
// Where the band's solid stage ends (kinetic.css --edge-solid): the title has
// collapsed once it is wholly behind it, so none of it rests in the ramp.
const SOLID = 34;
// The compact title switches over the last stretch of the collapse (about
// the last 10px), not over a long crossfade.
const COMPACT_FROM = 0.8;
// Scroll (px) over which the bar's edge and back control take over from the
// header's own once the page leaves the top.
const EDGE_RAMP = 6;
// Quiet period that stands in for `scrollend` where it is unsupported.
const SETTLE_MS = 140;

const editable = (element: Element | null) =>
  element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/**
 * The page's 40px Fraunces title. As soon as the page leaves the top, the
 * scroll-edge band takes the place of a navigation bar: the stage colour,
 * solid behind the bar row, then one short eased opacity ramp so content
 * dissolves instead of ending on an edge, with the back control fixed in it.
 * The large title scrolls under the band, and the condensed title switches
 * in as the large one finishes passing. Tapping the band returns to the top.
 *
 * Like UIKit, the page never rests half collapsed: when scrolling ends inside
 * the collapse range it settles fully expanded or fully collapsed
 * (immediately under reduced motion). Settling never fights a finger still on
 * the glass or a focused field, and route scroll restoration and the
 * scroll-to-top tap only ever land on settled offsets.
 *
 * Scroll-linked only: the band is `position: fixed` inside the route content
 * (which is never transformed), and nothing animates on its own.
 */
export const PageTitle = forwardRef<HTMLHeadingElement, PageTitleProps>(function PageTitle(
  { children, compactTitle, back, className = '', ...rest },
  forwardedRef,
) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const progress = useMotionValue(0);
  const edge = useMotionValue(0);
  const compactOpacity = useTransform(progress, [COMPACT_FROM, 1], [0, 1]);
  const compactY = useTransform(progress, [COMPACT_FROM, 1], [3, 0]);
  const bandPointer = useTransform(edge, (value) => (value > 0.9 ? 'auto' : 'none'));
  const label = compactTitle ?? (typeof children === 'string' ? children : '');

  useEffect(() => {
    const title = titleRef.current;
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (!title || !viewport) return;
    let frame = 0;
    let settleTimer = 0;
    let touching = false;
    // The collapse range in scroll offsets: from the title reaching the bar
    // to the title wholly behind the band's solid stage.
    const collapseRange = () => {
      const scrolled = Math.max(0, viewport.scrollTop);
      // The title's resting place in the scroll column, independent of the
      // current scroll.
      const rest = title.getBoundingClientRect().top - viewport.getBoundingClientRect().top + scrolled;
      return { start: Math.max(0, rest - BAR), end: Math.max(1, rest + title.offsetHeight - SOLID) };
    };
    const measure = () => {
      frame = 0;
      const scrolled = Math.max(0, viewport.scrollTop);
      const { start, end } = collapseRange();
      progress.set(Math.min(1, Math.max(0, (scrolled - start) / Math.max(1, end - start))));
      edge.set(Math.min(1, scrolled / EDGE_RAMP));
    };
    const settle = () => {
      settleTimer = 0;
      const focused = document.activeElement;
      if (touching || (editable(focused) && viewport.contains(focused))) return;
      const target = titleSnapTarget(viewport.scrollTop, collapseRange().end,viewport.scrollHeight - viewport.clientHeight);
      if (target === null) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      viewport.scrollTo({ top: target, behavior: still ? 'auto' : 'smooth' });
    };
    const nativeEnd = 'onscrollend' in viewport;
    const scheduleSettle = (delay: number) => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, delay);
    };
    const onScrollEnd = () => scheduleSettle(0);
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
      // Without `scrollend`, a quiet period stands in for it. With it, any
      // movement cancels a pending touch-end check: the scroll end follows.
      if (!nativeEnd) scheduleSettle(SETTLE_MS);
      else if (settleTimer) {
        window.clearTimeout(settleTimer);
        settleTimer = 0;
      }
    };
    const onTouchStart = () => {
      touching = true;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = 0;
    };
    const onTouchEnd = (event: TouchEvent) => {
      touching = event.touches.length > 0;
      // Momentum can keep the page moving after the finger lifts; the scroll
      // end (or its stand-in) still follows, so this only settles a page
      // that is already still.
      if (!touching) scheduleSettle(SETTLE_MS);
    };
    measure();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    if (nativeEnd) viewport.addEventListener('scrollend', onScrollEnd);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('scrollend', onScrollEnd);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [progress, edge]);

  const setRefs = (el: HTMLHeadingElement | null) => {
    titleRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  const scrollToTop = () => {
    document.querySelector<HTMLElement>('[data-app-scroll-viewport]')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <h1 ref={setRefs} className={`t-title ${className}`} {...rest}>
        {children}
      </h1>
      {label && (
        <motion.div
          className="page-scroll-edge"
          // The edge and back control follow --band; the condensed title
          // switches on its own as the large title finishes passing.
          style={{ '--band': edge, pointerEvents: bandPointer } as MotionStyle}
          aria-hidden
          onClick={scrollToTop}
        >
          <span className="page-scroll-edge-veil" />
          {back && (
            // The header's own back control stays the accessible one; this
            // copy only keeps the way back under the thumb once it scrolls off.
            <BackControl back={back} className="page-scroll-edge-back" hidden />
          )}
          <motion.span className="page-scroll-edge-title" style={{ opacity: compactOpacity, y: compactY }}>
            {label}
          </motion.span>
        </motion.div>
      )}
    </>
  );
});

function BackControl({ back, className, hidden = false }: { back: PageBack; className: string; hidden?: boolean }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={`page-back pressable ${className}`}
      aria-label={hidden ? undefined : `Back to ${back.label}`}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      onClick={(event) => {
        event.stopPropagation();
        tapHaptic();
        if (back.onClick) back.onClick();
        else navigate(back.to);
      }}
    >
      <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
      <span>{back.label}</span>
    </button>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text title for the condensed bar; defaults to a string title. */
  compactTitle?: string;
  /** One small line above the title. Its slot is kept when empty, so every
   *  title rests at the same height. */
  eyebrow?: ReactNode;
  /** Pushed screens: the way back, in the bar row above the title. */
  back?: PageBack;
  /** Root screens: what rests in the bar row's leading slot instead of back. */
  leading?: ReactNode;
  /** Trailing bar-row controls (a quiet text or icon action). */
  actions?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  titleProps?: HTMLAttributes<HTMLHeadingElement>;
  className?: string;
  /** Anything that belongs to the header under the title (e.g. search). */
  children?: ReactNode;
}

/**
 * The one page header: a 44px bar row (back on pushed screens, trailing
 * actions), at most one small eyebrow, then the large serif title — at the
 * same height on every screen. It sits under the status bar in place of the
 * Screen's top padding, where an iOS navigation bar would.
 */
export function PageHeader({
  title,
  compactTitle,
  eyebrow,
  back,
  leading,
  actions,
  titleRef,
  titleProps,
  className = '',
  children,
}: PageHeaderProps) {
  return (
    <header className={`page-header ${className}`}>
      <div className="page-header-bar">
        {back ? <BackControl back={back} className="page-header-back" /> : leading ?? <span />}
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      <p className="page-eyebrow t-label" aria-hidden={eyebrow ? undefined : true}>
        {eyebrow ?? ' '}
      </p>
      <PageTitle
        ref={titleRef}
        compactTitle={compactTitle}
        back={back}
        {...titleProps}
        className={`page-header-title ${titleProps?.className ?? ''}`}
      >
        {title}
      </PageTitle>
      {children}
    </header>
  );
}
