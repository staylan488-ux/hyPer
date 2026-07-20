import { type CSSProperties } from 'react';
import { motion } from 'motion/react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ROLL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface RollingNumberProps {
  /** Pre-formatted display string ("1,240", "2:34"). Digit columns roll; separators stay put. */
  value: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Letterpress odometer for hero data. Each digit is a column of 0–9 that
 * rolls to its value — Fraunces numerals doing what they were made for.
 * Purely presentational: inherits font/size/colour from the surrounding
 * class, honours reduced motion via MotionConfig (digits land instantly).
 */
export function RollingNumber({ value, className = '', style }: RollingNumberProps) {
  const chars = value.split('');

  return (
    <span className={`inline-flex items-baseline ${className}`} style={style} aria-label={value}>
      {chars.map((ch, i) => {
        // Key by position from the right so the units column keeps its
        // identity when the string grows (99 → 100): existing digits roll.
        const key = `p${chars.length - 1 - i}`;

        if (!/\d/.test(ch)) {
          return (
            <span key={key} aria-hidden className="shrink-0">
              {ch}
            </span>
          );
        }

        const digit = Number(ch);
        return (
          <span key={key} aria-hidden className="inline-block h-[1em] overflow-hidden">
            <motion.span
              className="flex flex-col will-change-transform"
              initial={{ y: '0em' }}
              animate={{ y: `-${digit}em` }}
              transition={{ duration: 0.5, ease: ROLL_EASE }}
            >
              {DIGITS.map((n) => (
                <span key={n} className="flex h-[1em] items-end justify-center leading-none">
                  {n}
                </span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
