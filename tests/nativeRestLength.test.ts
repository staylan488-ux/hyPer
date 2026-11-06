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
// above only reads; nothing under it says "Change length".

type Props = Record<string, unknown> & { children?: ReactNode };

// Native views as divs that keep what VoiceOver gets.
const View = ({ children, accessible, accessibilityRole, accessibilityLabel }: Props) =>
  createElement('div', { 'data-accessible': accessible ? 'true' : undefined, 'data-role': accessibilityRole, 'aria-label': accessibilityLabel }, children);
const Text = ({ children }: Props) => createElement('span', null, children);
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

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: RestSheet } = loadNativeModule<{ default: () => ReactNode }>(
    'app/rest.tsx',
    {
      'expo-router': { router: { back: vi.fn() } },
      'react-native': { Alert: { prompt, alert: vi.fn() }, ScrollView: View, View },
      '@/lib/restTimer': restTimer,
      '~/components/BlancText': { BlancText: Text },
      '~/components/Capsule': { Capsule },
      '~/components/Chip': { Chip },
      '~/components/GlassButton': { GlassButton: () => null },
      '~/components/RollingText': { RollingText: Text },
      '~/lib/accessibility': silentAccessibility,
      '~/lib/format': format,
      '~/lib/haptics': { haptics: { error: vi.fn(), select: vi.fn(), tap: vi.fn() } },
      '~/lib/rest': {
        extendRest: vi.fn(),
        pauseRest: vi.fn(),
        restLeft: () => null,
        restSecondsFor: () => length,
        resumeRest: vi.fn(),
        setRestLength,
        startRest: vi.fn(),
        stopRest: vi.fn(),
        useRestStore: create(() => ({ session: null, prefs: {}, chosen: null })),
      },
      '~/lib/session': { useNow: () => 0, useSessionModel: () => null },
      '~/theme/blanc': { figureLead: () => 0, space: { inset: 16 }, useBlanc: () => ({}) },
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
