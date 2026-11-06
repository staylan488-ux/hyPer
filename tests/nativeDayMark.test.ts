// @vitest-environment happy-dom
import { act, createElement, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as fuelSummary from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The mark under each date on Fuel's week strip and the month sheet
// (native/src/fuel/DayMark.tsx): a 28 × 4 pt bar filled in ink toward the
// day's calorie target, the rest in `mark` so 88% and a met target read
// differently; red past the target only where the goal warns about it.

type Palette = Record<string, string>;
type Mark = { logged: boolean; kcal?: number | null; target?: number | null; goal?: NutritionGoal | null };
type Style = { width?: number | string; height?: number; backgroundColor?: string; borderRadius?: number };

// The app's own palettes, from the theme module.
const { palettes } = loadNativeModule<{ palettes: Record<'light' | 'dark' | 'lightContrast' | 'darkContrast', Palette> }>('theme/blanc.ts', {
  'react-native': { DynamicColorIOS: (colours: unknown) => colours, Platform: { OS: 'ios' }, useColorScheme: () => 'light' },
  '~/lib/accessibility': { useIncreaseContrast: () => false },
});

let colours: Palette = palettes.light;
const View = ({ style, children }: PropsWithChildren<{ style?: Style }>) =>
  createElement('div', { 'data-style': JSON.stringify(style ?? {}) }, children);
const { DayMark, DAY_MARK } = loadNativeModule<{ DayMark: (props: Mark) => ReturnType<typeof createElement>; DAY_MARK: { width: number; height: number } }>(
  'fuel/DayMark.tsx',
  {
    'react-native': { View },
    '@/lib/fuelSummary': fuelSummary,
    '~/theme/blanc': { useBlanc: () => colours },
  },
);

let root: Root;
let host: HTMLDivElement;

/** Each drawn view's style, outermost first. */
async function draw(props: Mark): Promise<Style[]> {
  await act(async () => { root.render(createElement(DayMark, props)); });
  return [...host.querySelectorAll('[data-style]')].map((node) => JSON.parse(node.getAttribute('data-style')!) as Style);
}

beforeEach(() => {
  colours = palettes.light;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Fuel’s day mark', () => {
  it('is 28 × 4 pt: room for seven across in the 44–46 pt day cells, which never grow with the text', () => {
    expect(DAY_MARK).toEqual({ width: 28, height: 4 });
    // The month sheet's 44 pt cell is the narrower of the two.
    expect(DAY_MARK.width).toBeLessThanOrEqual(44);
  });

  it('fills in ink toward the target over a `mark` remainder, so 88% and a met target differ', async () => {
    const [, bar, fill] = await draw({ logged: true, kcal: 1760, target: 2000, goal: 'maintain' });
    expect(bar).toMatchObject({ width: 28, height: 4, backgroundColor: colours.mark });
    expect(fill).toMatchObject({ width: '88%', backgroundColor: colours.ink });

    const [, metBar, met] = await draw({ logged: true, kcal: 2000, target: 2000, goal: 'maintain' });
    expect(metBar.backgroundColor).toBe(colours.mark);
    expect(met).toMatchObject({ width: '100%', backgroundColor: colours.ink });
  });

  it('turns all red past the target where the goal warns, and stays full in ink while gaining', async () => {
    const over = await draw({ logged: true, kcal: 2400, target: 2000, goal: 'cut' });
    expect(over).toHaveLength(2);
    expect(over[1]).toMatchObject({ width: 28, height: 4, backgroundColor: colours.live });

    const gaining = await draw({ logged: true, kcal: 2400, target: 2000, goal: 'bulk' });
    expect(gaining[2]).toMatchObject({ width: '100%', backgroundColor: colours.ink });
  });

  it('draws a dot with nothing to measure against, and nothing on a day without food', async () => {
    const [, dot] = await draw({ logged: true, kcal: 900, target: null });
    expect(dot).toMatchObject({ width: 4, height: 4, backgroundColor: colours.graphite });
    expect(await draw({ logged: false, kcal: 1760, target: 2000 })).toHaveLength(1);
  });

  it('reads on the ground in every palette: the remainder at 3:1, the fill against it, and red', async () => {
    for (const [name, palette] of Object.entries(palettes)) {
      colours = palette;
      const [, bar, fill] = await draw({ logged: true, kcal: 1000, target: 2000 });
      expect(contrast(bar.backgroundColor!, palette.ground), `${name} remainder on ground`).toBeGreaterThanOrEqual(3);
      expect(contrast(fill.backgroundColor!, bar.backgroundColor!), `${name} fill against remainder`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.live, palette.ground), `${name} over on ground`).toBeGreaterThanOrEqual(3);
    }
  });
});

/** WCAG contrast between two #RRGGBB colours. */
function contrast(foreground: string, background: string): number {
  const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const [high, low] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}
