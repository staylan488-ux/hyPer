import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLitSurface } from '@/hooks/useLitSurface';
import { useFirstReveal } from '@/lib/motionPolicy';

interface LiquidOrbProps {
  /** 0…1 of the sphere filled with mercury. Past 1 the mercury turns lacquer. */
  progress: number;
  /** Accessible description of what the orb measures. */
  label: string;
  size?: number;
  /** Once-per-session fill-up key (see useFirstReveal). */
  reveal?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A glass sphere holding liquid metal at the level of a ratio. The surface
 * stays level as the phone tilts and moves in two slow waves; reflections
 * follow the motion light. Used for a screen's single headline ratio.
 */
export function LiquidOrb({ progress, label, size = 116, reveal, className = '', children }: LiquidOrbProps) {
  const litRef = useLitSurface<HTMLDivElement>();
  const finite = Number.isFinite(progress);
  const target = Math.max(0, Math.min(1, finite ? progress : 0));
  const over = finite && progress > 1.001;
  const first = useFirstReveal(reveal);
  const [filled, setFilled] = useState(!first);

  useEffect(() => {
    if (filled) return;
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [filled]);

  const level = filled ? target : 0;
  const style = {
    '--orb-size': `${size}px`,
    '--orb-p': level,
  } as CSSProperties;

  return (
    <div
      ref={litRef}
      role="img"
      aria-label={label}
      className={`liquid-orb${over ? ' is-over' : ''}${level <= 0 ? ' is-empty' : ''} ${className}`}
      style={style}
    >
      <span className="orb-liquid" aria-hidden>
        <span className="orb-wave orb-wave-back" />
        <span className="orb-wave orb-wave-front" />
      </span>
      <span className="orb-glass" aria-hidden />
      {children && <div className="orb-center" aria-hidden>{children}</div>}
    </div>
  );
}
