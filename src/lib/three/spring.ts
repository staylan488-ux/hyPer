// Pure spring integration for 3D scenes (no three.js import, so it is testable
// and shareable).

/**
 * Critically damped spring toward a target, for camera and object motion that
 * must hand velocity over from a finger. Returns true while still moving.
 */
export function stepSpring(
  state: { value: number; velocity: number },
  target: number,
  dt: number,
  stiffness = 70,
  dampingRatio = 0.92,
): boolean {
  const damping = 2 * Math.sqrt(stiffness) * dampingRatio;
  const accel = -stiffness * (state.value - target) - damping * state.velocity;
  state.velocity += accel * dt;
  state.value += state.velocity * dt;
  const moving = Math.abs(state.velocity) > 0.002 || Math.abs(state.value - target) > 0.0015;
  if (!moving) {
    state.value = target;
    state.velocity = 0;
  }
  return moving;
}
