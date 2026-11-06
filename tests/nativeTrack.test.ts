// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The shared progress line (native/src/components/Track.tsx) appears at its
// value: the first sight of a screen is not a fill nobody caused. Only a later
// change (a food logged or edited) slides, and with Reduce Motion on even that
// lands at once, since withTiming keeps following the system setting.

type Props = { children?: ReactNode; style?: unknown };
type Timing = { to: number; config: { duration?: number; reduceMotion?: unknown } };

const timings: Timing[] = [];
const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : ((style as Record<string, unknown>) ?? {});
const View = ({ children, style }: Props) => createElement('div', { 'data-style': JSON.stringify(flatten(style)) }, children);

const { Track } = loadNativeModule<{ Track: (props: { progress: number; warnOver?: boolean }) => ReactNode }>(
  'components/Track.tsx',
  {
    'react-native': { View },
    'react-native-reanimated': {
      default: { View },
      Easing: { out: () => 'ease-out', cubic: 'cubic' },
      // The shared value as a plain box; the fill's style is read on each draw.
      useSharedValue: (initial: number) => useState(() => ({ value: initial as number | Timing }))[0],
      useAnimatedStyle: (style: () => Record<string, unknown>) => style(),
      withTiming: (to: number, config: Timing['config']) => {
        const timing = { to, config };
        timings.push(timing);
        return to;
      },
    },
    '~/theme/blanc': { useBlanc: () => ({ track: 'track', ink: 'ink', live: 'live' }) },
  },
  { compile: true },
);

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  timings.length = 0;
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

const draw = async (progress: number) => {
  await act(async () => { root.render(createElement(Track, { progress })); });
};
const fillWidth = () => (JSON.parse(host.querySelectorAll('[data-style]')[1].getAttribute('data-style')!) as { width?: string }).width;

describe('Track', () => {
  it('appears at its value, with no fill from zero', async () => {
    await draw(0.6);
    expect(fillWidth()).toBe('60%');
    expect(timings).toHaveLength(0);
  });

  it('slides only on a later change, and not again for the same value', async () => {
    await draw(0.6);
    await draw(0.8);
    expect(timings).toEqual([{ to: 0.8, config: expect.objectContaining({ duration: 650 }) }]);
    await draw(0.8);
    expect(timings).toHaveLength(1);
  });

  it('keeps the system Reduce Motion setting for that slide', async () => {
    await draw(0.2);
    await draw(0.5);
    expect(timings[0].config.reduceMotion).toBeUndefined();
  });

  it('holds a value past the target at full, and starts there too', async () => {
    await draw(1.4);
    expect(fillWidth()).toBe('100%');
    expect(timings).toHaveLength(0);
  });
});
