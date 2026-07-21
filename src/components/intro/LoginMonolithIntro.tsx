import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { springs } from '@/lib/animations';

interface LoginMonolithIntroProps {
  active: boolean;
  onComplete: () => void;
}

const composeTransition = { duration: 0.52, ease: [0.22, 1, 0.36, 1] as const };

export function LoginMonolithIntro({ active, onComplete }: LoginMonolithIntroProps) {
  const reduceMotion = useReducedMotion();
  const [showCompose, setShowCompose] = useState(false);
  const [showWordmark, setShowWordmark] = useState(false);

  useEffect(() => {
    if (!active) return;

    if (reduceMotion) {
      const quick = window.setTimeout(onComplete, 300);
      return () => window.clearTimeout(quick);
    }

    const composeTimer = window.setTimeout(() => setShowCompose(true), 540);
    const wordmarkTimer = window.setTimeout(() => setShowWordmark(true), 880);
    const completeTimer = window.setTimeout(onComplete, 1500);

    return () => {
      window.clearTimeout(composeTimer);
      window.clearTimeout(wordmarkTimer);
      window.clearTimeout(completeTimer);
    };
  }, [active, onComplete, reduceMotion]);

  if (!active) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-20 px-5 flex items-center justify-center pointer-events-none"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.34, ease: 'easeOut' }}
      >
        <div className="relative w-full max-w-sm h-56 flex items-center justify-center overflow-visible">
          <motion.div
            className="absolute"
            initial={{ opacity: 0, y: -18, scale: 0.9 }}
            animate={{
              opacity: showCompose ? 0 : 1,
              y: showCompose ? -8 : 0,
              scale: showCompose ? 0.72 : 1,
            }}
            transition={reduceMotion ? { duration: 0.12 } : { ...springs.heavy }}
          >
            <motion.span
              className="inline-block [font-family:var(--font-display)] italic font-light text-[120px] leading-none p-[0.12em] -m-[0.12em] text-[var(--color-accent)] select-none"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: [0.92, 1.01, 1], opacity: 1 }}
              transition={reduceMotion ? { duration: 0.18 } : { duration: 0.64, ease: [0.16, 1, 0.3, 1] }}
            >
              P
            </motion.span>
          </motion.div>

          <AnimatePresence>
            {showCompose && (
              <motion.div
                className="absolute flex items-baseline"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.14 } : springs.smooth}
              >
                <motion.span
                  className="[font-family:var(--font-display)] font-light text-[52px] leading-[0.86] tracking-[-0.05em] text-[var(--color-text)] select-none"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : composeTransition}
                >
                  hy
                </motion.span>
                <motion.span
                  className="inline-block [font-family:var(--font-display)] italic font-light text-[52px] leading-[0.86] tracking-[-0.05em] p-[0.12em] -m-[0.12em] text-[var(--color-accent)] select-none"
                  initial={{ opacity: 0, scale: 0.8, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : { ...springs.heavy, delay: 0.06 }}
                >
                  P
                </motion.span>
                <motion.span
                  className="[font-family:var(--font-display)] font-light text-[52px] leading-[0.86] tracking-[-0.05em] text-[var(--color-text)] select-none"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : composeTransition}
                >
                  er
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className="absolute inset-x-0 top-[70%] h-px bg-[var(--color-accent)] origin-center"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: showWordmark ? 1 : 0, scaleX: showWordmark ? 1 : 0 }}
            transition={reduceMotion ? { duration: 0.12 } : { duration: 0.44, ease: [0.16, 1, 0.3, 1] }}
          />

          <motion.div
            className="absolute inset-x-0 top-[74%] text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: showWordmark ? 1 : 0, y: showWordmark ? 0 : 8 }}
            transition={reduceMotion ? { duration: 0.12 } : springs.smooth}
          >
            <p className="t-label-sm">Training &amp; Nutrition</p>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
