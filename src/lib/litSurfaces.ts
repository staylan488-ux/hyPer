import { subscribeMotionLight, type MotionLight } from '@/lib/motionLight';
import { onMotionPolicyChange, readMotionPolicy } from '@/lib/motionPolicy';

/**
 * The surfaces that catch the motion light: floating glass, sheets, and the
 * web tab bar and toast. Values are written only on these elements (never the
 * root), and the light runs only while at least one is mounted, so with
 * nothing lit on screen the sensors, bridge events and frame loop rest. A
 * .material-glass nested in a sheet inherits the sheet's values.
 */
const surfaces = new Set<HTMLElement>();
let latest: MotionLight | null = null;
let stopLight: (() => void) | null = null;
let stopPolicyWatch: (() => void) | null = null;
let allowed = false;

function lightAllowed() {
  const policy = readMotionPolicy();
  return !policy.reducedMotion && !policy.reducedTransparency;
}

function paint(element: HTMLElement, { x, y }: MotionLight) {
  element.style.setProperty('--light-x', x.toFixed(3));
  element.style.setProperty('--light-y', y.toFixed(3));
}

function showLight(element: HTMLElement) {
  if (latest) element.style.setProperty('--light-on', '1');
  else element.style.removeProperty('--light-on');
}

function subscribe() {
  latest = null;
  // Calls back straight away with the current light, unless the policy says off.
  stopLight = subscribeMotionLight((light) => {
    latest = light;
    surfaces.forEach((element) => paint(element, light));
  });
}

// Reduce Motion or Reduce Transparency changed mid-session: resubscribe, which
// stops the sensors and loop, or brings them back.
function onPolicyChange() {
  const next = lightAllowed();
  if (next === allowed) return;
  allowed = next;
  stopLight?.();
  subscribe();
  surfaces.forEach(showLight);
}

/** Light an element until the returned release is called. */
export function registerLitSurface(element: HTMLElement): () => void {
  surfaces.add(element);
  if (!stopLight) {
    allowed = lightAllowed();
    subscribe();
    stopPolicyWatch = onMotionPolicyChange(onPolicyChange);
  } else if (latest) {
    paint(element, latest);
  }
  showLight(element);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    surfaces.delete(element);
    if (surfaces.size > 0) return;
    stopLight?.();
    stopLight = null;
    stopPolicyWatch?.();
    stopPolicyWatch = null;
    latest = null;
  };
}

/** Test seam. */
export function resetLitSurfaces() {
  surfaces.clear();
  stopLight?.();
  stopLight = null;
  stopPolicyWatch?.();
  stopPolicyWatch = null;
  latest = null;
}
