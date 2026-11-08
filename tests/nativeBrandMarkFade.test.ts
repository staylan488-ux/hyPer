// @vitest-environment happy-dom
import { act, createElement, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// BrandMark (native/src/components/BrandMark.tsx): Today's scroll fades its
// own corner P only. The sign-in and offline emblems, which the launch intro
// also lands on, never take Today's scroll position.

type Props = { size: number; anchor?: boolean; fadesWithScroll?: boolean };

const markShown = { value: 1 };
const markAtRest = { value: 1 };
const Box = ({ children }: PropsWithChildren) => createElement('div', null, children);
const Text = ({ children, style }: PropsWithChildren<{ style: unknown }>) => {
  const opacity = ([style].flat(3) as ({ opacity?: number } | false | undefined)[]).find((entry) => entry && entry.opacity !== undefined);
  return createElement('span', { 'data-opacity': opacity ? String(opacity.opacity) : '' }, children);
};

const { BrandMark } = loadNativeModule<{ BrandMark: (props: Props) => ReturnType<typeof createElement> }>('components/BrandMark.tsx', {
  'react-native': { View: Box },
  'react-native-reanimated': { default: { Text }, useAnimatedStyle: (worklet: () => object) => worklet() },
  '../../modules/hyper-view': { windowFrame: async () => null },
  '~/lib/brand': { markAtRest, markShown, registerMarkAnchor: () => () => {} },
  '~/lib/brandGeometry': { markBox: () => ({ width: 10, height: 10 }), markInkInsets: () => ({ top: 0, bottom: 0, left: 0 }), PAD: 0 },
  '~/theme/blanc': { useBlanc: () => ({ brand: '#c00' }) },
});

let root: Root;
let host: HTMLDivElement;
const opacity = () => host.querySelector('span')?.dataset.opacity;

async function show(props: Props) {
  await act(async () => {
    root.render(createElement(BrandMark, props));
  });
}

beforeEach(() => {
  markShown.value = 1;
  markAtRest.value = 1;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the brand mark after Today has scrolled', () => {
  it("keeps the sign-in and offline emblems shown when Today's P has stepped back", async () => {
    markAtRest.value = 0;
    await show({ size: 48, anchor: true });
    expect(opacity()).toBe('1');
  });

  it("fades Today's corner P with Today's scroll", async () => {
    markAtRest.value = 0.25;
    await show({ size: 30, anchor: true, fadesWithScroll: true });
    expect(opacity()).toBe('0.25');
  });

  it('still hides an anchored mark while the launch intro flies in', async () => {
    markShown.value = 0;
    await show({ size: 48, anchor: true });
    expect(opacity()).toBe('0');
  });
});
