import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';

export type LineArtSubject = 'barbell' | 'plate' | 'program' | 'chart';

interface Stroke {
  d: string;
  accent?: boolean;
  dashed?: boolean;
}

// Single-weight ink drawings on a 120 × 72 page. Each subject keeps one small
// lacquer detail, drawn last.
const DRAWINGS: Record<LineArtSubject, Stroke[]> = {
  barbell: [
    { d: 'M8 36 H112' },
    { d: 'M24 22 h8 a2 2 0 0 1 2 2 v24 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 v-24 a2 2 0 0 1 2 -2 Z' },
    { d: 'M16 27 h4 a2 2 0 0 1 2 2 v14 a2 2 0 0 1 -2 2 h-4 Z' },
    { d: 'M88 22 h8 a2 2 0 0 1 2 2 v24 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 v-24 a2 2 0 0 1 2 -2 Z' },
    { d: 'M98 27 h4 v18 h-4 a2 2 0 0 1 -2 -2 v-14 a2 2 0 0 1 2 -2 Z' },
    { d: 'M40 31 v10 M80 31 v10' },
    { d: 'M52 58 q8 -5 16 0', accent: true },
  ],
  plate: [
    { d: 'M60 10 a26 26 0 1 1 -0.01 0 Z' },
    { d: 'M60 20 a16 16 0 1 1 -0.01 0 Z' },
    { d: 'M18 14 v18 a4 4 0 0 0 8 0 v-18 M22 14 v50' },
    { d: 'M100 14 c6 6 6 18 0 22 v28' },
    { d: 'M54 33 c4 -6 10 -6 13 -2 c-3 5 -9 6 -13 2 Z M54 33 l-4 4', accent: true },
  ],
  program: [
    { d: 'M18 14 H102 V60 H18 Z' },
    { d: 'M18 26 H102' },
    { d: 'M46 26 V60 M74 26 V60 M18 43 H102' },
    { d: 'M30 8 v10 M90 8 v10' },
    { d: 'M53 36 l4 4 l9 -9', accent: true },
  ],
  chart: [
    { d: 'M14 60 H106' },
    { d: 'M22 60 V44 h10 V60 M42 60 V36 h10 V60 M62 60 V40 h10 V60 M82 60 V24 h10 V60' },
    { d: 'M20 40 L44 30 L66 33 L90 14', dashed: true },
    { d: 'M87 14 h4 v4', accent: true },
  ],
};

/**
 * Editorial line drawing for empty states: strokes ink themselves in, then
 * the lacquer detail lands. Draws once per session per subject; reduced
 * motion shows the finished drawing.
 */
export function LineArt({ subject, className = '' }: { subject: LineArtSubject; className?: string }) {
  const firstReveal = useFirstReveal(`line-art-${subject}`);
  const strokes = DRAWINGS[subject];
  const inkCount = strokes.filter((stroke) => !stroke.accent).length;
  // Ink strokes draw in order; the lacquer detail lands after the last one.
  const delays: number[] = [];
  for (let i = 0, ink = 0; i < strokes.length; i += 1) {
    delays.push(strokes[i].accent ? 0.15 + inkCount * 0.16 : 0.1 + (ink++) * 0.16);
  }

  return (
    <svg className={className} width={120} height={72} viewBox="0 0 120 72" fill="none" aria-hidden>
      {strokes.map((stroke, index) => {
        const delay = delays[index];
        return (
          <motion.path
            key={index}
            d={stroke.d}
            stroke={stroke.accent ? 'var(--color-accent)' : 'var(--color-text-dim)'}
            strokeWidth={stroke.accent ? 1.75 : 1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={stroke.dashed ? '3 4' : undefined}
            initial={firstReveal ? (stroke.dashed ? { opacity: 0 } : { pathLength: 0, opacity: 0 }) : false}
            animate={stroke.dashed ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
            transition={
              stroke.accent
                ? { pathLength: { duration: 0.5, delay, ease: 'easeOut' }, opacity: { duration: 0.1, delay } }
                : {
                    pathLength: { duration: 0.7, delay, ease: [0.45, 0, 0.25, 1] },
                    opacity: { duration: 0.1, delay },
                    ...(stroke.dashed ? { opacity: { ...springs.settle, delay } } : {}),
                  }
            }
          />
        );
      })}
    </svg>
  );
}
