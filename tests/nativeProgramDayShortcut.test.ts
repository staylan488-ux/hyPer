// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as programFill from '@/lib/programFill';
import * as programQuestions from '@/lib/programQuestions';
import * as programSummary from '@/lib/programSummary';
import * as setRangeNotes from '@/lib/setRangeNotes';
import * as splitDraft from '@/lib/splitDraft';
import type { DraftDay, DraftSplit } from '@/lib/splitDraft';
import type { StoredSplitDraft } from '@/lib/splitDraftStorage';
import type { Split } from '@/types';
import * as format from '../native/src/lib/format';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The program view's day rows open the editor on that day
// (native/src/app/program-edit/index.tsx). Unsaved edits kept on this device
// are offered first (Restore or Discard, on the program): the day must not
// open above that offer, where its first change would drop the offer and
// overwrite the kept edits with the saved program.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const day = (id: string, name: string, order: number): DraftDay => ({ id, day_name: name, day_order: order, exercises: [] });
const push = day('day-push', 'Push', 0);
const pull = day('day-pull', 'Pull', 1);
const program = { id: 'split-1', name: 'Push Pull', days: [push, pull] } as unknown as Split;
const draftOf = (days: DraftDay[]): DraftSplit => ({ id: 'split-1', name: 'Push Pull', description: null, days_per_week: 2, days });
const kept = { draft: draftOf([pull]), savedAt: '2026-11-07T10:00:00.000Z', baseSignature: null } as unknown as StoredSplitDraft;

const routerPush = vi.fn();
const app = create(() => ({
  currentWorkout: null,
  workoutLoadedForUserId: 'user-1' as string | null,
  activeSplit: program as Split | null,
  splits: [program],
  createSplit: noop,
}));
const splitEdit = create(() => ({
  draft: draftOf([push, pull]) as DraftSplit | null,
  isDirty: false, saving: false, error: null, undo: null,
  restorable: null as StoredSplitDraft | null, baseSignature: null,
}));

let root: Root;
let host: HTMLDivElement;
let capsules: string[] = [];

function load() {
  const programLib = loadNativeModule<Record<string, unknown>>('lib/program.ts', {
    'expo-router': { router: { push: noop } },
    'react-native': { Alert: { alert: noop } },
    zustand: { create },
    '@/lib/planSchedule': { dismissPlanStartPrompt: noop, shouldPromptPlanStart: async () => false },
    '@/lib/programSummary': programSummary,
    '@/lib/setRangeNotes': setRangeNotes,
    '@/lib/splitDraft': splitDraft,
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '@/stores/splitEditStore': { useSplitEditStore: splitEdit },
    './format': format,
    './haptics': { haptics: { error: noop, success: noop } },
  });
  return loadNativeModule<{ default: () => ReactNode }>('app/program-edit/index.tsx', {
    '@expo/ui/swift-ui': { Host: Wrap, Picker: Wrap, Text: Wrap },
    '@expo/ui/swift-ui/modifiers': { pickerStyle: noop, tag: noop },
    'date-fns': dates,
    'expo-router': {
      router: { back: noop, push: routerPush },
      Stack: { Screen: Empty },
      useIsFocused: () => true,
      useLocalSearchParams: () => ({ mode: 'edit', day: 'day-pull' }),
    },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { Alert: { alert: noop }, Keyboard: { dismiss: noop }, ScrollView: Wrap, TextInput: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/splitEditActions': { saveSplitEdit: async () => undefined },
    '@/lib/programQuestions': programQuestions,
    '@/lib/programFill': programFill,
    '@/lib/programSummary': programSummary,
    '@/lib/splitDraft': splitDraft,
    '@/lib/splitDraftSeed': { blankSplitDraft: noop },
    '@/lib/splitDraftStorage': { NEW_SPLIT_DRAFT_ID: 'new', clearSplitDraft: noop, readSplitDraft: () => null },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '@/stores/splitEditStore': { useSplitEditStore: splitEdit },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: ({ title }: { title: string }) => { capsules.push(title); return null; } },
    '~/components/Form': { FormNote: Wrap },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': { Hairline: Empty, Row: Empty },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': { SwipeRow: Wrap },
    '~/components/UndoBar': { UndoBar: Empty },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/program': programLib,
    '~/theme/blanc': { space: { inset: 16, gutter: 20, section: 28 }, type: {}, useBlanc: () => ({}) },
  });
}

async function open() {
  const { default: ProgramEditScreen } = load();
  await act(async () => { root.render(createElement(ProgramEditScreen)); });
}

beforeEach(() => {
  routerPush.mockClear();
  capsules = [];
  splitEdit.setState({ draft: draftOf([push, pull]), isDirty: false, restorable: null });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('opening a program day from the program view', () => {
  it('opens that day in the editor', async () => {
    await open();
    expect(routerPush).toHaveBeenCalledWith({ pathname: '/program-edit/day', params: { id: 'day-pull' } });
  });

  it('stays on the program while kept unsaved edits wait for Restore or Discard', async () => {
    splitEdit.setState({ restorable: kept });
    await open();
    expect(routerPush).not.toHaveBeenCalled();
    expect(capsules).toEqual(expect.arrayContaining(['Discard them', 'Restore']));
  });
});
