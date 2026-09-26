import { useEffect, useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { readMotionPolicy } from '@/lib/motionPolicy';

interface CountUpProps {
  value: number;
  /** Formats each frame's value; defaults to a rounded, grouped integer. */
  format?: (value: number) => string;
  /** Seconds to reach the value. */
  duration?: number;
  delay?: number;
  className?: string;
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString('en-US');

/**
 * A figure that counts up to its value once on mount, decelerating like a
 * dial settling. Text is written directly to the node, so counting never
 * re-renders React. Reduced motion shows the final figure at once.
 */
export function CountUp({ value, format = defaultFormat, duration = 1.1, delay = 0, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (readMotionPolicy().reducedMotion || !Number.isFinite(value)) {
      node.textContent = formatRef.current(value);
      return;
    }
    node.textContent = formatRef.current(0);
    const controls = animate(0, value, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => { node.textContent = formatRef.current(latest); },
    });
    return () => controls.stop();
  }, [value, duration, delay]);

  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      {format(value)}
    </span>
  );
}
