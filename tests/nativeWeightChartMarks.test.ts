// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as dates from 'date-fns';
import { act, createElement, Fragment, useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as chartGeometry from '@/lib/chartGeometry';
import * as weightDisplayCore from '@/lib/weightDisplayCore';
import * as weightHistory from '@/lib/weightHistory';
import type { WeightTrendPoint } from '@/lib/weightTrend';
import * as weightChartScale from '../native/src/lib/weightChartScale';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Body weight's chart (native/src/components/WeightChart.tsx): the weigh-in
// dots, a mis-read's ring and their key swatches are `mark` at full strength
// in every appearance (3:1 or more on the card), under the ink trend line.

/** A Blanc palette's solid colours, read from the theme's text (it imports React Native). */
function palette(name: string): Record<string, string> {
  const theme = readFileSync(path.join(__dirname, '../native/src/theme/blanc.ts'), 'utf8');
  const body = theme.match(new RegExp(`\\n {2}${name}: \\{([\\s\\S]*?)\\n {2}\\}`))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(\w+): '(#[0-9A-F]{6})'/g)].map((match) => [match[1], match[2]]));
}
/** WCAG contrast between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

type Style = { backgroundColor?: string; borderColor?: string; opacity?: number };
// A view that has a layout reports one, so the chart draws at a width.
const View = ({ children, style, onLayout }: PropsWithChildren<{ style?: Style; onLayout?: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void }>) => {
  useEffect(() => {
    onLayout?.({ nativeEvent: { layout: { width: 320, height: 160 } } });
  }, [onLayout]);
  return createElement(
    'div',
    { 'data-bg': style?.backgroundColor, 'data-border': style?.borderColor, 'data-opacity': style?.opacity === undefined ? undefined : String(style.opacity) },
    children,
  );
};
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Circle = ({ fill, stroke, opacity }: { fill?: string; stroke?: string; opacity?: number }) =>
  createElement('i', { 'data-fill': fill, 'data-stroke': stroke, 'data-opacity': opacity === undefined ? undefined : String(opacity) });
const Text = ({ children }: PropsWithChildren) => createElement('span', null, children);
const gesture = () => {
  const chain: Record<string, () => typeof chain> = {};
  for (const name of ['activateAfterLongPress', 'runOnJS', 'onStart', 'onUpdate', 'onEnd']) chain[name] = () => chain;
  return chain;
};

const LOOKS = [
  { name: 'light', dark: false, contrast: false },
  { name: 'dark', dark: true, contrast: false },
  { name: 'lightContrast', dark: false, contrast: true },
  { name: 'darkContrast', dark: true, contrast: true },
] as const;

// Ten days of weigh-ins about 80 kg, one of them a mis-read.
const points: WeightTrendPoint[] = Array.from({ length: 10 }, (_, index) => ({
  date: dates.format(dates.addDays(new Date(2026, 9, 20), index), 'yyyy-MM-dd'),
  dayIndex: index,
  ewmaKg: 80 + index * 0.05,
  observedKg: index === 4 ? 86 : 80 + ((index % 3) - 1) * 0.3,
  isOutlier: index === 4,
}));

let root: Root;
let host: HTMLDivElement;

async function draw(look: (typeof LOOKS)[number]) {
  const { WeightChart } = loadNativeModule<{ WeightChart: (props: Record<string, unknown>) => ReactNode }>('components/WeightChart.tsx', {
    'date-fns': dates,
    'react-native': { View, useWindowDimensions: () => ({ fontScale: 1 }) },
    'react-native-gesture-handler': { Gesture: { Exclusive: () => ({}), Pan: gesture, Tap: gesture }, GestureDetector: Wrap },
    'react-native-svg': { default: Wrap, Circle, Line: () => null, Path: () => null },
    '@/lib/chartGeometry': chartGeometry,
    '@/lib/weightDisplayCore': weightDisplayCore,
    '@/lib/weightHistory': weightHistory,
    '~/lib/accessibility': { ...silentAccessibility, useIncreaseContrast: () => look.contrast },
    '~/lib/haptics': { haptics: { select: () => {} } },
    '~/lib/weightChartScale': weightChartScale,
    '~/theme/blanc': { useBlanc: () => palette(look.name) },
    './BlancText': { BlancText: Text },
  });
  await act(async () => { root.render(createElement(WeightChart, { points, unit: 'kg', height: 160, summary: 'Down 0.4 kg' })); });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Body weight's marks", () => {
  for (const look of LOOKS) {
    it(`draws the weigh-ins and the mis-read's ring in mark at full strength, 3:1 or more on the card (${look.name})`, async () => {
      const c = palette(look.name);
      expect(contrast(c.mark, c.label)).toBeGreaterThanOrEqual(3);
      await draw(look);
      const dots = [...host.querySelectorAll<HTMLElement>('i')];
      const filled = dots.filter((dot) => dot.dataset.fill !== 'none');
      const rings = dots.filter((dot) => dot.dataset.fill === 'none');
      expect(filled.length).toBe(9);
      expect(rings.length).toBe(1);
      expect(filled.every((dot) => dot.dataset.fill === c.mark)).toBe(true);
      expect(rings[0].dataset.stroke).toBe(c.mark);
      expect(dots.every((dot) => dot.dataset.opacity === undefined)).toBe(true);
      // The key draws them the same.
      const swatch = (label: string) => [...host.querySelectorAll('span')].find((span) => span.textContent === label)?.previousElementSibling as HTMLElement | null;
      expect(swatch('Weigh-ins')?.dataset.bg).toBe(c.mark);
      expect(swatch('Mis-read')?.dataset.border).toBe(c.mark);
      expect(swatch('Weigh-ins')?.dataset.opacity).toBeUndefined();
      expect(swatch('Mis-read')?.dataset.opacity).toBeUndefined();
      expect(swatch('Trend')?.dataset.bg).toBe(c.ink);
    });
  }
});
