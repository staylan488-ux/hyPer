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
        className="fixed inset-0 z-40 px-5 pt-8 bg-[var(--color-base)]"
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
            className="inline-block [font-family:var(--font-display)] font-light text-[92px] leading-[0.86] tracking-[-0.05em] text-[var(--color-text)] select-none"
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
            <span className="italic text-[var(--color-accent)]">P</span>
          </motion.span>

          <AnimatePresence>
            {showCompose && (
              <motion.div
                className="absolute flex flex-col items-center"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.12 } : springs.smooth}
              >
                <div className="flex items-baseline">
                  <motion.span
                    className="[font-family:var(--font-display)] font-light text-[44px] leading-[0.86] tracking-[-0.05em] text-[var(--color-text)] select-none"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={reduceMotion ? { duration: 0.12 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  >
                    hy
                  </motion.span>
                  <motion.span
                    className="inline-block [font-family:var(--font-display)] italic font-light text-[44px] leading-[0.86] tracking-[-0.05em] text-[var(--color-accent)] select-none"
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
                    className="[font-family:var(--font-display)] font-light text-[44px] leading-[0.86] tracking-[-0.05em] text-[var(--color-text)] select-none"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={reduceMotion ? { duration: 0.12 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  >
                    er
                  </motion.span>
                </div>
                <motion.span
                  className="block h-px w-12 bg-[var(--color-accent)] mt-4 origin-center"
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={reduceMotion ? { duration: 0.12 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.button>
    </AnimatePresence>
  );
}
