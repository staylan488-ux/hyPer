import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { supportsWebGL, useMotionPolicy } from '@/lib/motionPolicy';
import { useThemeStore } from '@/stores/themeStore';
import type { CapsuleGlyph } from '@/lib/commandCapsule';
import type { RingHandle } from './metalRingGL';

interface MetalRingProps {
  glyph: CapsuleGlyph;
  /** Accessible name: what the ring does ("Log set 2 of Barbell Row"). */
  label: string;
  onPress: () => void;
  /** CSS pixels; the command capsule uses 56. */
  size?: number;
  disabled?: boolean;
  /** Work in flight: the ring stays put and its light hurries. */
  busy?: boolean;
  className?: string;
}

/**
 * The liquid-metal ring button. A static CSS ring paints first and stays
 * whenever WebGL is unavailable; the live shader loads lazily into a shared
 * context, pauses off screen, follows the motion light, and under reduced
 * motion, reduced transparency or increased contrast settles on one frame.
 */
export function MetalRing({ glyph, label, onPress, size = 56, disabled = false, busy = false, className = '' }: MetalRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handleRef = useRef<RingHandle | null>(null);
  const [live, setLive] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const policy = useMotionPolicy();
  const still = policy.reducedMotion || policy.reducedTransparency;
  const initial = useRef({ glyph, light: theme === 'light', mode: still ? 'still' as const : 'live' as const, size });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !supportsWebGL()) return;
    let cancelled = false;
    let handle: RingHandle | null = null;
    import('./metalRingGL')
      .then(({ mountRing }) => {
        if (cancelled) return;
        handle = mountRing(canvas, {
          ...initial.current,
          onFail: () => {
            handle?.dispose();
            handleRef.current = null;
            setLive(false);
          },
        });
        handleRef.current = handle;
        setLive(handle !== null);
      })
      .catch(() => { /* The static ring stays. */ });
    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    initial.current = { glyph, light: theme === 'light', mode: still ? 'still' : 'live', size };
    handleRef.current?.update(initial.current);
  }, [glyph, theme, still, size, live]);

  useEffect(() => {
    handleRef.current?.setSpeed(busy ? 2.4 : 1);
  }, [busy, live]);

  // Pause while off screen.
  useEffect(() => {
    const button = buttonRef.current;
    if (!button || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => handleRef.current?.setVisible(entry.isIntersecting));
    observer.observe(button);
    return () => observer.disconnect();
  }, [live]);

  const press = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled || busy) return;
    handleRef.current?.press();
    onPress();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`metal-ring${live ? ' is-live' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-disabled={disabled || busy || undefined}
      disabled={disabled}
      onClick={press}
      data-glyph={glyph}
    >
      <span className="metal-ring-static" aria-hidden>
        <span className="metal-ring-lip" />
        <span className="metal-ring-band" />
        <span className="metal-ring-face" />
        <StaticGlyph glyph={glyph} />
      </span>
      <canvas ref={canvasRef} aria-hidden />
    </button>
  );
}

/** The glyph in ring units (radius 1, y up), matching the shader. */
function StaticGlyph({ glyph }: { glyph: CapsuleGlyph }) {
  const d = glyph === 'check'
    ? 'M-0.235,-0.005 L-0.075,0.155 L0.245,-0.165'
    : glyph === 'plus'
      ? 'M-0.235,0 L0.235,0 M0,-0.235 L0,0.235'
      : 'M-0.235,0 L0.235,0 M0.06,-0.175 L0.235,0 L0.06,0.175';
  return (
    <svg className="metal-ring-glyph" viewBox="-1 -1 2 2" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
