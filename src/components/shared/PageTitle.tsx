import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';

interface PageTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  /** Plain-text title for the condensed bar; defaults to string children. */
  compactTitle?: string;
}

/**
 * The page's 40px Fraunces title. As it scrolls under the top edge it eases
 * back and a condensed title settles into a scroll-edge band — a soft,
 * masked blur like iOS 26 bars, never a hard-edged toolbar. Tapping the band
 * returns to the top.
 *
 * Scroll-linked only: the band is `position: fixed` inside the route content
 * (which is never transformed), and nothing animates on its own.
 */
export const PageTitle = forwardRef<HTMLHeadingElement, PageTitleProps>(function PageTitle(
  { children, compactTitle, className = '', ...rest },
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
      const edge = viewport.getBoundingClientRect().top;
      const rect = title.getBoundingClientRect();
      // 0 while the title is fully below the edge band, 1 once it has passed.
      const covered = edge + 44 - rect.top;
      progress.set(Math.min(1, Math.max(0, covered / Math.max(1, rect.height))));
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
          style={{ opacity: bandOpacity, pointerEvents: bandPointer }}
          aria-hidden
          onClick={scrollToTop}
        >
          <motion.span className="page-scroll-edge-title" style={{ y: bandY }}>
            {label}
          </motion.span>
        </motion.div>
      )}
    </>
  );
});
