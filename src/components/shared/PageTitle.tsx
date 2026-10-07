import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { motion, useMotionValue, useTransform, type MotionStyle } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tapHaptic } from '@/lib/haptics';
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

// Height of the scroll-edge band's bar row; the title starts to recede once
// it reaches the bar.
const BAR = 44;

/**
 * The page's 40px Fraunces title. As it scrolls under the top edge it eases
 * back and a condensed title settles into a scroll-edge band — a long, eased
 * fade of the stage over a progressive blur, like iOS 26 bars, so content
 * dissolves instead of ending on an edge. Tapping the band returns to the top.
 *
 * Scroll-linked only: the band is `position: fixed` inside the route content
 * (which is never transformed), and nothing animates on its own. At rest the
 * title is always full ink, wherever the page places it.
 */
export const PageTitle = forwardRef<HTMLHeadingElement, PageTitleProps>(function PageTitle(
  { children, compactTitle, back, className = '', ...rest },
  forwardedRef,
) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const progress = useMotionValue(0);
  const titleOpacity = useTransform(progress, [0, 1], [1, 0.25]);
  const titleScale = useTransform(progress, [0, 1], [1, 0.965]);
  const bandOpacity = useTransform(progress, [0.55, 1], [0, 1]);
  const bandY = useTransform(progress, [0.55, 1], [6, 0]);
  const bandPointer = useTransform(progress, (value) => (value > 0.9 ? 'auto' : 'none'));
  const label = compactTitle ?? (typeof children === 'string' ? children : '');

  useEffect(() => {
    const title = titleRef.current;
    const viewport = document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
    if (!title || !viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrolled = Math.max(0, viewport.scrollTop);
      // The title's resting place in the scroll column, independent of the
      // current scroll, so a title that rests close to the top edge is never
      // dimmed before the page moves.
      const rest = title.getBoundingClientRect().top - viewport.getBoundingClientRect().top + scrolled;
      const start = Math.max(0, rest - BAR);
      const covered = scrolled - start;
      progress.set(Math.min(1, Math.max(0, covered / Math.max(1, title.offsetHeight))));
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
  }, [progress]);

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
      <motion.h1
        ref={setRefs}
        className={`t-title ${className}`}
        style={{ opacity: titleOpacity, scale: titleScale, transformOrigin: '0% 100%' }}
        {...(rest as object)}
      >
        {children}
      </motion.h1>
      {label && (
        <motion.div
          className="page-scroll-edge"
          // Each layer fades on its own: an ancestor below full opacity would
          // cut the blur layers off from the content behind them.
          style={{ '--band': bandOpacity, pointerEvents: bandPointer } as MotionStyle}
          aria-hidden
          onClick={scrollToTop}
        >
          <span className="page-scroll-edge-blur" data-step="1" />
          <span className="page-scroll-edge-blur" data-step="2" />
          <span className="page-scroll-edge-blur" data-step="3" />
          <span className="page-scroll-edge-veil" />
          {back && (
            // The header's own back control stays the accessible one; this
            // copy only keeps the way back under the thumb once it scrolls off.
            <BackControl back={back} className="page-scroll-edge-back" hidden />
          )}
          <motion.span className="page-scroll-edge-title" style={{ y: bandY }}>
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
