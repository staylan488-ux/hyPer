import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLitSurface } from '@/hooks/useLitSurface';
import { useFirstReveal } from '@/lib/motionPolicy';

interface MetalRingProps {
  /** 0…1 of the ring that is filled with chrome. Past 1 the full ring turns lacquer. */
  progress: number;
  /** Accessible description of what the ring measures. */
  label: string;
  size?: number;
  thickness?: number;
  /** Once-per-session draw-in key (see useFirstReveal). */
  reveal?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A progress dial machined from liquid metal: the filled arc is the same
 * chrome as the hero actions, its reflections drifting and turning with the
 * phone's tilt. The groove underneath shows what is left.
 */
export function MetalRing({ progress, label, size = 104, thickness = 7, reveal, className = '', children }: MetalRingProps) {
  const litRef = useLitSurface<HTMLDivElement>();
  const target = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const over = Number.isFinite(progress) && progress > 1.001;
  const first = useFirstReveal(reveal);
  const [drawn, setDrawn] = useState(!first);

  useEffect(() => {
    if (drawn) return;
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [drawn]);

  const style = {
    '--ring-size': `${size}px`,
    '--ring-w': `${thickness}px`,
    '--ring-p': drawn ? target : 0,
  } as CSSProperties;

  return (
    <div ref={litRef} role="img" aria-label={label} className={`metal-ring${over ? ' is-over' : ''} ${className}`} style={style}>
      <span className="metal-ring-track" aria-hidden />
      <span className="metal-ring-fill" aria-hidden />
      {children && <div className="metal-ring-center">{children}</div>}
    </div>
  );
}
