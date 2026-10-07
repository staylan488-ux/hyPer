import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';
import { motion, useMotionValue, useTransform, type MotionStyle } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tapHaptic } from '@/lib/haptics';
import { REST_BAR_CLEAR, REST_PAGE_NUDGE_LIMIT, cleanScrollEnd, restNudgeTarget, titleSnapTarget, type RestBand, type RestBar } from '@/lib/titleSnap';
import { measureRestBand, measureRestInk, measureStickyRest, uncovered } from '@/lib/restBlocks';
import { createRuleVeil } from '@/lib/ruleVeil';
import './page-header.css';

/** A trailing action kept in the condensed bar once the title has
 *  collapsed, as UIKit keeps bar items across both title states (Fuel's +,
 *  History's sync glyph). `after`: the page's own control for the action;
 *  the bar's copy shows only once that control has passed under the band,
 *  so one add shows at a time. The copy is a 44pt glyph key named `label`
 *  for assistive technology while it shows. */
export interface CompactAction { label: string; icon: ReactNode; onClick: () => void; after?: RefObject<HTMLElement | null>; disabled?: boolean }

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
  /** A trailing action shown in the condensed bar once collapsed. */
  compactAction?: CompactAction;
}

// Height of the scroll-edge band's bar row: the title starts to pass under
// the band once it reaches it.
const BAR = 44;
// Where the band's solid stage ends (kinetic.css --edge-solid): the title has
// collapsed once it is wholly behind it, so none of it rests in the ramp.
const SOLID = 40;
// The compact title switches over the last stretch of the collapse (about
// the last 10px), not over a long crossfade.
const COMPACT_FROM = 0.8;
// Scroll (px) over which the bar's edge and back control take over from the
// header's own once the page leaves the top.
const EDGE_RAMP = 6;
// Quiet period that stands in for `scrollend` where it is unsupported.
const SETTLE_MS = 140;
// The most a page may grow past its tab-bar clearance to end on a clean
// rest: about one row.
const END_SLACK = 72;

const editable = (element: Element | null) =>
  element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/**
 * The page's 40px Fraunces title. As soon as the page leaves the top, the
 * scroll-edge band takes the place of a navigation bar: the stage colour,
 * solid behind the bar row, then one eased ramp over a progressive blur so
 * content dissolves instead of ending on an edge or a shaded sliver, with the
 * back control fixed in it.
 * The large title scrolls under the band, and the condensed title switches
 * in as the large one finishes passing. Tapping the band returns to the top.
 *
 * Like UIKit, the page never rests half collapsed: when scrolling ends inside
 * the collapse range it settles fully expanded or fully collapsed
 * (immediately under reduced motion). Once collapsed, it also never rests
 * with a block split by the band: like UIKit's targetContentOffset
 * adjustment, the rest moves by at most 32px so every block clears the band
 * or sits wholly under its solid stage (`restNudgeTarget`). Settling never
 * fights a finger still on the glass, a focused field or route scroll
 * restoration, and the scroll-to-top tap lands on a settled offset.
 *
 * Scroll-linked only: the band is `position: fixed` inside the route content
 * (which is never transformed), and nothing animates on its own.
 */
export const PageTitle = forwardRef<HTMLHeadingElement, PageTitleProps>(function PageTitle(
  { children, compactTitle, back, compactAction, className = '', ...rest },
  forwardedRef,
) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const progress = useMotionValue(0);
  const edge = useMotionValue(0);
  const compactOpacity = useTransform(progress, [COMPACT_FROM, 1], [0, 1]);
  const compactY = useTransform(progress, [COMPACT_FROM, 1], [3, 0]);
  // 1 once the page's own control for the compact action is under the band.
  const actionGate = useMotionValue(compactAction?.after ? 0 : 1);
  const actionOpacity = useTransform([progress, actionGate], ([value, gate]: number[]) =>
    Math.min(1, Math.max(0, (value - COMPACT_FROM) / (1 - COMPACT_FROM))) * gate);
  const after = compactAction?.after;
  const bandPointer = useTransform(edge, (value) => (value > 0.9 ? 'auto' : 'none'));
  // The condensed bar's trailing action takes touches only once it shows.
  const actionPointer = useTransform([progress, actionGate], ([value, gate]: number[]) => (value > 0.95 && gate > 0.95 ? 'auto' : 'none'));
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
    // Where the page rests collapsed. Like a search field in a UIKit
    // navigation bar, anything the header holds under its title (You's
    // search) collapses with it: the collapsed rest hides it too.
    const collapsedRest = () => {
      const { end } = collapseRange();
      const extra = title.nextElementSibling ? title.closest('header') : null;
      if (!extra) return end;
      const viewportTop = viewport.getBoundingClientRect().top;
      const scrolled = Math.max(0, viewport.scrollTop);
      let bottom = -Infinity;
      for (let sibling = title.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (sibling.classList.contains('page-scroll-edge')) continue;
        const rect = sibling.getBoundingClientRect();
        if (rect.height > 0) bottom = Math.max(bottom, rect.bottom - viewportTop + scrolled);
      }
      return Number.isFinite(bottom) ? Math.max(end, Math.ceil(bottom - SOLID - 4)) : end;
    };
    // The page content the rests are judged by (everything under the header's parent).
    const root = title.closest('header')?.parentElement ?? null;
    const rules = root ? createRuleVeil(root, viewport) : null;
    // Blocks rest whole (hidden or wholly shown) when they fit between the
    // ramp's foot and the tab bar's clear line.
    const withWindow = (band: RestBand, bar: RestBar | null): RestBand => ({
      ...band,
      window: (bar ? bar.top - REST_BAR_CLEAR : viewport.clientHeight) - band.foot,
    });
    const measure = () => {
      frame = 0;
      const scrolled = Math.max(0, viewport.scrollTop);
      const { start, end } = collapseRange();
      progress.set(Math.min(1, Math.max(0, (scrolled - start) / Math.max(1, end - start))));
      edge.set(Math.min(1, scrolled / EDGE_RAMP));
      const control = after?.current;
      const band = bandRef.current;
      if (control && band) {
        // Hidden under the band's solid stage: the control's foot within
        // the solid edge plus the ramp's first few pixels (REST_HIDDEN_DEPTH).
        const { solid } = measureRestBand(band, viewport);
        const foot = control.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top;
        actionGate.set(foot <= solid + 4 ? 1 : 0);
      } else actionGate.set(1);
      // The condensed bar's action is reachable only while it shows.
      const action = actionRef.current;
      if (action) {
        const shown = progress.get() > 0.95 && actionGate.get() > 0.95;
        action.toggleAttribute('aria-hidden', !shown);
        action.tabIndex = shown ? 0 : -1;
      }
      // Rules leave before they reach the band's ramp (or a stuck header's).
      if (rules && band && root) {
        rules.update(scrolled > 0.5 ? measureStickyRest(root, viewport, measureRestBand(band, viewport)).band.foot : null);
      }
    };
    const settle = () => {
      settleTimer = 0;
      const focused = document.activeElement;
      if (touching || (editable(focused) && viewport.contains(focused)) || viewport.hasAttribute('data-restoring-scroll')) return;
      const max = viewport.scrollHeight - viewport.clientHeight;
      const rest = collapsedRest();
      const collapsed = Math.min(rest, max);
      let target = titleSnapTarget(viewport.scrollTop, rest, max) ?? viewport.scrollTop;
      // Collapsed: nothing rests split by the band or astride the tab bar,
      // judged at both edges at once.
      const band = bandRef.current;
      if (root && band && target > 0.5 && target >= collapsed - 0.5) {
        // A sticky header held under the band (History's month) moves the
        // edge blocks rest against, or rests as a block itself.
        const sticky = measureStickyRest(root, viewport, measureRestBand(band, viewport));
        const ink = measureRestInk(root, viewport);
        const blocks = [...uncovered(ink.blocks, sticky.covers), ...sticky.blocks];
        const { bar } = ink;
        target = restNudgeTarget(target, blocks, withWindow(sticky.band, bar), { min: collapsed, max }, REST_PAGE_NUDGE_LIMIT, bar) ?? target;
      }
      if (Math.abs(target - viewport.scrollTop) < 0.5) return;
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
    // The page's trailing space only clears the tab bar; when its natural end
    // would rest with a block split by the band, it grows by at most about a
    // row (END_SLACK) to end on a clean rest. Measured with the current extra
    // room subtracted, never by removing it, so a page resting at its end is
    // not clamped while it is re-measured.
    let extra = 0;
    let layoutTimer = 0;
    const layoutEnd = () => {
      layoutTimer = 0;
      const band = bandRef.current;
      if (!root || !band) return;
      const naturalEnd = viewport.scrollHeight - extra - viewport.clientHeight;
      const { blocks, bar } = measureRestInk(root, viewport);
      const end = cleanScrollEnd(naturalEnd, blocks, withWindow(measureRestBand(band, viewport), bar), END_SLACK, collapsedRest(), bar);
      const next = Math.max(0, Math.ceil(end - naturalEnd));
      rules?.collect();
      measure();
      if (next === extra) return;
      extra = next;
      viewport.style.paddingBottom = extra ? `${extra}px` : '';
    };
    // Rows opening animate their height: measure once they have settled.
    const scheduleLayout = () => {
      if (layoutTimer) window.clearTimeout(layoutTimer);
      layoutTimer = window.setTimeout(layoutEnd, 120);
    };
    const resizeObserver = typeof ResizeObserver === 'function' && root ? new ResizeObserver(scheduleLayout) : null;
    if (root) resizeObserver?.observe(root);
    measure();
    layoutEnd();
    // Again once entrance motion (a transform, which the observer does not
    // see) has settled.
    const settledLayout = window.setTimeout(layoutEnd, 700);
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
      resizeObserver?.disconnect();
      window.clearTimeout(settledLayout);
      window.clearTimeout(layoutTimer);
      if (extra) viewport.style.paddingBottom = '';
      rules?.dispose();
      if (frame) cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [progress, edge, actionGate, after]);

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
          ref={bandRef}
          className="page-scroll-edge"
          // The edge and back control follow --band; the condensed title
          // switches on its own as the large title finishes passing.
          style={{ '--band': edge, pointerEvents: bandPointer } as MotionStyle}
          onClick={scrollToTop}
        >
          <ScrollEdgeVeil />
          {back && (
            // The header's own back control stays the accessible one; this
            // copy only keeps the way back under the thumb once it scrolls off.
            <BackControl back={back} className="page-scroll-edge-back" hidden />
          )}
          <motion.span className="page-scroll-edge-title" style={{ opacity: compactOpacity, y: compactY }} aria-hidden>
            {label}
          </motion.span>
          {compactAction && (
            // Kept under the thumb while the page is collapsed; named and
            // focusable only while it shows (measure toggles both).
            <motion.button
              ref={actionRef}
              type="button"
              className="page-scroll-edge-action pressable"
              style={{ opacity: actionOpacity, pointerEvents: actionPointer }}
              tabIndex={-1}
              aria-hidden
              aria-label={compactAction.label}
              disabled={compactAction.disabled}
              onClick={(event) => {
                event.stopPropagation();
                tapHaptic();
                compactAction.onClick();
              }}
            >
              {compactAction.icon}
            </motion.button>
          )}
        </motion.div>
      )}
    </>
  );
});

/**
 * The band's material: a progressive blur (three stacked layers, strongest
 * where the veil already hides most of the content) under the stage-colour
 * veil. Shared by every PageTitle band and the live session bar.
 */
export function ScrollEdgeVeil() {
  return (
    <>
      <span className="page-scroll-edge-blur" data-layer="1" aria-hidden />
      <span className="page-scroll-edge-blur" data-layer="2" aria-hidden />
      <span className="page-scroll-edge-blur" data-layer="3" aria-hidden />
      <span className="page-scroll-edge-veil" aria-hidden />
    </>
  );
}

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
  /** The page's primary action, repeated in the condensed bar once collapsed. */
  compactAction?: CompactAction;
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
  compactAction,
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
        compactAction={compactAction}
        {...titleProps}
        className={`page-header-title ${titleProps?.className ?? ''}`}
      >
        {title}
      </PageTitle>
      {children}
    </header>
  );
}
