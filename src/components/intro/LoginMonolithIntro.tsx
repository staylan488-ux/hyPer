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
      <motion.button
        type="button"
        aria-label="Skip intro"
        className="fixed inset-0 z-50 px-5 flex items-center justify-center"
        style={{
          backgroundColor: 'var(--color-base)',
          backgroundImage:
            'radial-gradient(circle at 50% 24%, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent 58%)',
        }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.34, ease: 'easeOut' }}
        onClick={onComplete}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onComplete();
          }
        }}
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
              className="inline-block font-display-italic text-[120px] leading-[1.08] text-[var(--color-accent)] pr-[0.2em] pt-[0.08em] -mr-[0.2em] select-none"
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: [0.92, 1.01, 1], opacity: 1 }}
              transition={reduceMotion ? { duration: 0.18 } : { duration: 0.64, ease: [0.16, 1, 0.3, 1] }}
              style={{
                backfaceVisibility: 'hidden',
                transform: 'translateZ(0)',
                willChange: 'transform, opacity',
              }}
            >
              P
            </motion.span>
            <motion.div
              className="absolute inset-0 rounded-full"
              initial={{ opacity: 0 }}
              animate={{
                opacity: [0, 0.18, 0],
                scale: [0.86, 1.24, 1.46],
              }}
              transition={reduceMotion ? { duration: 0.18 } : { duration: 0.7, ease: 'easeOut', delay: 0.12 }}
              style={{
                background:
                  'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 26%, transparent), transparent 72%)',
                filter: 'blur(4px)',
              }}
            />
          </motion.div>

          <AnimatePresence>
            {showCompose && (
              <motion.div
                className="absolute flex items-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.14 } : springs.smooth}
              >
                <motion.span
                  className="text-[12px] tracking-[0.34em] text-[var(--color-text)]"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : composeTransition}
                >
                  hy
                </motion.span>
                <motion.span
                  className="inline-block font-display-italic text-[52px] leading-[1.08] text-[var(--color-accent)] mx-1.5 pr-[0.18em] pt-[0.08em] -mr-[0.18em] select-none"
                  initial={{ opacity: 0, scale: 0.8, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={reduceMotion ? { duration: 0.12 } : { ...springs.heavy, delay: 0.06 }}
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'translateZ(0)',
                    willChange: 'transform, opacity',
                  }}
                >
                  P
                </motion.span>
                <motion.span
                  className="text-[12px] tracking-[0.34em] text-[var(--color-text)]"
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
            animate={{ opacity: showWordmark ? 0.9 : 0, scaleX: showWordmark ? 1 : 0 }}
            transition={reduceMotion ? { duration: 0.12 } : { duration: 0.44, ease: [0.16, 1, 0.3, 1] }}
          />

          <motion.div
            className="absolute inset-x-0 top-[74%] text-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: showWordmark ? 1 : 0, y: showWordmark ? 0 : 8 }}
            transition={reduceMotion ? { duration: 0.12 } : springs.smooth}
          >
            <p className="text-[10px] tracking-[0.32em] text-[var(--color-text)]">hyPer</p>
            <p className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-muted)] mt-2">Training and Nutrition</p>
          </motion.div>
        </div>
      </motion.button>
    </AnimatePresence>
  );
}
