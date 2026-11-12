// @vitest-environment happy-dom
import { act, createElement, useEffect, useRef, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Suggest targets (native/src/app/targets-coach.tsx): a failed request shows
// its error in an alert note, which VoiceOver hears once.

const announce = vi.fn();
// As lib/accessibility's: announces a message when it appears or changes.
function useAnnounce(message: string | null | undefined | false) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const now = message || null;
    if (now && now !== last.current) announce(now);
    last.current = now;
  }, [message]);
}
// As components/Form's: an alert note announces its text.
const FormNote = ({ children, alert }: PropsWithChildren<{ alert?: boolean }>) => {
  useAnnounce(alert ? String(children) : null);
  return createElement('p', { role: alert ? 'alert' : undefined }, children);
};
const Box = ({ children }: PropsWithChildren) => createElement('div', null, children);
const Capsule = ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
  createElement('button', { onClick: onPress, disabled }, title);
const getSession = vi.fn();

const { default: TargetsCoachSheet } = loadNativeModule<{ default: () => ReturnType<typeof createElement> }>('app/targets-coach.tsx', {
  'expo-router': { router: { back: () => {}, replace: () => {} } },
  'react-native': { Keyboard: { dismiss: () => {} }, ScrollView: Box, TextInput: () => null, View: Box },
  '@/lib/healthWeights': { getBodyWeightHistorySince: async () => [] },
  '@/lib/nutritionCoach': { buildCoachContext: () => ({}), coachSource: () => 'gemini', coachTrendKgPerWeek: () => null, requestTargetSuggestion: vi.fn() },
  '@/lib/photoAnalysis': { COACH_GOALS_KEY: 'coach-goals' },
  '@/lib/supabase': { supabase: { auth: { getSession } } },
  '@/lib/weightTrend': { buildWeightTrend: () => null },
  '@/stores/appStore': { useAppStore: create(() => ({ nutritionProfile: { goal: 'maintain' }, macroTarget: null })) },
  '~/components/BlancText': { BlancText: Box },
  '~/components/Capsule': { Capsule },
  '~/components/Form': { FieldArea: Box, FormNote, ToggleRow: () => null },
  '~/components/GlassButton': { GlassButton: () => null },
  '~/components/Label': { Label: Box },
  '~/components/Row': { Row: () => null },
  '~/lib/accessibility': { ...silentAccessibility, announce, useAnnounce },
  // Allowed before: the request goes straight out.
  '~/lib/aiConsent': { askAiConsent: async () => true },
  '~/lib/haptics': { haptics: { error: () => {}, success: () => {} } },
  '~/lib/leaveGuard': { useLeaveGuard: () => {} },
  '~/platform/previewFlag': { isPreviewActive: () => false },
  '~/lib/you': { stageTargets: () => {}, useWeightStore: create(() => ({ history: [] })) },
  '~/theme/blanc': { space: { gutter: 16 }, type: { fieldLines: {} }, useBlanc: () => ({ ink: '#000', upcoming: '#777', ground: '#fff' }) },
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  announce.mockClear();
  // Own storage, as the other suites do: from Node 25, Node's built-in
  // localStorage (undefined without --localstorage-file) hides happy-dom's.
  const data = new Map<string, string>([['coach-goals', 'Keep my weight while getting stronger']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('Suggest targets after a failed request', () => {
  it('shows the error and announces it to VoiceOver once', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await act(async () => {
      root.render(createElement(TargetsCoachSheet));
    });
    await act(async () => host.querySelector('button')!.click());

    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Your session expired. Sign out and back in.');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Your session expired. Sign out and back in.');
  });
});
