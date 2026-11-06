// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A list row's quiet line given in parts (native/src/components/Row.tsx): on
// one line only the first part (Fuel's serving amount) is cut short, so the
// rest, a time and "Estimate", always shows whole. VoiceOver hears the line
// whole, and at the large text sizes it wraps as one line of words.

type Props = Record<string, unknown> & { children?: ReactNode; style?: unknown };
type RowProps = { title: string; detail?: string | readonly string[]; detailMark?: ReactNode; value?: string; onPress?: () => void };

const styleOf = (style: unknown) => JSON.stringify(Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : (style ?? {}));
const View = ({ children, style }: Props) => createElement('div', { 'data-style': styleOf(style) }, children);
const Text = ({ children, style, numberOfLines }: Props) =>
  createElement('span', { 'data-style': styleOf(style), 'data-lines': numberOfLines === undefined ? 'any' : String(numberOfLines) }, children);
const Press = ({ children, accessibilityLabel }: Props) => createElement('div', { 'aria-label': accessibilityLabel as string }, children);

let large = false;
const { Row } = loadNativeModule<{ Row: (props: RowProps) => ReactNode }>(
  'components/Row.tsx',
  {
    'expo-symbols': { SymbolView: () => null },
    'react-native': { Pressable: Press, StyleSheet: { hairlineWidth: 0.33 }, View },
    '~/lib/accessibility': { speak: silentAccessibility.speak, useLargeText: () => large },
    '~/lib/haptics': { haptics: { tap: () => {}, select: () => {} } },
    '~/theme/blanc': { useBlanc: () => ({}) },
    './BlancText': { BlancText: Text },
    './HoldMenu': { HoldMenu: View, hasHoldMenu: false, menuAccessibility: () => null, showActionSheet: () => {} },
    './SwipeRow': { closeOpenSwipeRow: () => false, useSwipeActions: () => null },
  },
  { compile: true },
);

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  large = false;
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

async function draw(props: RowProps) {
  await act(async () => { root.render(createElement(Row, props)); });
  const texts = [...host.querySelectorAll('span')].map((span) => ({
    text: span.textContent,
    lines: span.getAttribute('data-lines'),
    style: JSON.parse(span.getAttribute('data-style')!) as { flexShrink?: number; maxWidth?: string },
  }));
  return { texts, label: host.querySelector('[aria-label]')?.getAttribute('aria-label') };
}

const parts = ['60 g', '8 g protein', '7:30 AM', 'Estimate'] as const;
const yogurt = { title: 'Greek yogurt', detail: parts, value: '120', onPress: () => {} };

describe('A row detail in parts', () => {
  it('cuts only the first part short on one line; the protein, time and Estimate stay whole beside it', async () => {
    const { texts } = await draw(yogurt);
    const amount = texts.find((text) => text.text === '60 g')!;
    const rest = texts.find((text) => text.text === ' · 8 g protein · 7:30 AM · Estimate')!;
    expect(amount).toMatchObject({ lines: '1', style: { flexShrink: 1 } });
    // Never shrunk beside the amount; only a rest wider than the whole line is cut, at its end.
    expect(rest).toMatchObject({ lines: '1', style: { flexShrink: 0, maxWidth: '100%' } });
    // The amount comes first, so the ellipsis lands on it.
    expect(texts.indexOf(amount)).toBeLessThan(texts.indexOf(rest));
  });

  it('reads the whole line to VoiceOver', async () => {
    const { label } = await draw(yogurt);
    expect(label).toBe(silentAccessibility.speak('Greek yogurt, 60 g · 8 g protein · 7:30 AM · Estimate, 120'));
  });

  it('wraps as one line of words at the large text sizes, as before', async () => {
    large = true;
    const { texts } = await draw(yogurt);
    expect(texts.find((text) => text.text === '60 g · 8 g protein · 7:30 AM · Estimate')).toMatchObject({ lines: 'any' });
    expect(texts.some((text) => text.text === '60 g')).toBe(false);
  });

  it('keeps the parts beside a detail mark', async () => {
    const { texts } = await draw({ ...yogurt, detailMark: createElement('b', null, '•') });
    expect(texts.find((text) => text.text === '60 g')).toMatchObject({ style: { flexShrink: 1 } });
    expect(texts.find((text) => text.text === ' · 8 g protein · 7:30 AM · Estimate')).toMatchObject({ style: { flexShrink: 0 } });
  });

  it('leaves a detail given as words as it was: one line, cut at its end', async () => {
    const { texts } = await draw({ ...yogurt, detail: '60 g · 7:30 AM' });
    expect(texts.find((text) => text.text === '60 g · 7:30 AM')).toMatchObject({ lines: '1' });
  });
});
