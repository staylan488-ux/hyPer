import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitBurst, onBurst, particleAlpha, spawnParticles, stepParticles } from '../src/lib/fx';

const colors = { ink: '#111', accent: '#a00', paper: '#777' };

function seeded(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('fx bursts', () => {
  it('spawns a clamped number of particles at the origin, launched upward', () => {
    const particles = spawnParticles({ x: 100, y: 400, count: 500 }, colors, seeded());
    expect(particles).toHaveLength(160);
    for (const p of particles) {
      expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(4);
      expect(p.vy).toBeLessThan(0);
    }
    expect(spawnParticles({ x: 0, y: 0, count: 1 }, colors, seeded())).toHaveLength(4);
  });

  it('uses the requested palette', () => {
    const ink = spawnParticles({ x: 0, y: 0, count: 60, palette: 'ink' }, colors, seeded());
    expect(ink.every((p) => p.color !== colors.accent)).toBe(true);
    const lacquer = spawnParticles({ x: 0, y: 0, count: 60, palette: 'lacquer' }, colors, seeded());
    expect(lacquer.some((p) => p.color === colors.accent)).toBe(true);
  });

  it('pulls particles down with gravity and retires them after their lifetime', () => {
    let particles = spawnParticles({ x: 0, y: 0, count: 20 }, colors, seeded(3));
    const initialVy = particles[0].vy;
    particles = stepParticles(particles, 1 / 60);
    expect(particles[0].vy).toBeGreaterThan(initialVy);
    for (let i = 0; i < 200 && particles.length; i += 1) particles = stepParticles(particles, 1 / 60);
    expect(particles).toHaveLength(0);
  });

  it('fades in quickly and out to nothing', () => {
    const [p] = spawnParticles({ x: 0, y: 0, count: 4 }, colors, seeded());
    expect(particleAlpha({ ...p, age: 0 })).toBe(0);
    expect(particleAlpha({ ...p, age: p.ttl * 0.08 })).toBeCloseTo(1);
    expect(particleAlpha({ ...p, age: p.ttl })).toBeCloseTo(0);
  });

  it('skips bursts under reduced motion', () => {
    const received: number[] = [];
    const off = onBurst((burst) => received.push(burst.x));
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({
        matches: query.includes('reduced-motion'),
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    emitBurst({ x: 1, y: 1 });
    vi.unstubAllGlobals();
    emitBurst({ x: 2, y: 2 });
    off();
    emitBurst({ x: 3, y: 3 });
    expect(received).toEqual([2]);
  });
});
