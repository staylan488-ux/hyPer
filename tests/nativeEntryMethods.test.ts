// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentType, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Log food's entry methods (Barcode, Manual, Photo, Describe): the one on
// screen is drawn as a chosen Chip is, lifted on the label colour, so a
// method is never shown as chosen by its font weight alone.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const palette = { label: '#FFFFFF', labelEdge: 'rgba(0, 0, 0, 0.06)', pressed: '#E7E6E1', fill: '#ECEBE6', ink: '#0B0B0B' };

type Style = Record<string, unknown>;
type Press = PropsWithChildren<{
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean; disabled?: boolean };
  onPress?: () => void;
  style: (state: { pressed: boolean }) => Style | Style[];
}>;
/** The pressables as last drawn, by their VoiceOver name. */
let drawn: Record<string, Press> = {};
let large = false;

const native = {
  'react-native': {
    Pressable: (props: Press) => {
      drawn[props.accessibilityLabel ?? ''] = props;
      return Wrap(props);
    },
    StyleSheet: { hairlineWidth: 0.5 },
    View: Wrap,
  },
  '~/lib/accessibility': { useLargeText: () => large },
  '~/theme/blanc': { useBlanc: () => palette },
};
type Method = 'scan' | 'manual' | 'photo' | 'describe';
type MethodsProps = { selected: Method | null; gemini: boolean; photoWaiting: boolean; disabled: boolean; onSelect: (method: Method) => void };
const { EntryMethods } = loadNativeModule<{ EntryMethods: ComponentType<MethodsProps> }>('fuel/EntryMethods.tsx', {
  ...native,
  'expo-symbols': { SymbolView: () => null },
  '~/components/BlancText': { BlancText: Wrap },
});
type ChipProps = { label: string; selected?: boolean; onPress: () => void; accessibilityLabel?: string };
const { Chip } = loadNativeModule<{ Chip: ComponentType<ChipProps> }>('components/Chip.tsx', {
  ...native,
  '~/lib/haptics': { haptics: { select: () => {} } },
  './BlancText': { BlancText: Wrap },
});

/** A pressable's own style at rest (a Chip's comes first in an array with its caller's). */
const rest = (props: Press): Style => {
  const style = props.style({ pressed: false });
  return Array.isArray(style) ? style[0] : style;
};
/** The parts that draw a choice as chosen. */
const LIFT = ['backgroundColor', 'borderWidth', 'borderColor', 'shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset'];
const lift = (style: Style) => Object.fromEntries(LIFT.map((key) => [key, style[key]]));
const names = { scan: 'Scan a barcode', manual: 'Enter manually', photo: 'Photo of a meal', describe: 'Describe a meal in words' } as const;

let root: Root;
beforeEach(() => {
  drawn = {};
  large = false;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

const draw = (selected: Method | null, onSelect: (method: Method) => void = () => {}) =>
  act(async () => { root.render(createElement(EntryMethods, { selected, gemini: true, photoWaiting: false, disabled: false, onSelect })); });

describe('Log food entry methods: the chosen one is drawn as chosen', () => {
  it.each(Object.keys(names) as Method[])('lifts %s as a chosen Chip is, and leaves the others quiet', async (method) => {
    // drawn beside a chosen Chip, to compare with
    await act(async () => {
      root.render(createElement(Fragment, null,
        createElement(EntryMethods, { selected: method, gemini: true, photoWaiting: false, disabled: false, onSelect: () => {} }),
        createElement(Chip, { label: 'Chosen', accessibilityLabel: 'chip', selected: true, onPress: () => {} })));
    });
    const chosen = drawn[names[method]];
    expect(chosen.accessibilityState).toMatchObject({ selected: true });
    // the label colour, its hairline edge and the soft shadow: a chosen Chip's look exactly
    expect(lift(rest(chosen))).toEqual(lift(rest(drawn.chip)));
    expect(rest(chosen)).toMatchObject({ backgroundColor: palette.label, borderColor: palette.labelEdge, shadowOpacity: 0.08 });
    for (const other of (Object.keys(names) as Method[]).filter((name) => name !== method)) {
      const quiet = rest(drawn[names[other]]);
      expect(drawn[names[other]].accessibilityState).toMatchObject({ selected: false });
      expect(quiet).toMatchObject({ backgroundColor: 'transparent', borderColor: 'transparent' });
      expect(quiet.shadowOpacity).toBeUndefined();
    }
  });

  it('shows none as chosen while a list is on screen', async () => {
    await draw(null);
    for (const name of Object.values(names)) {
      expect(drawn[name].accessibilityState).toMatchObject({ selected: false });
      expect(rest(drawn[name]).shadowOpacity).toBeUndefined();
    }
  });

  it('keeps the four columns, and the rows at the accessibility sizes', async () => {
    await draw('manual');
    for (const name of Object.values(names)) expect(rest(drawn[name])).toMatchObject({ flex: 1, minHeight: 56, flexDirection: 'column', borderRadius: 14 });
    large = true;
    await draw('manual');
    for (const name of Object.values(names)) {
      const style = rest(drawn[name]);
      expect(style).toMatchObject({ minHeight: 44, flexDirection: 'row', borderRadius: 22 });
      expect(style.flex).toBeUndefined();
    }
    expect(rest(drawn[names.manual])).toMatchObject({ backgroundColor: palette.label, shadowOpacity: 0.08 });
  });

  it('still takes a press on the open method', async () => {
    const onSelect = vi.fn();
    await draw('describe', onSelect);
    await act(async () => { drawn[names.describe].onPress!(); });
    expect(onSelect).toHaveBeenCalledWith('describe');
  });
});
