// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as restTimer from '@/lib/restTimer';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';
import * as format from '../native/src/lib/format';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The rest sheet (native/src/app/rest.tsx) has one way to change the length:
// the track of lengths, ending in Custom, which opens the prompt to type one
// and reads as chosen while the length is none of the presets. The big time
// above only reads; nothing under it says "Change length". At rest it is
// drawn in proportional digits (no gap after a "1"), counting in tabular
// ones. Each length's touch target is 44 pt tall, though the track draws 38.

type Props = Record<string, unknown> & { children?: ReactNode };

const flatten = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? (style as Record<string, unknown>) : {};

// Native views as divs that keep what VoiceOver gets, and their layout.
const View = ({ children, accessible, accessibilityRole, accessibilityLabel, style }: Props) =>
  createElement(
    'div',
    { 'data-accessible': accessible ? 'true' : undefined, 'data-role': accessibilityRole, 'aria-label': accessibilityLabel, 'data-style': JSON.stringify(flatten(style)) },
    children,
  );
const Text = ({ children }: Props) => createElement('span', null, children);
/** The big time, with the style it is drawn in. */
const RollingText = ({ children, style }: Props) => createElement('span', { 'data-figure': 'true', 'data-style': JSON.stringify(flatten(style)) }, children);
const styleOf = (element: Element | null | undefined) => JSON.parse(element?.getAttribute('data-style') ?? '{}') as Record<string, number | string | unknown[]>;

// The real Chip, for its drawn height and reach: its Pressable keeps both.
const Pressable = ({ children, hitSlop, style, onPress }: Props) =>
  createElement(
    'button',
    { 'data-real-chip': 'true', 'data-slop': JSON.stringify(hitSlop ?? {}), 'data-style': JSON.stringify(flatten(typeof style === 'function' ? style({ pressed: false }) : style)), onClick: onPress },
    children,
  );
const { Chip: RealChip } = loadNativeModule<{ Chip: (props: Props) => ReactNode }>('components/Chip.tsx', {
  'react-native': { Pressable, StyleSheet: { hairlineWidth: 0.5 } },
  '~/lib/accessibility': silentAccessibility,
  '~/lib/haptics': { haptics: { select: vi.fn() } },
  '~/theme/blanc': { useBlanc: () => ({}) },
  './BlancText': { BlancText: Text },
});
const Chip = ({ label, selected, onPress, accessibilityLabel, accessibilityHint }: Props) =>
  createElement(
    'button',
    {
      'data-chip': 'true',
      'data-selected': selected ? 'true' : 'false',
      'aria-label': accessibilityLabel,
      'data-hint': accessibilityHint,
      onClick: onPress,
    },
    label as string,
  );
const Capsule = ({ title, onPress }: Props) => createElement('button', { onClick: onPress }, title as string);

const prompt = vi.fn();
const setRestLength = vi.fn();
let length = 90;
/** The rest under way, if any, and the seconds it has left. */
let rest: { status: 'running' | 'paused'; exerciseId: string | null } | null = null;
let left: number | null = null;
// A tabular "1" leads by more than a proportional one; the stand-in tells them apart.
const figureLead = vi.fn((_text: string, _size: number, opts?: { tabular?: boolean }) => (opts?.tabular === false ? -3 : -10));

let root: Root;
let host: HTMLDivElement;

async function open({ realChip = false } = {}) {
  const { default: RestSheet } = loadNativeModule<{ default: () => ReactNode }>(
    'app/rest.tsx',
    {
      'expo-router': { router: { back: vi.fn() } },
      'react-native': { Alert: { prompt, alert: vi.fn() }, ScrollView: View, View },
      '@/lib/restTimer': restTimer,
      '~/components/BlancText': { BlancText: Text },
      '~/components/Capsule': { Capsule },
      '~/components/Chip': { Chip: realChip ? RealChip : Chip },
      '~/components/GlassButton': { GlassButton: () => null },
      '~/components/RollingText': { RollingText },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/format': format,
      '~/lib/haptics': { haptics: { error: vi.fn(), select: vi.fn(), tap: vi.fn() } },
      '~/lib/rest': {
        extendRest: vi.fn(),
        pauseRest: vi.fn(),
        restLeft: () => left,
        restSecondsFor: () => length,
        resumeRest: vi.fn(),
        setRestLength,
        startRest: vi.fn(),
        stopRest: vi.fn(),
        useRestStore: create(() => ({ session: rest, prefs: {}, chosen: null })),
      },
      '~/lib/session': { useNow: () => 0, useSessionModel: () => null },
      '~/theme/blanc': { figureLead, restingFigure: { fontVariant: [] }, space: { inset: 16 }, useBlanc: () => ({}) },
    },
    { compile: true },
  );
  await act(async () => {
    root.render(createElement(RestSheet));
  });
}

const chips = () => [...host.querySelectorAll<HTMLButtonElement>('[data-chip]')];
const chosen = () => chips().filter((chip) => chip.dataset.selected === 'true').map((chip) => chip.textContent);

beforeEach(() => {
  prompt.mockReset();
  setRestLength.mockReset();
  length = 90;
  rest = null;
  left = null;
  figureLead.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the rest sheet\'s length', () => {
  it('offers the presets on one track, the 90 s default among them, and Custom last', async () => {
    await open();
    expect(chips().map((chip) => chip.textContent)).toEqual(['1:00', '1:30', '2:00', '3:00', '5:00', 'Custom']);
    expect(chosen()).toEqual(['1:30']);
  });

  it('reads the big time without making it a button, and drops "Change length"', async () => {
    await open();
    expect(host.textContent).not.toContain('Change length');
    const time = host.querySelector<HTMLElement>('[data-role="text"]');
    expect(time?.getAttribute('aria-label')).toBe('Rest length, 1 minute 30 seconds');
    expect(time?.dataset.accessible).toBe('true');
    // The only buttons are the track's lengths and Start rest.
    const buttons = [...host.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toEqual(['1:00', '1:30', '2:00', '3:00', '5:00', 'Custom', 'Start rest']);
  });

  it('opens the custom-length prompt from Custom, and sets what is typed', async () => {
    await open();
    const custom = chips().find((chip) => chip.textContent === 'Custom')!;
    expect(custom.dataset.hint).toBe('Type a rest length');
    await act(async () => custom.click());
    expect(prompt).toHaveBeenCalledTimes(1);
    const [title, , buttons, , defaultValue] = prompt.mock.calls[0] as [string, string, { text: string; onPress?: (value?: string) => void }[], string, string];
    expect(title).toBe('Rest length');
    expect(defaultValue).toBe('1:30');
    buttons.find((button) => button.text === 'Set')!.onPress!('2:15');
    expect(setRestLength).toHaveBeenCalledWith(null, 135);
  });

  it('shows Custom as chosen while the length is none of the presets, and names it', async () => {
    length = 135;
    await open();
    expect(chosen()).toEqual(['Custom']);
    expect(chips().find((chip) => chip.textContent === 'Custom')!.getAttribute('aria-label')).toBe('Custom, 2 minutes 15 seconds');
    // The custom length takes no chip of its own among the presets.
    expect(chips().map((chip) => chip.textContent)).not.toContain('2:15');
  });

  it('chooses a preset from its chip', async () => {
    await open();
    await act(async () => chips().find((chip) => chip.textContent === '3:00')!.click());
    expect(setRestLength).toHaveBeenCalledWith(null, 180);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('the rest sheet\'s big time', () => {
  const time = () => host.querySelector<HTMLElement>('[data-figure]')!;

  it('rests in proportional digits while no rest is under way, so "1:30" leaves no gap after its "1"', async () => {
    await open();
    expect(time().textContent).toBe('1:30');
    expect(styleOf(time()).fontVariant).toEqual([]);
    expect(figureLead).toHaveBeenLastCalledWith('1:30', 84, { tabular: false });
    expect(styleOf(time()).marginLeft).toBe(-3);
  });

  it('counts down in the figure\'s tabular digits, so they don\'t jitter, and keeps them while paused', async () => {
    for (const status of ['running', 'paused'] as const) {
      rest = { status, exerciseId: null };
      left = 75;
      await open();
      expect(time().textContent).toBe('1:15');
      // No override: the figure role's tabular digits draw it.
      expect(styleOf(time())).not.toHaveProperty('fontVariant');
      expect(figureLead).toHaveBeenLastCalledWith('1:15', 84, { tabular: true });
      expect(styleOf(time()).marginLeft).toBe(-10);
    }
  });
});

describe('the rest sheet\'s length track', () => {
  it('gives every length a 44 pt target and still draws the 38 pt fill where it was', async () => {
    await open({ realChip: true });
    const chips = [...host.querySelectorAll<HTMLElement>('[data-real-chip]')];
    expect(chips.map((chip) => chip.textContent)).toEqual(['1:00', '1:30', '2:00', '3:00', '5:00', 'Custom']);
    const track = chips[0].parentElement!;
    const box = styleOf(track) as Record<string, number>;
    // A chip's reach ends at its track's edge (a hitSlop can't pass its parent's bounds).
    for (const chip of chips) {
      expect(chip.parentElement).toBe(track);
      const drawn = styleOf(chip).height as number;
      const slop = JSON.parse(chip.dataset.slop ?? '{}') as { top?: number; bottom?: number };
      const reach = Math.min(slop.top ?? 0, box.paddingVertical) + drawn + Math.min(slop.bottom ?? 0, box.paddingVertical);
      expect(drawn).toBe(34);
      expect(reach).toBeGreaterThanOrEqual(44);
    }
    // The fill: 2 pt around the chips, a 38 pt pill whose top sits 22 pt under the time and whose foot is the track's.
    const fill = styleOf(track.firstElementChild) as Record<string, number | string>;
    expect(fill).toMatchObject({ position: 'absolute', left: 0, right: 0, borderRadius: 19 });
    expect(34 + 2 * box.paddingVertical - (fill.top as number) - (fill.bottom as number)).toBe(38);
    expect(box.marginTop + (fill.top as number)).toBe(22);
    expect(box.marginBottom + (fill.bottom as number)).toBe(0);
    expect(box).not.toHaveProperty('backgroundColor');
  });
});
