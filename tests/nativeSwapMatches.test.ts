// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, Fragment, type PropsWithChildren, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as customExercises from '@/lib/customExercises';
import * as exerciseSearch from '@/lib/exerciseSearch';
import * as swapSuggestions from '@/lib/swapSuggestions';
import * as types from '@/types';
import type { Exercise, MuscleGroup } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The exercise picker on a swap (native/src/components/ExercisePicker.tsx):
// it opens on the closest matches for the movement being replaced, and steps
// back to the plain list on a search or another muscle. Run as the app ships
// it, through the React Compiler.

const Wrap = ({ children }: PropsWithChildren) => createElement(Fragment, null, children);
const Empty = () => null;
const noop = () => {};

const row = (name: string, muscle: MuscleGroup, equipment: string, second: MuscleGroup | null = null): Exercise => ({
  id: name, name, muscle_group: muscle, muscle_group_secondary: second, equipment, is_compound: true, category: 'gym',
});
const squat = row('Barbell Back Squat', 'quads', 'barbell', 'glutes');
const library: Exercise[] = [
  squat,
  row('Flat Barbell Bench Press', 'chest', 'barbell', 'triceps'),
  row('Front Squat', 'quads', 'barbell', 'glutes'),
  row('Hack Squat', 'quads', 'machine', 'glutes'),
  row('Leg Extension', 'quads', 'machine'),
  row('Leg Press', 'quads', 'machine', 'glutes'),
  row('Smith Machine Squat', 'quads', 'smith machine', 'glutes'),
];

type PickerProps = {
  title: string;
  initialMuscle?: MuscleGroup;
  replacing?: Exercise | null;
  lead?: { title: string; pick: (offered: Exercise[]) => Array<{ exercise: Exercise; line: string }> } | null;
  exclude: ReadonlySet<string>;
  onPick: (exercise: Exercise) => void;
};

let typeSearch: (text: string) => void = noop;
let root: Root;
let host: HTMLDivElement;
const onPick = vi.fn();

type PressableProps = { accessibilityLabel?: string; onPress?: () => void; children?: ReactNode | ((state: { pressed: boolean }) => ReactNode) };

function loadPicker() {
  return loadNativeModule<{ ExercisePicker: (props: PickerProps) => ReactNode }>(
    'components/ExercisePicker.tsx',
    {
      'expo-router': { router: { back: noop } },
      'expo-symbols': { SymbolView: Empty },
      'react-native': {
        ActionSheetIOS: { showActionSheetWithOptions: noop },
        ActivityIndicator: Empty,
        Pressable: ({ accessibilityLabel, onPress, children }: PressableProps) =>
          createElement('div', { 'data-row': accessibilityLabel, onClick: onPress }, typeof children === 'function' ? children({ pressed: false }) : children),
        ScrollView: Wrap,
        TextInput: ({ onChangeText }: { onChangeText: (text: string) => void }) => {
          typeSearch = onChangeText;
          return null;
        },
        View: Wrap,
      },
      '@/lib/customExercises': customExercises,
      '@/lib/exerciseLibrary': { getExerciseLibrary: async () => library, peekExerciseLibrary: () => library },
      '@/lib/exerciseSearch': exerciseSearch,
      '@/lib/swapSuggestions': swapSuggestions,
      '@/types': types,
      '~/lib/accessibility': silentAccessibility,
      '~/lib/haptics': { haptics: { tap: noop, select: noop, success: noop, error: noop } },
      '~/lib/spoken': { speak: silentAccessibility.speak },
      '~/theme/blanc': { space: { gutter: 16 }, type: {}, useBlanc: () => ({}) },
      './BlancText': {
        BlancText: ({ children, accessibilityRole }: PropsWithChildren<{ accessibilityRole?: string }>) =>
          createElement('span', accessibilityRole === 'header' ? { 'data-header': true } : null, children),
      },
      './Capsule': { Capsule: Empty },
      './Chip': {
        Chip: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { 'data-chip': label, onClick: onPress }, label),
      },
      './GlassButton': { GlassButton: Empty },
      './Label': { Label: Wrap },
      './Row': { Hairline: Empty },
    },
    { compile: true },
  );
}

async function open(props: Partial<PickerProps> = {}) {
  const { ExercisePicker } = loadPicker();
  await act(async () => {
    root.render(
      createElement(ExercisePicker, {
        title: 'Swap for this workout',
        initialMuscle: 'quads',
        replacing: squat,
        exclude: new Set([squat.id]),
        onPick,
        ...props,
      }),
    );
  });
}

const headers = () => Array.from(host.querySelectorAll('[data-header]'), (node) => node.textContent);
const rows = () => Array.from(host.querySelectorAll('[data-row]'), (node) => node.getAttribute('data-row'));

beforeEach(() => {
  onPick.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('closest matches on a swap', () => {
  it('leads with the matches, each with its line, then the rest of the muscle once', async () => {
    await open();
    expect(headers()).toEqual(['Swap for this workout', 'Closest matches', 'More movements']);
    expect(rows()).toEqual([
      'Hack Squat, Same movement, machine, easier on the lower back',
      'Smith Machine Squat, Same movement, Smith machine',
      'Front Squat, Same movement',
      'Leg Press, Same muscles, machine, easier on the lower back',
      'Leg Extension',
    ]);
    expect(host.textContent).toContain('Machines and free weights build muscle equally well (Haugen 2023).');
  });

  it('picks a match like any other row', async () => {
    await open();
    await act(async () => { host.querySelector<HTMLElement>('[data-row^="Hack Squat"]')!.click(); });
    expect(onPick).toHaveBeenCalledWith(library.find((exercise) => exercise.name === 'Hack Squat'));
  });

  it('steps back to the plain list for another muscle, and returns with the first one', async () => {
    await open();
    await act(async () => { host.querySelector<HTMLElement>('[data-chip="All"]')!.click(); });
    expect(headers()).toEqual(['Swap for this workout']);
    expect(rows()).toEqual([
      'Flat Barbell Bench Press, Chest',
      'Front Squat, Quadriceps',
      'Hack Squat, Quadriceps',
      'Leg Extension, Quadriceps',
      'Leg Press, Quadriceps',
      'Smith Machine Squat, Quadriceps',
    ]);
    await act(async () => { host.querySelector<HTMLElement>('[data-chip="Quadriceps"]')!.click(); });
    expect(headers()).toContain('Closest matches');
  });

  it('steps back to the plain list for a search', async () => {
    await open();
    await act(async () => { typeSearch('leg'); });
    expect(headers()).toEqual(['Swap for this workout']);
    expect(rows()).toEqual(['Leg Extension, Quadriceps', 'Leg Press, Quadriceps']);
  });

  it('never offers what the workout already holds', async () => {
    await open({ exclude: new Set([squat.id, 'Hack Squat']) });
    expect(rows().join('|')).not.toContain('Hack Squat');
    expect(rows()[0]).toBe('Smith Machine Squat, Same movement, Smith machine');
  });

  it('shows the plain list when nothing is being replaced', async () => {
    await open({ replacing: null });
    expect(headers()).toEqual(['Swap for this workout']);
    expect(rows()).toEqual(['Front Squat', 'Hack Squat', 'Leg Extension', 'Leg Press', 'Smith Machine Squat']);
  });

  it('passes the movement being replaced only on a swap, from both swap screens', () => {
    const source = readFileSync(join(__dirname, '../native/src/app/swap.tsx'), 'utf8');
    expect(source.match(/replacing=\{mode === 'swap' \?/g)).toHaveLength(2);
  });
});

describe('what fits on an add', () => {
  const lead = {
    title: 'Fits today',
    pick: (offered: Exercise[]) =>
      offered
        .filter((exercise) => exercise.name === 'Leg Extension' || exercise.name === 'Barbell Back Squat')
        .map((exercise) => ({ exercise, line: 'Quadriceps · 4 of 9 sets so far this week' })),
  };
  const add = (props: Partial<PickerProps> = {}) => open({ title: 'Add a movement', initialMuscle: undefined, replacing: null, lead, ...props });

  it('leads with what fits under its own heading, from the movements on offer, then the rest once', async () => {
    await add();
    expect(headers()).toEqual(['Add a movement', 'Fits today', 'More movements']);
    // The squat is already in the workout, so it is never handed to the pick.
    expect(rows()).toEqual([
      'Leg Extension, Quadriceps, 4 of 9 sets so far this week',
      'Flat Barbell Bench Press, Chest',
      'Front Squat, Quadriceps',
      'Hack Squat, Quadriceps',
      'Leg Press, Quadriceps',
      'Smith Machine Squat, Quadriceps',
    ]);
    // No study line: that belongs to a swap.
    expect(host.textContent).not.toContain('Haugen');
  });

  it('steps back to the plain list for a search or a muscle', async () => {
    await add();
    await act(async () => { typeSearch('leg'); });
    expect(headers()).toEqual(['Add a movement']);
    expect(rows()).toEqual(['Leg Extension, Quadriceps', 'Leg Press, Quadriceps']);
    await act(async () => { typeSearch(''); });
    expect(headers()).toContain('Fits today');
    await act(async () => { host.querySelector<HTMLElement>('[data-chip="Chest"]')!.click(); });
    expect(headers()).toEqual(['Add a movement']);
  });

  it('shows the list as it always was when nothing fits', async () => {
    await add({ lead: { title: 'Fits today', pick: () => [] } });
    expect(headers()).toEqual(['Add a movement']);
    expect(rows()).toHaveLength(6);
  });

  it('gives way to the closest matches on a swap', async () => {
    await open({ lead });
    expect(headers()).toEqual(['Swap for this workout', 'Closest matches', 'More movements']);
  });
});
