// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as programQuestions from '@/lib/programQuestions';
import * as programSummary from '@/lib/programSummary';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The new-program chooser (native/src/app/program-edit/index.tsx): an unsaved
// program can be resumed, or a guided plan started, but not both at once.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const stored = { draft: { name: 'Push Pull', days: [{ id: 'day-1' }, { id: 'day-2' }] }, savedAt: Date.now() - 60_000 };
const seeded = { draft: { name: 'Guided', days: [] }, notice: null };
let releaseSeed!: (value: typeof seeded) => void;
const seedGuidedDraft = vi.fn(() => new Promise<typeof seeded>((resolve) => { releaseSeed = resolve; }));
const startNew = vi.fn();
const restoreDraft = vi.fn();
const splitEdit = create(() => ({ draft: null, startNew, restoreDraft }));
const auth = create(() => ({ user: { id: 'user-1' } }));

let root: Root;
let host: HTMLDivElement;

async function open() {
  const { default: ProgramEditScreen } = loadNativeModule<{ default: () => ReactNode }>('app/program-edit/index.tsx', {
    '@expo/ui/swift-ui': { Host: Wrap, Picker: Wrap, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: noop, tag: noop },
    'date-fns': dates,
    'expo-router': { router: { back: noop, push: noop }, Stack: { Screen: Empty }, useIsFocused: () => true, useLocalSearchParams: () => ({ mode: 'new' }) },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { Alert: { alert: noop }, Keyboard: { dismiss: noop }, ScrollView: Wrap, TextInput: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/splitEditActions': { saveSplitEdit: noop },
    '@/lib/programQuestions': { ...programQuestions, seedGuidedDraft, peekBuilderLibrary: () => null, loadBuilderLibrary: () => new Promise(() => {}) },
    '@/lib/programSummary': programSummary,
    '@/lib/programFill': { keptExerciseCount: () => 0 },
    '@/lib/splitDraft': { dayLabel: noop, daySummary: noop, splitToDraft: noop },
    '@/lib/splitDraftSeed': { blankSplitDraft: noop },
    '@/lib/splitDraftStorage': { NEW_SPLIT_DRAFT_ID: 'new', clearSplitDraft: noop, readSplitDraft: () => stored },
    '@/stores/appStore': { useAppStore: create(() => ({})) },
    '@/stores/authStore': { useAuthStore: auth },
    '@/stores/splitEditStore': { useSplitEditStore: splitEdit },
    '~/components/BlancText': { BlancText: ({ children }: PropsWithChildren) => createElement('span', null, children) },
    '~/components/Capsule': {
      Capsule: ({ title, onPress, disabled, busy }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean }) =>
        createElement('button', { 'data-capsule': title, disabled: Boolean(disabled || busy), onClick: onPress }, title),
    },
    '~/components/Form': { FormNote: Wrap },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/UndoBar': { UndoBar: Empty },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/program': { afterProgramSaved: noop, confirmAlert: async () => true },
    '~/theme/blanc': { space: { inset: 16, gutter: 20, section: 28 }, type: {}, useBlanc: () => ({}) },
  });
  await act(async () => { root.render(createElement(ProgramEditScreen)); });
}

const button = (title: string) => host.querySelector<HTMLButtonElement>(`[data-capsule="${title}"]`)!;

beforeEach(() => {
  seedGuidedDraft.mockClear();
  startNew.mockClear();
  restoreDraft.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('new program chooser', () => {
  it('holds Resume and Discard while a guided plan loads, so the plan cannot replace a resumed program', async () => {
    await open();
    expect(button('Resume').disabled).toBe(false);

    await act(async () => { button('Start from this plan').click(); });
    expect(seedGuidedDraft).toHaveBeenCalledTimes(1);
    expect(button('Resume').disabled).toBe(true);
    expect(button('Discard it').disabled).toBe(true);
    await act(async () => { button('Resume').click(); });
    expect(restoreDraft).not.toHaveBeenCalled();

    await act(async () => { releaseSeed(seeded); });
    expect(startNew).toHaveBeenCalledTimes(1);
  });
});
