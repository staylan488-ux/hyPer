import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { onBurst, particleAlpha, spawnParticles, stepParticles, type BurstColors, type Particle } from '@/lib/fx';

function readColors(): BurstColors {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--color-text', '#232625'),
    accent: read('--color-accent', '#A8352A'),
    paper: read('--color-text-dim', '#60645F'),
  };
}

/**
 * One viewport-fixed canvas for every celebration burst, portalled to body so
 * it never sits inside the route ancestor. It draws only while particles are
 * alive and ignores touches.
 */
export function FxLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let particles: Particle[] = [];
    let frame = 0;
    let last = 0;
    let dpr = 1;

    const fit = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };

    const draw = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        frame = 0;
        return;
      }
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      particles = stepParticles(particles, dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        ctx.globalAlpha = particleAlpha(p);
        ctx.fillStyle = p.color;
        if (p.shape === 'fleck') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // A paper shard tumbling in 3D: width follows the flip phase.
          const width = p.size * Math.max(0.12, Math.abs(Math.cos(p.flip)));
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-width / 2, -p.size * 0.32, width, p.size * 0.64);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      if (particles.length > 0) {
        frame = requestAnimationFrame(draw);
      } else {
        frame = 0;
        last = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.visibility = 'hidden';
        // Release the full-screen backing store; the next burst refits it.
        canvas.width = 0;
        canvas.height = 0;
      }
    };

    const unsubscribe = onBurst((burst) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.style.visibility !== 'visible') {
        fit();
        canvas.style.visibility = 'visible';
      }
      // Cap live particles so stacked bursts stay cheap.
      particles = [...particles, ...spawnParticles(burst, readColors())].slice(-320);
      if (!frame) frame = requestAnimationFrame(draw);
    });

    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      particles = [];
    };
    // A hidden canvas is refitted when the next burst starts.
    const onResize = () => {
      if (canvasRef.current?.style.visibility === 'visible') fit();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onHidden);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 w-screen h-screen pointer-events-none z-[55]"
      style={{ visibility: 'hidden' }}
    />,
    document.body,
  );
}
