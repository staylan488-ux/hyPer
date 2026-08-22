// Deterministic GPS sample scripts. Placed in lib/ (not preview/) on purpose:
// Vitest drives the tracker engine with the exact streams the /preview
// simulator replays, so a green test means the sandbox demo works.
import type { GpsSample } from '@/lib/runTracker';

interface ScenarioPhase {
  speedMps: number;
  durationS: number;
}

const BASE_LAT = 37.8712;
const BASE_LON = -122.2601;
const METERS_PER_DEG_LAT = 111_320;
// at the scenario's base latitude; only used to place lateral wobble
const METERS_PER_DEG_LON = 88_000;

// straight-line course north from campus; one sample per second, times are
// RELATIVE ms from scenario start (playback/tests add their own base time)
/**
 * Deterministic pseudo-random noise, so a scenario carrying jitter is still
 * byte-identical between runs. A real fix wanders; a fixture that does not
 * would let a pipeline look perfect on data no phone ever produces.
 */
function seededJitter(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    // two draws averaged: roughly gaussian, mean 0, range +/-1
    return ((state / 0xffffffff) + (((state >>> 16) & 0xffff) / 0xffff)) - 1;
  };
}

export function buildScenarioSamples(
  phases: ScenarioPhase[],
  accuracyM = 8,
  /**
   * Per-sample position wander in metres, 1 sigma. Real GPS at this accuracy
   * wobbles by roughly 0.14 x accuracy between consecutive fixes, which is
   * exactly the noise the tracker removes in quadrature. Left at 0 by default
   * so existing callers are unaffected.
   */
  jitterM = 0,
): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  let northM = 0;
  const jitter = seededJitter(0x5eed);

  samples.push({ t: 0, lat: BASE_LAT, lon: BASE_LON, accuracyM, speedMps: 0 });
  for (const phase of phases) {
    for (let s = 0; s < phase.durationS; s++) {
      t += 1000;
      northM += phase.speedMps;
      const wobbleN = jitterM > 0 ? jitter() * jitterM : 0;
      const wobbleE = jitterM > 0 ? jitter() * jitterM : 0;
      samples.push({
        t,
        lat: BASE_LAT + (northM + wobbleN) / METERS_PER_DEG_LAT,
        lon: BASE_LON + wobbleE / METERS_PER_DEG_LON,
        accuracyM,
        speedMps: phase.speedMps,
      });
    }
  }
  return samples;
}

export interface GpsScenario {
  id: string;
  label: string;
  build: () => GpsSample[];
}

// ~4:45/km steady run, 5.04 km in 24 minutes
export const steadyRun5k: GpsScenario = {
  id: 'steady5k',
  label: 'Steady 5k',
  // carries realistic per-fix wobble so the tracker's noise removal is
  // exercised against a course whose TRUE length is still known exactly
  build: () => buildScenarioSamples([{ speedMps: 3.5, durationS: 1440 }], 8, 0.5),
};

// 8 × 400m hard (90s @ 4.44 m/s) with 90s floats (2.0 m/s) between
export const intervals8x400: GpsScenario = {
  id: 'intervals8x400',
  label: '8 × 400m',
  build: () => {
    const phases: ScenarioPhase[] = [];
    for (let i = 0; i < 8; i++) {
      phases.push({ speedMps: 400 / 90, durationS: 90 });
      if (i < 7) phases.push({ speedMps: 2.0, durationS: 90 });
    }
    return buildScenarioSamples(phases, 8, 0.5);
  },
};

// legacy regression fixture for old sprint snapshots; no longer offered in UI
export const sprints6x90m: GpsScenario = {
  id: 'sprints6',
  label: '6 × sprint',
  build: () => {
    const phases: ScenarioPhase[] = [{ speedMps: 1.8, durationS: 30 }];
    for (let i = 0; i < 6; i++) {
      phases.push({ speedMps: 7.5, durationS: 12 });
      phases.push({ speedMps: 1.8, durationS: 90 });
    }
    return buildScenarioSamples(phases);
  },
};

// standing still: the fix wanders a few meters each second (deterministic
// sine/cosine wander) while the device reports ~0 speed. A correct tracker
// must accrue ~no distance — this reproduces the "distance climbs while
// standing" bug and proves the stationary gate fixes it.
export const stationaryDrift: GpsScenario = {
  id: 'stationary',
  label: 'Standing still (drift)',
  build: () => {
    const samples: GpsSample[] = [];
    for (let s = 0; s <= 120; s++) {
      const wanderM = 6 * Math.sin(s / 3) + 4 * Math.cos(s / 1.7); // ±~10 m
      samples.push({
        t: s * 1000,
        lat: BASE_LAT + wanderM / METERS_PER_DEG_LAT,
        lon: BASE_LON + (3 * Math.cos(s / 2.3)) / METERS_PER_DEG_LAT,
        accuracyM: 12,
        speedMps: 0, // device Doppler: stationary
      });
    }
    return samples;
  },
};

export const gpsScenarios: GpsScenario[] = [steadyRun5k, intervals8x400, stationaryDrift];
