import { readMotionPolicy } from '@/lib/motionPolicy';

/**
 * Celebration bursts: ink flecks and paper shards thrown from a point, drawn
 * by the single FxLayer canvas. Components only call `emitBurst*`; the layer
 * owns the canvas, and the simulation below is pure so it can be tested.
 */

export type BurstPalette = 'ink' | 'lacquer' | 'mixed';

export interface BurstOptions {
  /** Viewport coordinates of the origin, px. */
  x: number;
  y: number;
  palette?: BurstPalette;
  /** Number of particles (clamped 4–160). */
  count?: number;
  /** Launch speed scale; 1 is a set-sized pop, 1.6 a finished session. */
  power?: number;
  /** Half-angle of the launch cone around straight up, degrees. */
  spread?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** In-plane rotation, radians. */
  rot: number;
  vr: number;
  /** Tumble phase: a shard's apparent width follows cos(flip), faking 3D. */
  flip: number;
  vflip: number;
  age: number;
  ttl: number;
  size: number;
  shape: 'shard' | 'fleck';
  color: string;
}

export interface BurstColors {
  ink: string;
  accent: string;
  paper: string;
}

const GRAVITY = 1500; // px/s²
const DRAG = 1.9; // 1/s

type Listener = (burst: BurstOptions) => void;
const listeners = new Set<Listener>();

/** Subscribe the drawing layer. Returns an unsubscribe function. */
export function onBurst(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Throw a burst from a viewport point. No-op under reduced motion or when hidden. */
export function emitBurst(options: BurstOptions): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (readMotionPolicy().reducedMotion) return;
  listeners.forEach((listener) => listener(options));
}

/** Throw a burst from the centre (or top edge) of an element. */
export function emitBurstFrom(
  element: Element | null | undefined,
  options: Omit<BurstOptions, 'x' | 'y'> & { anchor?: 'center' | 'top' } = {},
): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const { anchor = 'center', ...rest } = options;
  emitBurst({
    ...rest,
    x: rect.left + rect.width / 2,
    y: anchor === 'top' ? rect.top : rect.top + rect.height / 2,
  });
}

function pickColor(palette: BurstPalette, colors: BurstColors, rand: () => number): string {
  if (palette === 'ink') return rand() < 0.82 ? colors.ink : colors.paper;
  if (palette === 'lacquer') return rand() < 0.7 ? colors.accent : colors.ink;
  const roll = rand();
  return roll < 0.45 ? colors.ink : roll < 0.85 ? colors.accent : colors.paper;
}

export function spawnParticles(burst: BurstOptions, colors: BurstColors, rand: () => number = Math.random): Particle[] {
  const count = Math.max(4, Math.min(160, Math.round(burst.count ?? 28)));
  const power = Math.max(0.2, burst.power ?? 1);
  const spread = ((burst.spread ?? 62) * Math.PI) / 180;
  const palette = burst.palette ?? 'mixed';
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = -Math.PI / 2 + (rand() * 2 - 1) * spread;
    const speed = (380 + rand() * 520) * power;
    const shard = rand() < 0.58;
    particles.push({
      x: burst.x + (rand() - 0.5) * 8,
      y: burst.y + (rand() - 0.5) * 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 14,
      flip: rand() * Math.PI * 2,
      vflip: 6 + rand() * 12,
      age: 0,
      ttl: 0.75 + rand() * 0.65 + (power - 1) * 0.35,
      size: shard ? 5 + rand() * 6 : 1.6 + rand() * 2.2,
      shape: shard ? 'shard' : 'fleck',
      color: pickColor(palette, colors, rand),
    });
  }
  return particles;
}

/** Advance the simulation by `dt` seconds; returns the particles still alive. */
export function stepParticles(particles: Particle[], dt: number): Particle[] {
  const step = Math.min(0.05, Math.max(0, dt));
  const damping = Math.exp(-DRAG * step);
  const alive: Particle[] = [];
  for (const p of particles) {
    p.age += step;
    if (p.age >= p.ttl) continue;
    p.vx *= damping;
    p.vy = p.vy * damping + GRAVITY * step;
    p.x += p.vx * step;
    p.y += p.vy * step;
    p.rot += p.vr * step;
    p.flip += p.vflip * step;
    alive.push(p);
  }
  return alive;
}

/** Opacity over a particle's life: quick in, long ink-like fade out. */
export function particleAlpha(p: Particle): number {
  const t = p.age / p.ttl;
  if (t < 0.08) return t / 0.08;
  return Math.max(0, 1 - Math.pow((t - 0.08) / 0.92, 1.6));
}
