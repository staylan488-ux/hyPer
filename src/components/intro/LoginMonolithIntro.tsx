import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { springs } from '@/lib/animations';

interface LoginMonolithIntroProps {
  active: boolean;
  onComplete: () => void;
}

const letters = ['h', 'y', 'P', 'e', 'r'];

export function LoginMonolithIntro({ active, onComplete }: LoginMonolithIntroProps) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    if (!active) return;

    if (reduceMotion) {
      const quick = window.setTimeout(onComplete, 280);
      return () => window.clearTimeout(quick);
    }

    const expandTimer = window.setTimeout(() => setExpanded(true), 620);
    const skeletonTimer = window.setTimeout(() => setShowSkeleton(true), 840);
    const completeTimer = window.setTimeout(onComplete, 1600);

    return () => {
      window.clearTimeout(expandTimer);
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(completeTimer);
    };
  }, [active, onComplete, reduceMotion]);

  if (!active) return null;

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        aria-label="Skip intro"
        className="fixed inset-0 z-50 bg-[#1A1A1A] px-5 flex items-center justify-center"
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 22%, rgba(196, 164, 132, 0.03), transparent 60%)',
        }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        onClick={onComplete}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onComplete();
          }
        }}
      >
        <motion.div
          className="w-full max-w-sm rounded-[28px] border border-white/[0.03] bg-[#242424] px-6 overflow-hidden"
          initial={{ opacity: 0, scale: 0.97, height: 92 }}
          animate={{
            opacity: 1,
            scale: 1,
            height: expanded ? 430 : 92,
          }}
          transition={reduceMotion ? { duration: 0.2 } : { ...springs.heavy }}
        >
          <div className="h-[92px] flex items-center justify-center relative">
            <motion.p className="text-[12px] tracking-[0.35em] text-[#E8E4DE]">
              {letters.map((letter, index) => (
                <motion.span
                  key={`${letter}-${index}`}
                  className="inline-block"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0.15 }
                      : { ...springs.smooth, delay: 0.1 + (index * 0.06) }
                  }
                >
                  {letter}
                </motion.span>
              ))}
            </motion.p>
            <motion.div
              className="absolute bottom-0 left-6 right-6 h-px bg-[#C4A484] origin-left"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: expanded ? 0 : 1, opacity: expanded ? 0 : 1 }}
              transition={reduceMotion ? { duration: 0.1 } : { duration: 0.46, ease: [0.16, 1, 0.3, 1], delay: 0.42 }}
            />
          </div>

          <AnimatePresence>
            {showSkeleton && (
              <motion.div
                className="pb-6"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.15 } : springs.smooth}
              >
                <p className="text-[10px] tracking-[0.3em] text-[#6B6B6B] text-center mb-4">hyPer</p>
                <p className="text-3xl font-display-italic text-[#E8E4DE] text-center mb-7">Welcome Back</p>
                <div className="space-y-3">
                  <div className="h-12 rounded-[20px] bg-[#1A1A1A] border border-white/10" />
                  <div className="h-12 rounded-[20px] bg-[#1A1A1A] border border-white/10" />
                  <div className="h-11 rounded-[28px] bg-[#E8E4DE]/90" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.button>
    </AnimatePresence>
  );
}
