import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useMotionPolicy } from '@/lib/motionPolicy';
import { useThemeStore } from '@/stores/themeStore';
import type { TokenFace } from '@/components/three/tokenScene';

interface SessionTokenProps {
  face: TokenFace;
  className?: string;
}

function waitForFonts(timeoutMs: number) {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const loads = Promise.all([
    document.fonts.load('360 120px Fraunces'),
    document.fonts.load('italic 400 54px Fraunces'),
    document.fonts.load('500 38px Geist'),
  ]).then(() => undefined, () => undefined);
  return Promise.race([loads, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
}

/**
 * The banked-session medallion: a lacquer enamel coin with the session's
 * name, date and tick ring embossed on its face. It spins down into the
 * sheet, tilts under a finger and catches the motion light. Devices without
 * WebGL get a flat printed version.
 */
export function SessionToken({ face, className = '' }: SessionTokenProps) {
  const policy = useMotionPolicy();
  const dark = useThemeStore((state) => state.theme) === 'dark';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const faceRef = useRef(face);
  const use3d = policy.rich && !failed;

  useEffect(() => {
    if (!use3d) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    Promise.all([import('@/components/three/tokenScene'), waitForFonts(900)])
      .then(([{ createToken }]) => {
        if (cancelled) return;
        const styles = getComputedStyle(document.documentElement);
        const token = createToken(canvas, {
          face: faceRef.current,
          dark,
          still: policy.reducedMotion,
          colors: {
            accent: styles.getPropertyValue('--color-accent').trim() || '#A8352A',
            paper: '#F5F1E8',
            ink: styles.getPropertyValue('--color-text').trim() || '#232625',
          },
          onReady: () => setReady(true),
          onContextLost: () => {
            dispose?.();
            dispose = null;
            setFailed(true);
          },
        });
        dispose = () => token.dispose();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
    // The coin is minted once per sheet; theme and motion policy are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3d]);

  if (!use3d) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
      <motion.div
        className="session-token-flat"
        initial={policy.reducedMotion ? false : { scale: 0.6, opacity: 0, rotate: -25 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ ...springs.lift, delay: 0.1 }}
        aria-hidden
      >
        <span className="session-token-flat-kicker">Session banked</span>
        <span className="session-token-flat-title">{face.title}</span>
        <span className="session-token-flat-date">{face.dateLabel}</span>
      </motion.div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} aria-hidden>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full transition-opacity duration-300"
        style={{ opacity: ready ? 1 : 0, touchAction: 'none' }}
      />
    </div>
  );
}
