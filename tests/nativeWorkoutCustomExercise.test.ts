// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as customExercises from '@/lib/customExercises';
import * as splitDraft from '@/lib/splitDraft';
import type { Exercise } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';
import { silentAccessibility } from './helpers/silentAccessibility';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PickerProps = {
  allowCustom?: boolean;
  extras?: Exercise[];
  busyId?: string | null;
  accessory?: ReactNode;
  onPick: (exercise: Exercise) => void;
};
type ToggleProps = { label: string; value: boolean; onChange: (value: boolean) => void };

let pickerProps: PickerProps | null = null;
let keepToggle: ToggleProps | null = null;
const addExerciseToProgramDay = vi.fn(async () => {});
const addMovement = vi.fn(async () => {});
const invalidateExerciseLibrary = vi.fn();
const back = vi.fn();
const inserted: Array<Omit<Exercise, 'id'>> = [];

const supabase = {
  from: (table: string) => {
    expect(table).toBe('exercises');
    return {
      insert: (rows: Array<Omit<Exercise, 'id'>>) => {
        inserted.push(...rows);
        return {
          select: async () => ({
            data: rows.map((row, index) => ({ id: `lib-custom-${index + 1}`, name: row.name })),
            error: null,
          }),
        };
      },
    };
  },
};

const { default: PickExerciseSheet } = loadNativeModule<{ default: () => ReactNode }>(
  'app/swap.tsx',
  {
    'expo-router': {
      router: { back, dismiss: vi.fn() },
      useLocalSearchParams: () => ({ mode: 'add' }),
    },
    'react-native': { Alert: { alert: vi.fn() } },
    '@/lib/customExercises': customExercises,
    '@/lib/exerciseLibrary': {
      getExerciseLibrary: async () => [],
      invalidateExerciseLibrary,
    },
    '@/lib/splitDraft': splitDraft,
    '@/lib/supabase': { supabase },
    '@/stores/appStore': { useAppStore: create(() => ({ currentWorkout: { split_day_id: 'day-1' }, addExerciseToProgramDay })) },
    '@/stores/splitEditStore': { useSplitEditStore: create(() => ({ draft: null })) },
    '~/components/ExercisePicker': {
      ExercisePicker: (props: PickerProps) => {
        pickerProps = props;
        return props.accessory ?? null;
      },
    },
    '~/components/Form': {
      ToggleRow: (props: ToggleProps) => {
        keepToggle = props;
        return null;
      },
    },
    '~/lib/accessibility': silentAccessibility,
    '~/lib/haptics': { haptics: { success: vi.fn(), error: vi.fn() } },
    '~/lib/leaveGuard': { useLeaveGuard: () => {} },
    '~/lib/history': { editPastWorkout: vi.fn(), useHistoryStore: create(() => ({ workouts: [] })) },
    '~/lib/movement': {
      addMovement,
      addSupersetPartner: vi.fn(),
      errorMessage: (_error: unknown, fallback: string) => fallback,
      swapMovement: vi.fn(),
    },
    '~/lib/session': {
      useSessionModel: () => ({
        workoutId: 'workout-1',
        dayName: 'Lower B',
        flexible: false,
        movements: [],
        current: null,
      }),
    },
  },
  { compile: true },
);

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  pickerProps = null;
  keepToggle = null;
  inserted.length = 0;
  addMovement.mockClear();
  addExerciseToProgramDay.mockClear();
  invalidateExerciseLibrary.mockClear();
  back.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Workout exercise picker custom exercises', () => {
  it('enables allowCustom in live workouts and saves a custom exercise to the library before adding it', async () => {
    await act(async () => {
      root.render(createElement(PickExerciseSheet));
    });

    expect(pickerProps?.allowCustom).toBe(true);
    const pending = customExercises.customExercise('Pendulum Squat', 'quads', []);
    expect(customExercises.isPendingExerciseId(pending.id)).toBe(true);

    await act(async () => {
      pickerProps!.onPick(pending);
    });

    expect(inserted).toEqual([
      expect.objectContaining({ name: 'Pendulum Squat', muscle_group: 'quads' }),
    ]);
    expect(invalidateExerciseLibrary).toHaveBeenCalledOnce();
    expect(addMovement).toHaveBeenCalledWith(
      'workout-1',
      expect.objectContaining({ id: 'lib-custom-1', name: 'Pendulum Squat', muscle_group: 'quads' }),
    );
    expect(back).toHaveBeenCalledOnce();
    // Keep was left off: the program day is not touched.
    expect(addExerciseToProgramDay).not.toHaveBeenCalled();
  });

  it('keeps a custom exercise on the program day by its saved library id, never its pending one', async () => {
    await act(async () => {
      root.render(createElement(PickExerciseSheet));
    });
    expect(keepToggle?.label).toBe('Keep in Lower B');
    await act(async () => {
      keepToggle!.onChange(true);
    });

    const pending = customExercises.customExercise('Pendulum Squat', 'quads', []);
    await act(async () => {
      pickerProps!.onPick(pending);
    });

    expect(addMovement).toHaveBeenCalledWith('workout-1', expect.objectContaining({ id: 'lib-custom-1' }));
    expect(addExerciseToProgramDay).toHaveBeenCalledExactlyOnceWith('day-1', 'lib-custom-1');
    expect(back).toHaveBeenCalledOnce();
  });
});
