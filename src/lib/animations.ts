import { type Transition, type Variants } from 'motion/react';

// ═══════════════════════════════════
// SPRINGS — Kinetic Studio
// ═══════════════════════════════════

// Physical springs, named by what they carry. Everyday state movement stays
// critically damped; only celebrations are allowed a visible overshoot.
// `visualDuration` is the time to visually reach the target, so the budgets
// below read like durations while keeping spring velocity hand-off.
export const springs = {
  /** Contact feedback: presses, chevrons, selection pills. */
  tactile: { type: 'spring', visualDuration: 0.2, bounce: 0 } as Transition,
  /** State movement: accordions, entrances, sheets, rails. */
  settle: { type: 'spring', visualDuration: 0.34, bounce: 0 } as Transition,
  /** Celebratory arrivals: stamps, beat-last chips, sealed targets. */
  lift: { type: 'spring', visualDuration: 0.46, bounce: 0.34 } as Transition,
  /** Large objects with mass: 3D tokens, full-width fills. */
  heavy: { type: 'spring', visualDuration: 0.62, bounce: 0.14 } as Transition,
};

/** Shared out-expo curve for CSS/WAAPI work that cannot use a spring. */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ═══════════════════════════════════
// SHARED VARIANTS
// ═══════════════════════════════════

/** Fade-up entrance for individual items — content "develops" onto the page */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
};

/** Backdrop fade */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};
