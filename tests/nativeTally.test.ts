// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The set tally (native/src/components/Tally.tsx) has one grammar wherever it
// appears: logged strokes in ink, the next set's stroke taller in the live
// red, the sets still to do in `mark`. A finished movement on Train recedes
// through its name only, never through its strokes.

type Style = Record<string, unknown>;
const flatten = (style: unknown): Style =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? (style as Style) : {};

// Native views drawn as divs carrying what the tally paints: colour, height, width.
const Host = ({ style, children }: { style?: unknown; children?: ReactNode }) => {
  const flat = flatten(style);
  return createElement(
    'div',
    {
      'data-color': flat.backgroundColor as string | undefined,
      'data-height': flat.height as number | undefined,
      'data-width': flat.width as number | undefined,
      'data-closing': flat.position === 'absolute' ? 'true' : undefined,
    },
    children,
  );
};

type TallyProps = { marks: boolean[]; current: number | null; height?: number; compact?: boolean; accessibilityLabel: string };

const { Tally, COMPACT_RISE } = loadNativeModule<{ Tally: (props: TallyProps) => ReactNode; COMPACT_RISE: number }>(
  'components/Tally.tsx',
  {
    'react-native': { View: Host },
    'react-native-reanimated': {
      default: { View: Host },
      // Drawn at rest: springs land where they are sent.
      useAnimatedStyle: (style: () => Style) => style(),
      useSharedValue: (value: number) => ({ value }),
      withDelay: (_ms: number, animation: unknown) => animation,
      withSpring: (to: number) => to,
    },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { select: () => undefined } },
    // Tokens by name, so a stroke says which one it is drawn in.
    '~/theme/blanc': { useBlanc: () => ({ ink: 'ink', graphite: 'graphite', mark: 'mark', live: 'live' }) },
  },
  { compile: true },
);

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(props: Omit<TallyProps, 'accessibilityLabel'>) {
  act(() => root.render(createElement(Tally, { ...props, accessibilityLabel: 'sets' })));
  const painted = [...host.querySelectorAll<HTMLElement>('[data-color]')];
  const strokes = painted.filter((element) => !element.dataset.closing);
  return {
    colours: strokes.map((stroke) => stroke.dataset.color),
    heights: strokes.map((stroke) => Number(stroke.dataset.height)),
    closings: painted.filter((element) => element.dataset.closing).map((closing) => closing.dataset.color),
  };
}

describe('the set tally', () => {
  it('draws a finished movement\'s strokes and diagonal in ink, as on every other tally', () => {
    // Train's finished row: every set logged, no next set.
    const finished = draw({ marks: [true, true, true, true, true, true], current: null, compact: true });
    expect(finished.colours).toEqual(['ink', 'ink', 'ink', 'ink', 'ink', 'ink']);
    expect(finished.closings[0]).toBe('ink');
    expect([...finished.colours, ...finished.closings]).not.toContain('graphite');
  });

  it('reads logged in ink, next in the live red and still to do in mark, at either size', () => {
    for (const compact of [true, false]) {
      const tally = draw({ marks: [true, true, false, false], current: 2, compact });
      expect(tally.colours).toEqual(['ink', 'ink', 'live', 'mark']);
    }
  });

  it('stands the next stroke clearly taller wherever a tally appears', () => {
    // Train's movement row (compact), Today's card (16), Train's header (20), the default (18).
    for (const size of [{ compact: true }, { height: 16 }, { height: 20 }, {}]) {
      const tally = draw({ marks: [true, false, false, false], current: 1, ...size });
      const [logged, next, ...toDo] = tally.heights;
      expect(toDo.every((height) => height === logged)).toBe(true);
      expect(next / logged).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('raises a compact tally\'s next stroke by the room Train\'s row centres it with', () => {
    const tally = draw({ marks: [false, false], current: 0, compact: true });
    expect(tally.heights).toEqual([12 + COMPACT_RISE, 12]);
    expect(COMPACT_RISE).toBe(6);
  });
});
