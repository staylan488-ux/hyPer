// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as maquette from '@/lib/maquette';
import * as types from '@/types';
import type { MuscleGroup, MuscleVolume } from '@/types';
import * as anatomy from '../native/src/lib/anatomy';
import * as muscleTones from '../native/src/theme/muscleTones';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The muscle figure (native/src/components/MuscleFigure.tsx) points at what
// needs action: below range is outlined in ink, the strongest mark short of
// red; in range is filled in `mark`, the quietest tone that still reads; over
// is red. Its key matches, left-aligned with the card's title.

/** A Blanc palette's solid colours, read from the theme's text (it imports React Native). */
function palette(name: string): Record<string, string> {
  const theme = readFileSync(path.join(__dirname, '../native/src/theme/blanc.ts'), 'utf8');
  const body = theme.match(new RegExp(`\\n {2}${name}: \\{([\\s\\S]*?)\\n {2}\\}`))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(\w+): '(#[0-9A-F]{6})'/g)].map((match) => [match[1], match[2]]));
}
const css = (hex: string) => maquette.rgbToCss(maquette.parseColor(hex, [0, 0, 0]));

type Shape = { d?: string; fill?: string; stroke?: string; strokeWidth?: number; clipPath?: string };
const Shape = (tag: string) => ({ d, fill, stroke, strokeWidth, clipPath, children }: PropsWithChildren<Shape>) =>
  createElement(
    tag,
    { 'data-d': d, 'data-fill': fill, 'data-stroke': stroke, 'data-width': strokeWidth === undefined ? undefined : String(strokeWidth), 'data-clip': clipPath },
    children,
  );
type Style = { backgroundColor?: string; borderColor?: string; borderWidth?: number; justifyContent?: string; paddingHorizontal?: number; flexWrap?: string };
const View = ({ children, style }: PropsWithChildren<{ style?: Style }>) =>
  createElement(
    'div',
    {
      'data-bg': style?.backgroundColor,
      'data-border': style?.borderColor,
      'data-border-width': style?.borderWidth === undefined ? undefined : String(style.borderWidth),
      'data-justify': style?.justifyContent,
      'data-inset': style?.paddingHorizontal === undefined ? undefined : String(style.paddingHorizontal),
      'data-wrap': style?.flexWrap,
    },
    children,
  );
const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Text = ({ children }: PropsWithChildren) => createElement('span', null, children);

const PALETTES = [
  { name: 'light', dark: false, contrast: false },
  { name: 'dark', dark: true, contrast: false },
  { name: 'lightContrast', dark: false, contrast: true },
  { name: 'darkContrast', dark: true, contrast: true },
] as const;

const volume: MuscleVolume[] = [
  { muscle_group: 'chest', weekly_sets: 4, status: 'below_mev' },
  { muscle_group: 'quads', weekly_sets: 12, status: 'mev_mav' },
  { muscle_group: 'side_delts', weekly_sets: 25, status: 'above_mrv' },
] as MuscleVolume[];

let root: Root;
let host: HTMLDivElement;

async function draw(look: (typeof PALETTES)[number]) {
  const { MuscleFigure } = loadNativeModule<{ MuscleFigure: (props: { volume: MuscleVolume[]; selected: MuscleGroup | null; onPick: () => void }) => ReactNode }>(
    'components/MuscleFigure.tsx',
    {
      'react-native': { Pressable: Wrap, View, useColorScheme: () => (look.dark ? 'dark' : 'light') },
      'react-native-svg': { default: Wrap, ClipPath: Wrap, Defs: () => null, Ellipse: Shape('i'), G: Wrap, Path: Shape('b') },
      '@/lib/maquette': maquette,
      '@/types': types,
      '~/lib/anatomy': anatomy,
      '~/lib/accessibility': { ...silentAccessibility, useIncreaseContrast: () => look.contrast },
      '~/theme/blanc': { useBlanc: () => palette(look.name) },
      '~/theme/muscleTones': muscleTones,
      './BlancText': { BlancText: Text },
    },
  );
  await act(async () => { root.render(createElement(MuscleFigure, { volume, selected: null, onPick: () => {} })); });
}

/** The fills drawn for a muscle's pieces on the front view. */
const fillsOf = (muscle: MuscleGroup) => {
  const pieces = new Set(anatomy.REGIONS.front.filter((region) => region.muscle === muscle).map((region) => anatomy.pathOf(region.cubics, 0)));
  return [...host.querySelectorAll('b')].filter((el) => pieces.has(el.dataset.d ?? '') && el.dataset.fill !== 'none').map((el) => el.dataset.fill);
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('The muscle figure', () => {
  for (const look of PALETTES) {
    it(`outlines below range in ink, fills in range with mark, and over in red (${look.name})`, async () => {
      const c = palette(look.name);
      const tones = muscleTones.muscleTonesFor(look.dark, look.contrast);
      await draw(look);
      // Below range keeps its light fill, held by an ink outline about 1.5 pt wide as it shows.
      expect(fillsOf('chest').length).toBeGreaterThan(0);
      expect(fillsOf('chest').every((fill) => fill === css(tones.below))).toBe(true);
      const outline = host.querySelector<HTMLElement>('b[data-clip="url(#below-front-chest)"]');
      expect(outline?.dataset.stroke).toBe(css(c.ink));
      const scale = 136 / (anatomy.FIGURE.bottom - anatomy.FIGURE.top);
      const seam = look.dark ? 1.35 : 1;
      // Stroked at twice its width and clipped to the muscle; the seam takes half a seam of it.
      expect((Number(outline?.dataset.width) / 2 - seam / 2) * scale).toBeCloseTo(1.5, 5);
      // Only below range is outlined.
      expect(host.querySelectorAll('b[data-clip^="url(#below-"]').length).toBeGreaterThan(0);
      expect(host.querySelector('b[data-clip="url(#below-front-quads)"]')).toBeNull();
      expect(fillsOf('quads').length).toBeGreaterThan(0);
      expect(fillsOf('quads').every((fill) => fill === css(c.mark))).toBe(true);
      expect(fillsOf('side_delts').length).toBeGreaterThan(0);
      expect(fillsOf('side_delts').every((fill) => fill === css(c.live))).toBe(true);
    });
  }

  it("keys the same tones, left-aligned with the card's title", async () => {
    const c = palette('light');
    await draw(PALETTES[0]);
    const swatch = (label: string) => [...host.querySelectorAll('span')].find((span) => span.textContent === label)?.previousElementSibling as HTMLElement | null;
    expect(swatch('Below range')?.dataset.border).toBe(css(c.ink));
    expect(swatch('Below range')?.dataset.borderWidth).toBe('1.5');
    expect(swatch('In range')?.dataset.bg).toBe(css(c.mark));
    expect(swatch('Over')?.dataset.bg).toBe(css(c.live));
    // The key's row: not centred under the figures, and in from the edge as far as the caption above.
    const row = swatch('In range')?.parentElement?.parentElement as HTMLElement | null;
    expect(row?.dataset.wrap).toBe('wrap');
    expect(row?.dataset.justify).toBeUndefined();
    expect(row?.dataset.inset).toBe('6');
  });
});
