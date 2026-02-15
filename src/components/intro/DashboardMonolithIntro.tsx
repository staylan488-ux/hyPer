import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { springs } from '@/lib/animations';
import { markDashboardIntroPlayed, shouldPlayDashboardIntro } from '@/components/intro/introState';

export function DashboardMonolithIntro() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(() => shouldPlayDashboardIntro());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!active) return;

    markDashboardIntroPlayed();

    if (reduceMotion) {
      const quick = window.setTimeout(() => setActive(false), 220);
      return () => window.clearTimeout(quick);
    }

    const expandTimer = window.setTimeout(() => setExpanded(true), 180);
    const endTimer = window.setTimeout(() => setActive(false), 920);

    return () => {
      window.clearTimeout(expandTimer);
      window.clearTimeout(endTimer);
    };
  }, [active, reduceMotion]);

  if (!active) return null;

  return (
    <AnimatePresence>
      <motion.button
        type="button"
        aria-label="Skip intro"
        className="fixed inset-0 z-40 bg-[#1A1A1A] px-5 pt-8"
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(196, 164, 132, 0.02), transparent 58%)',
        }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={() => setActive(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActive(false);
          }
        }}
      >
        <motion.div
          className="max-w-lg mx-auto rounded-[28px] border border-white/[0.03] bg-[#242424] px-5 py-5"
          initial={{ opacity: 0, scale: 0.98, height: 90 }}
          animate={{
            opacity: 1,
            scale: 1,
            height: expanded ? 260 : 90,
          }}
          transition={reduceMotion ? { duration: 0.2 } : springs.heavy}
        >
          <motion.p
            className="text-[10px] tracking-[0.3em] text-[#6B6B6B]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduceMotion ? { duration: 0.1 } : { duration: 0.3 }}
          >
            hyPer
          </motion.p>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={reduceMotion ? { duration: 0.16 } : springs.smooth}
                className="mt-5"
              >
                <p className="text-3xl font-display-italic text-[#E8E4DE] tracking-tight">Welcome Back</p>
                <p className="text-[11px] tracking-[0.1em] text-[#6B6B6B] mt-2">Dialing in your training dashboard</p>
                <div className="grid grid-cols-2 gap-3 mt-6">
                  <div className="h-24 rounded-[20px] bg-[#2E2E2E] border border-white/10" />
                  <div className="h-24 rounded-[20px] bg-[#2E2E2E] border border-white/10" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.button>
    </AnimatePresence>
  );
}
