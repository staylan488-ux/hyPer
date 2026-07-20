// Lightweight motion classifier for GPS tracking. It does not estimate route
// or stride length; it only answers whether the phone has shown sustained
// physical motion, which lets the GPS reducer distinguish slow walking from a
// stationary fix that is wandering indoors.

export interface MotionVector {
  x: number | null;
  y: number | null;
  z: number | null;
}

interface CompleteMotionVector {
  x: number;
  y: number;
  z: number;
}

interface EnergySample {
  t: number;
  magnitude: number;
}

const WINDOW_MS = 2500;
const BIN_MS = 250;
const MIN_ACTIVE_BINS = 4;
const ACTIVE_MAGNITUDE_MPS2 = 0.7;
const MIN_RMS_MPS2 = 0.35;
const MOTION_LATCH_MS = 1800;
const GRAVITY_ALPHA = 0.9;

function completeVector(vector: MotionVector | null): vector is CompleteMotionVector {
  return vector != null && vector.x != null && vector.y != null && vector.z != null;
}

export interface DeviceMotionDetector {
  add: (
    t: number,
    acceleration: MotionVector | null,
    accelerationIncludingGravity: MotionVector | null,
  ) => void;
  isMoving: (nowMs: number) => boolean;
  hasSignal: () => boolean;
  reset: () => void;
}

export function createDeviceMotionDetector(): DeviceMotionDetector {
  let samples: EnergySample[] = [];
  let gravity: CompleteMotionVector | null = null;
  let movingUntilMs = 0;

  const reset = () => {
    samples = [];
    gravity = null;
    movingUntilMs = 0;
  };

  const add = (
    t: number,
    acceleration: MotionVector | null,
    accelerationIncludingGravity: MotionVector | null,
  ) => {
    let magnitude: number | null = null;

    // Prefer the platform's gravity-compensated acceleration. When Safari only
    // supplies accelerationIncludingGravity, subtract a low-pass gravity vector
    // so the result stays orientation-independent.
    if (completeVector(acceleration)) {
      magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
    } else if (completeVector(accelerationIncludingGravity)) {
      if (gravity == null) {
        gravity = { ...accelerationIncludingGravity };
        return;
      }
      gravity = {
        x: GRAVITY_ALPHA * gravity.x + (1 - GRAVITY_ALPHA) * accelerationIncludingGravity.x,
        y: GRAVITY_ALPHA * gravity.y + (1 - GRAVITY_ALPHA) * accelerationIncludingGravity.y,
        z: GRAVITY_ALPHA * gravity.z + (1 - GRAVITY_ALPHA) * accelerationIncludingGravity.z,
      };
      magnitude = Math.hypot(
        accelerationIncludingGravity.x - gravity.x,
        accelerationIncludingGravity.y - gravity.y,
        accelerationIncludingGravity.z - gravity.z,
      );
    }

    if (magnitude == null || !Number.isFinite(magnitude)) return;

    samples.push({ t, magnitude });
    const cutoff = t - WINDOW_MS;
    samples = samples.filter((sample) => sample.t >= cutoff);
    if (samples.length < 8) return;

    let squaredTotal = 0;
    const activeBins = new Set<number>();
    for (const sample of samples) {
      squaredTotal += sample.magnitude ** 2;
      if (sample.magnitude >= ACTIVE_MAGNITUDE_MPS2) {
        activeBins.add(Math.floor((sample.t - cutoff) / BIN_MS));
      }
    }

    const rms = Math.sqrt(squaredTotal / samples.length);
    if (activeBins.size >= MIN_ACTIVE_BINS && rms >= MIN_RMS_MPS2) {
      movingUntilMs = t + MOTION_LATCH_MS;
    }
  };

  return {
    add,
    isMoving: (nowMs) => movingUntilMs > 0 && nowMs <= movingUntilMs,
    hasSignal: () => samples.length > 0,
    reset,
  };
}
