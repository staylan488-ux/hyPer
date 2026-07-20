import { type Transition, type Variants } from 'motion/react';

// ═══════════════════════════════════
// SPRING CONFIGS
// ═══════════════════════════════════

// FOLIO motion — calm and critically damped. No overshoot, no bounce.
// Emphasis is scale, weight and the single lacquer rule, never a spring wobble.
const EASE_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const springs = {
  snappy: { type: 'tween', duration: 0.26, ease: EASE_EXPO } as Transition,
  smooth: { type: 'tween', duration: 0.42, ease: EASE_EXPO } as Transition,
  bouncy: { type: 'tween', duration: 0.46, ease: EASE_EXPO } as Transition,
  gentle: { type: 'tween', duration: 0.56, ease: EASE_EXPO } as Transition,
  responsive: { type: 'tween', duration: 0.34, ease: EASE_EXPO } as Transition,
  heavy: { type: 'tween', duration: 0.6, ease: EASE_EXPO } as Transition,
};

// ═══════════════════════════════════
// SHARED VARIANTS
// ═══════════════════════════════════

/** Fade-up entrance for individual items — content "develops" onto the page */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
};

/** Fade-up entrance triggered by scroll (whileInView) */
export const inViewFadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
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
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  },
};

// ═══════════════════════════════════
// BUTTON PRESS — quiet, no hover lift
// ═══════════════════════════════════

export const buttonTap = {
  whileTap: { scale: 0.985 },
  transition: springs.snappy,
};

// ═══════════════════════════════════
// CARD PRESS — flat, no elevation change
// ═══════════════════════════════════

export const cardHover = {
  whileTap: { scale: 0.99 },
};

// ═══════════════════════════════════
// NAV ITEM TAP
// ═══════════════════════════════════

export const navItemTap = {
  whileTap: { scale: 0.94 },
  transition: springs.snappy,
};
