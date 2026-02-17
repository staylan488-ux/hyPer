import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { springs } from '@/lib/animations';
import { markDashboardIntroPlayed, shouldPlayDashboardIntro } from '@/components/intro/introState';

export function DashboardMonolithIntro() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(() => shouldPlayDashboardIntro());
  const [showCompose, setShowCompose] = useState(false);

  useEffect(() => {
    if (!active) return;

    markDashboardIntroPlayed();

    if (reduceMotion) {
      const quick = window.setTimeout(() => setActive(false), 220);
      return () => window.clearTimeout(quick);
    }

    const composeTimer = window.setTimeout(() => setShowCompose(true), 150);
    const endTimer = window.setTimeout(() => setActive(false), 680);

    return () => {
      window.clearTimeout(composeTimer);
      window.clearTimeout(endTimer);
    };
  }, [active, reduceMotion]);

  if (!active) return null;

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        aria-label="Skip intro"
        className="fixed inset-0 z-40 px-5 pt-8"
        style={{
          backgroundColor: 'var(--color-base)',
          backgroundImage:
            'radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 56%)',
        }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        onClick={() => setActive(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActive(false);
          }
        }}
      >
        <div className="max-w-lg mx-auto h-28 flex items-center justify-center relative overflow-visible">
          <motion.span
            className="inline-block font-display-italic text-[92px] leading-[1.08] text-[var(--color-accent)] pr-[0.2em] pt-[0.08em] -mr-[0.2em] select-none"
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{
              opacity: showCompose ? 0 : 1,
              scale: showCompose ? 0.68 : 1,
              y: showCompose ? -4 : 0,
            }}
            transition={reduceMotion ? { duration: 0.12 } : springs.heavy}
            style={{
              backfaceVisibility: 'hidden',
              transform: 'translateZ(0)',
              willChange: 'transform, opacity',
            }}
          >
            P
          </motion.span>

          <AnimatePresence>
            {showCompose && (
              <motion.div
                className="absolute flex items-center"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.12 } : springs.smooth}
              >
                <motion.span
                  className="text-[11px] tracking-[0.32em] text-[var(--color-text)]"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  hy
                </motion.span>
                <motion.span
                  className="inline-block font-display-italic text-[42px] leading-[1.08] text-[var(--color-accent)] mx-1 pr-[0.18em] pt-[0.08em] -mr-[0.18em] select-none"
                  initial={{ opacity: 0, scale: 0.84 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={reduceMotion ? { duration: 0.12 } : { ...springs.snappy, delay: 0.04 }}
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'translateZ(0)',
                    willChange: 'transform, opacity',
                  }}
                >
                  P
                </motion.span>
                <motion.span
                  className="text-[11px] tracking-[0.32em] text-[var(--color-text)]"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  er
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </AnimatePresence>
  );
}
