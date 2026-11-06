// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Session complete (native/src/app/session-done.tsx) reveals the finished
// session's tally stroke by stroke (native/src/components/Tally.tsx, drawIn).
// However many sets there were, the reveal stays quick: every stroke and
// diagonal starts within about 700 ms of the first. It plays one haptic as it
// completes, not a tick per group of five. With Reduce Motion it is drawn at
// once, with nothing to feel.

const Host = ({ children }: { children?: ReactNode }) => createElement('div', null, children);

/** When each stroke and diagonal was sent to draw in, in ms after the tally appeared. */
let delays: number[] = [];
let reduced = false;
const haptics = { land: vi.fn(), select: vi.fn(), success: vi.fn(), tap: vi.fn() };

type TallyProps = { marks: boolean[]; current: number | null; height?: number; drawIn?: boolean; accessibilityLabel: string };

const { Tally, DRAW_SPAN } = loadNativeModule<{ Tally: (props: TallyProps) => ReactNode; DRAW_SPAN: number }>(
  'components/Tally.tsx',
  {
    'react-native': { View: Host },
    'react-native-reanimated': {
      default: { View: Host },
      useAnimatedStyle: (style: () => Record<string, unknown>) => style(),
      useSharedValue: (value: number) => ({ value }),
      withDelay: (ms: number, animation: unknown) => {
        delays.push(ms);
        return animation;
      },
      withSpring: (to: number) => to,
    },
    '~/lib/accessibility': { ...silentAccessibility, useReduceMotion: () => reduced },
    '~/lib/haptics': { haptics },
    '~/theme/blanc': { useBlanc: () => ({ ink: 'ink', graphite: 'graphite', mark: 'mark', live: 'live' }) },
  },
  { compile: true },
);

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  delays = [];
  reduced = false;
  Object.values(haptics).forEach((haptic) => haptic.mockClear());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function reveal(logged: number, total = logged) {
  const marks = Array.from({ length: total }, (_, index) => index < logged);
  act(() => root.render(createElement(Tally, { marks, current: null, height: 22, drawIn: true, accessibilityLabel: 'sets' })));
  return { spread: Math.max(...delays) - Math.min(...delays), first: Math.min(...delays), last: Math.max(...delays) };
}

describe('a finished session\'s tally reveal', () => {
  it('keeps a short session\'s stroke-by-stroke pace', () => {
    // Nine sets: strokes 45 ms apart, the first group closed after its fifth.
    const { spread } = reveal(9);
    expect(delays).toHaveLength(9 + 1);
    expect(spread).toBe(8 * 45);
  });

  it('starts every stroke within about 700 ms however many sets there were', () => {
    expect(DRAW_SPAN).toBe(700);
    for (const sets of [20, 30, 45]) {
      delays = [];
      const { spread } = reveal(sets);
      // One stroke a set and one diagonal a closed group.
      expect(delays).toHaveLength(sets + sets / 5);
      expect(spread).toBeLessThanOrEqual(DRAW_SPAN + 1e-6);
      expect(spread).toBeGreaterThan(DRAW_SPAN - 50);
    }
  });

  it('plays one haptic as the last stroke lands, not a tick per group', () => {
    const { last } = reveal(30);
    act(() => vi.advanceTimersByTime(last));
    expect(haptics.land).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(haptics.land).toHaveBeenCalledTimes(1);
    expect(haptics.select).not.toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5000));
    expect(haptics.land).toHaveBeenCalledTimes(1);
  });

  it('still plays its one haptic for a session left short, after its last logged stroke', () => {
    reveal(7, 12);
    act(() => vi.advanceTimersByTime(2000));
    expect(haptics.land).toHaveBeenCalledTimes(1);
    expect(haptics.select).not.toHaveBeenCalled();
  });

  it('draws at once with Reduce Motion, with nothing to feel', () => {
    reduced = true;
    reveal(30);
    expect(delays).toEqual([]);
    act(() => vi.advanceTimersByTime(5000));
    expect(haptics.land).not.toHaveBeenCalled();
    expect(haptics.select).not.toHaveBeenCalled();
  });
});
