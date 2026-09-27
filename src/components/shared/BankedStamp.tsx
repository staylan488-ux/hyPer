import { motion } from 'motion/react';
import { useFirstReveal } from '@/lib/motionPolicy';

/**
 * A lacquer rubber stamp for a banked day: pressed onto the page with weight
 * the first time it appears in a session, then simply printed.
 */
export function BankedStamp({ label = 'Banked', date, className = '' }: { label?: string; date?: string; className?: string }) {
  const firstReveal = useFirstReveal(`banked-stamp-${date ?? label}`);
  return (
    <motion.span
      className={`banked-stamp ${className}`}
      aria-hidden
      initial={firstReveal ? { scale: 1.7, opacity: 0, rotate: -2 } : false}
      animate={{ scale: 1, opacity: 1, rotate: -7 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22, mass: 1.1, delay: 0.25 }}
    >
      <span className="banked-stamp-label">{label}</span>
      {date && <span className="banked-stamp-date">{date}</span>}
    </motion.span>
  );
}
