// @vitest-environment happy-dom
import * as dates from 'date-fns';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as programQuestions from '@/lib/programQuestions';
import * as programSummary from '@/lib/programSummary';
import * as setRangeNotes from '@/lib/setRangeNotes';
import * as splitDraft from '@/lib/splitDraft';
import type { DraftDay, DraftSplit } from '@/lib/splitDraft';
import type { Split, Workout } from '@/types';
import * as format from '../native/src/lib/format';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The program editor (native/src/app/program-edit/index.tsx) with the real
// rules in native/src/lib/program.ts. Deleting the live workout's day sets
// its split_day_id to null, and the next workout read drops the session, so
// the editor refuses to remove that day, as it refuses to delete the program.

type MenuItem = { title: string; removes?: boolean; run?: () => void };
type HeaderItem = { label: string; onPress: () => void };

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const day = (id: string, name: string, order: number): DraftDay => ({ id, day_name: name, day_order: order, exercises: [] });
const push = day('day-push', 'Push', 0);
const pull = day('day-pull', 'Pull', 1);
const program = { id: 'split-1', name: 'Push Pull', days: [push, pull] } as unknown as Split;
const draftOf = (days: DraftDay[]): DraftSplit => ({ id: 'split-1', name: 'Push Pull', description: null, days_per_week: 2, days });

const alert = vi.fn();
const saveSplitEdit = vi.fn();
const removeDay = vi.fn();
const app = create(() => ({
  currentWorkout: null as Pick<Workout, 'id' | 'split_day_id' | 'completed'> | null,
  activeSplit: program as Split | null,
  splits: [program],
  createSplit: noop,
}));
const splitEdit = create(() => ({
  draft: draftOf([push, pull]) as DraftSplit | null,
  isDirty: true, saving: false, error: null, undo: null, restorable: null, baseSignature: null,
  removeDay,
}));

let root: Root;
let host: HTMLDivElement;
let header: HeaderItem[] = [];
const menus = new Map<string, MenuItem[]>();

function load() {
  const program = loadNativeModule<Record<string, unknown>>('lib/program.ts', {
    'expo-router': { router: { push: noop } },
    'react-native': { Alert: { alert } },
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
      router: { back: noop, push: noop },
      Stack: { Screen: ({ options }: { options: { unstable_headerRightItems?: () => HeaderItem[] } }) => {
        header = options.unstable_headerRightItems?.() ?? [];
        return null;
      } },
      useIsFocused: () => true,
      useLocalSearchParams: () => ({ mode: 'edit' }),
    },
    'expo-symbols': { SymbolView: Empty },
    'react-native': { Alert: { alert }, Keyboard: { dismiss: noop }, ScrollView: Wrap, TextInput: Empty, View: Wrap },
    'react-native-reanimated': { default: { View: Wrap } },
    '@/lib/splitEditActions': { saveSplitEdit: (...args: unknown[]) => { saveSplitEdit(...args); return Promise.resolve(); } },
    '@/lib/programQuestions': programQuestions,
    '@/lib/programSummary': programSummary,
    '@/lib/splitDraft': splitDraft,
    '@/lib/splitDraftSeed': { blankSplitDraft: noop },
    '@/lib/splitDraftStorage': { NEW_SPLIT_DRAFT_ID: 'new', clearSplitDraft: noop, readSplitDraft: () => null },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    '@/stores/splitEditStore': { useSplitEditStore: splitEdit },
    '~/components/BlancText': { BlancText: Wrap },
    '~/components/Capsule': { Capsule: Empty },
    '~/components/Form': { FormNote: Wrap },
    '~/components/Label': { Label: Wrap },
    '~/components/Row': {
      Hairline: Empty,
      Row: ({ title, menu }: { title: string; menu?: MenuItem[] }) => {
        if (menu) menus.set(title, menu);
        return null;
      },
    },
    '~/components/Section': { Section: Wrap },
    '~/components/SwipeRow': {
      SwipeRow: ({ name, actions, children }: PropsWithChildren<{ name: string; actions: { label: string; onPress: () => void }[] }>) =>
        createElement(Fragment, null, children, actions.map((action) =>
          createElement('button', { key: action.label, 'data-swipe': `${name}:${action.label}`, onClick: action.onPress }, action.label))),
    },
    '~/components/UndoBar': { UndoBar: Empty },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
    '~/lib/motion': {},
    '~/lib/program': program,
    '~/theme/blanc': { space: { inset: 16, gutter: 20, section: 28 }, type: {}, useBlanc: () => ({}) },
  });
}

async function open() {
  const { default: ProgramEditScreen } = load();
  await act(async () => { root.render(createElement(ProgramEditScreen)); });
}
const swipe = (name: string) => host.querySelector<HTMLButtonElement>(`[data-swipe="${name}:Remove"]`)!;
const save = () => act(async () => { header.find((item) => item.label === 'Save')!.onPress(); });

beforeEach(() => {
  alert.mockClear();
  saveSplitEdit.mockClear();
  removeDay.mockClear();
  menus.clear();
  app.setState({ currentWorkout: { id: 'w1', split_day_id: 'day-push', completed: false } });
  splitEdit.setState({ draft: draftOf([push, pull]) });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('editing the program of a workout in progress', () => {
  it('refuses to remove the live workout\'s day, and removes any other', async () => {
    await open();

    await act(async () => { swipe('Push').click(); });
    expect(removeDay).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Finish your workout first', 'Today\'s workout is Push.');

    await act(async () => { swipe('Pull').click(); });
    expect(removeDay).toHaveBeenCalledWith('day-pull');
  });

  it('keeps the hold menu open for the refusal on the live day only', async () => {
    await open();
    expect(menus.get('Push')?.find((item) => item.title === 'Remove day')?.removes).toBe(false);
    expect(menus.get('Pull')?.find((item) => item.title === 'Remove day')?.removes).toBe(true);
  });

  it('lets the day go once the workout is finished', async () => {
    app.setState({ currentWorkout: { id: 'w1', split_day_id: 'day-push', completed: true } });
    await open();

    await act(async () => { swipe('Push').click(); });
    expect(removeDay).toHaveBeenCalledWith('day-push');
    expect(alert).not.toHaveBeenCalled();
  });

  it('refuses to save a draft that left the live workout\'s day out', async () => {
    // A restored draft from before the workout started, without Push.
    splitEdit.setState({ draft: draftOf([pull]) });
    await open();

    await save();
    expect(saveSplitEdit).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Finish your workout first', 'Today\'s workout is Push.');

    splitEdit.setState({ draft: draftOf([push, pull]) });
    await save();
    expect(saveSplitEdit).toHaveBeenCalledTimes(1);
  });

  it('saves without the day when the workout came from another program', async () => {
    app.setState({ currentWorkout: { id: 'w1', split_day_id: 'day-other', completed: false } });
    splitEdit.setState({ draft: draftOf([pull]) });
    await open();

    await save();
    expect(saveSplitEdit).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});
