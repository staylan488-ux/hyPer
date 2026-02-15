import { type Transition, type Variants } from 'motion/react';

// ═══════════════════════════════════
// SPRING CONFIGS
// ═══════════════════════════════════

export const springs = {
  snappy: { type: 'spring', stiffness: 500, damping: 30 } as Transition,
  smooth: { type: 'spring', stiffness: 300, damping: 30 } as Transition,
  bouncy: { type: 'spring', stiffness: 400, damping: 15 } as Transition,
  gentle: { type: 'spring', stiffness: 200, damping: 20 } as Transition,
  responsive: { type: 'spring', stiffness: 350, damping: 25 } as Transition,
  heavy: { type: 'spring', stiffness: 250, damping: 35 } as Transition,
};

// ═══════════════════════════════════
// SHARED VARIANTS
// ═══════════════════════════════════

/** Fade-up entrance for individual items */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

/** Fade-up entrance triggered by scroll (whileInView) */
export const inViewFadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/** Fade-in (no movement) */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Scale-up entrance */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

/** Slide from bottom (modal) */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: '100%' },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: '100%' },
};

/** Scale from center (desktop modal) */
export const scaleUp: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
};

/** Backdrop fade */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// ═══════════════════════════════════
// STAGGER CONTAINER VARIANTS
// ═══════════════════════════════════

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

export const staggerContainerSlow: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

// ═══════════════════════════════════
// PAGE TRANSITION VARIANTS
// ═══════════════════════════════════

export const pageTransition: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

// ═══════════════════════════════════
// BUTTON PRESS
// ═══════════════════════════════════

export const buttonTap = {
  whileTap: { scale: 0.96, y: 1 },
  whileHover: { scale: 1.01 },
  transition: springs.snappy,
};

// ═══════════════════════════════════
// CARD HOVER
// ═══════════════════════════════════

export const cardHover = {
  whileHover: { y: -2, transition: springs.smooth },
  whileTap: { scale: 0.985 },
};

// ═══════════════════════════════════
// NAV ITEM TAP
// ═══════════════════════════════════

export const navItemTap = {
  whileTap: { scale: 0.9 },
  transition: springs.snappy,
};
