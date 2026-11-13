import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { isPendingExerciseId } from '@/lib/customExercises';
import { PROGRAM_PICKER_TITLES, pickerTargetFor, type ProgramPickMode } from '@/lib/splitDraft';
import { useAppStore } from '@/stores/appStore';
import { useSplitEditStore } from '@/stores/splitEditStore';
import type { Exercise } from '@/types';
import { ExercisePicker } from '~/components/ExercisePicker';
import { announce } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { editPastWorkout, useHistoryStore } from '~/lib/history';
import { addMovement, addSupersetPartner, errorMessage, swapMovement } from '~/lib/movement';
import { useSessionModel, type Movement, type SessionModel } from '~/lib/session';

type PickMode = 'swap' | 'add' | 'superset';

/** `done`: what VoiceOver hears once the pick saves and the sheet closes. */
const COPY: Record<PickMode, { title: string; verb: string; done: string; failed: string; fallback: string }> = {
  swap: { title: 'Swap for this workout', verb: 'Swap to', done: 'Swapped to', failed: 'Not swapped', fallback: 'Could not swap the exercise. Try again.' },
  add: { title: 'Add a movement', verb: 'Add', done: 'Added', failed: 'Not added', fallback: 'Could not add the exercise. Try again.' },
  superset: { title: 'Add a superset', verb: 'Pair with', done: 'Paired with', failed: 'Not added', fallback: 'Could not add the superset. Try again.' },
};

/**
 * Adds the pick to the live workout, pairs it with the movement as a
 * superset, or swaps the movement for it; throws when the save fails. Out
 * here because the React Compiler can't yet compile a component whose own
 * code branches inside a try.
 */
async function pickInWorkout(session: SessionModel, mode: PickMode, movement: Movement | null, exercise: Exercise) {
  if (mode === 'add') {
    await addMovement(session.workoutId, exercise);
  } else if (movement && mode === 'superset') {
    await addSupersetPartner(session.workoutId, movement.exerciseId, exercise);
  } else if (movement) {
    await swapMovement(session.workoutId, movement.exerciseId, exercise, session.current?.movement.exerciseId === movement.exerciseId);
  }
}

/**
 * Picks an exercise to swap a movement for this workout only, to add to the
 * live workout (a planned session's program stays the same), or to pair with
 * a movement as a superset. Leaves out
 * exercises already in the workout; a swap opens on the movement's muscle.
 * With a past workout (`workout`), it adds a movement or a superset to that
 * workout instead, as History does.
 */
export default function PickExerciseSheet() {
  const params = useLocalSearchParams<{ id?: string; mode?: string; workout?: string; program?: string; day?: string; from?: string }>();
  if (params.program && params.day) {
    const mode: ProgramPickMode = params.program === 'swap' || params.program === 'superset' ? params.program : 'add';
    return <ProgramPick mode={mode} dayId={params.day} exerciseId={params.id} />;
  }
  return <WorkoutPick params={params} />;
}

function WorkoutPick({ params }: { params: { id?: string; mode?: string; workout?: string; from?: string } }) {
  const pastId = params.workout ?? null;
  const mode: PickMode = params.mode === 'add' || params.mode === 'superset' ? params.mode : pastId ? 'add' : 'swap';
  const copy = COPY[mode];
  const live = useSessionModel();
  const session = pastId ? null : live;
  const past = useHistoryStore((state) => (pastId ? state.workouts.find((entry) => entry.id === pastId) ?? null : null));
  const pastBase = past?.sets.find((set) => set.exercise_id === params.id);
  const movement = session?.movements.find((entry) => entry.exerciseId === params.id) ?? null;
  const baseName = movement?.name ?? (pastBase?.exercise as { name?: string } | undefined)?.name ?? null;
  const sourceMuscle = mode === 'swap' ? movement?.sets[0]?.exercise?.muscle_group : undefined;

  const [swapping, setSwapping] = useState<string | null>(null);
  // While a pick saves, the sheet holds still: closing it then would leave the
  // save to close whatever screen is showing. After the save it steps aside.
  const [exit, setExit] = useState<'back' | 'dismiss' | null>(null);
  useLeaveGuard(swapping !== null && exit === null, undefined, { busy: true });
  useEffect(() => {
    if (exit === 'back') router.back();
    if (exit === 'dismiss') router.dismiss(2);
  }, [exit]);

  const inWorkout = useMemo(
    () => new Set(past ? past.sets.map((set) => set.exercise_id) : session?.movements.map((entry) => entry.exerciseId)),
    [past, session?.movements],
  );

  const choosePast = async (exercise: Exercise) => {
    if (!past || swapping || (mode === 'superset' && !params.id)) return;
    setSwapping(exercise.id);
    const store = useAppStore.getState();
    const saved = await editPastWorkout(past.id, async () => {
      if (mode === 'superset' && params.id) {
        await store.addSupersetToWorkout(past.id, params.id, exercise);
      } else {
        const created = await store.addExerciseToWorkout(past.id, exercise);
        if (!created) throw new Error('Could not add that exercise.');
      }
    });
    if (saved) {
      haptics.success();
      announce(`${copy.done} ${exercise.name}`);
      setExit('back');
    } else {
      haptics.error();
      setSwapping(null);
      Alert.alert(copy.failed, copy.fallback);
    }
  };

  const choose = async (exercise: Exercise) => {
    if (pastId) return choosePast(exercise);
    if (!session || swapping || (mode !== 'add' && !movement)) return;
    setSwapping(exercise.id);
    // Back to the workout, past the movement sheet a swap or superset opened
    // from (a swipe on Train's row opens this sheet straight from Train).
    const exitTo = mode === 'add' || params.from === 'train' ? 'back' : 'dismiss';
    try {
      await pickInWorkout(session, mode, movement, exercise);
      haptics.success();
      announce(`${copy.done} ${exercise.name}`);
      setExit(exitTo);
    } catch (error) {
      haptics.error();
      setSwapping(null);
      Alert.alert(copy.failed, errorMessage(error, copy.fallback));
    }
  };

  return (
    <ExercisePicker
      title={copy.title}
      subtitle={
        baseName && mode !== 'add'
          ? mode === 'swap' ? `Replacing ${baseName}` : `With ${baseName}`
          : mode === 'add' && session && !session.flexible ? 'For this workout only' : null
      }
      initialMuscle={sourceMuscle}
      exclude={inWorkout}
      busyId={swapping}
      onPick={(exercise) => void choose(exercise)}
    />
  );
}

/**
 * The program editor's picker: add several exercises to a day at once, or
 * swap one, or pair one as a superset. Exercises typed in by hand are kept in
 * the draft and join the library when the program saves.
 */
function ProgramPick({ mode, dayId, exerciseId }: { mode: ProgramPickMode; dayId: string; exerciseId?: string }) {
  // Read once: the day's exclusions must not change while picking.
  const [target] = useState(() => {
    const draft = useSplitEditStore.getState().draft;
    return draft ? pickerTargetFor(draft, dayId, mode, exerciseId) : null;
  });
  const source = useSplitEditStore((state) =>
    exerciseId ? state.draft?.days.find((day) => day.id === dayId)?.exercises.find((entry) => entry.id === exerciseId) ?? null : null,
  );
  const [picked, setPicked] = useState<Exercise[]>([]);
  const [created, setCreated] = useState<Exercise[]>([]);
  // One pick closes the sheet once; ticked picks are kept from a stray swipe down.
  const done = useRef(false);
  const [leaving, setLeaving] = useState(false);
  useLeaveGuard(picked.length > 0 && !leaving, { title: 'Discard your picks?' });
  // After Add, closes once the guard has stepped aside.
  useEffect(() => {
    if (leaving) router.back();
  }, [leaving]);
  const exclude = useMemo(() => new Set(target?.excludeExerciseIds ?? []), [target]);
  const selected = useMemo(() => new Set(picked.map((exercise) => exercise.id)), [picked]);
  const extras = useMemo(() => [...created, ...(target?.extraExercises ?? [])], [created, target]);
  if (!target) return null;

  const pick = (exercise: Exercise) => {
    const store = useSplitEditStore.getState();
    if (mode === 'add') {
      if (isPendingExerciseId(exercise.id) && !extras.some((entry) => entry.id === exercise.id)) {
        // A new custom exercise: keep it listed so its tick shows.
        setCreated((current) => [exercise, ...current]);
      }
      setPicked((current) => (current.some((entry) => entry.id === exercise.id) ? current.filter((entry) => entry.id !== exercise.id) : [...current, exercise]));
      return;
    }
    if (!exerciseId || done.current) return;
    done.current = true;
    if (mode === 'swap') store.swapExercise(dayId, exerciseId, exercise);
    else store.addSupersetExercise(dayId, exerciseId, exercise);
    haptics.success();
    router.back();
  };

  const add = () => {
    if (picked.length === 0 || done.current) return;
    done.current = true;
    useSplitEditStore.getState().addExercises(dayId, picked);
    haptics.success();
    setLeaving(true);
  };

  return (
    <ExercisePicker
      title={PROGRAM_PICKER_TITLES[mode]}
      subtitle={source ? (mode === 'swap' ? `Replacing ${source.exercise.name}` : `With ${source.exercise.name}`) : null}
      initialMuscle={target.initialMuscleGroup}
      exclude={exclude}
      extras={extras}
      selected={mode === 'add' ? selected : undefined}
      allowCustom
      onPick={pick}
      action={
        mode === 'add' && picked.length > 0
          ? { title: `Add ${picked.length}`, accessibilityLabel: `Add ${picked.length} ${picked.length === 1 ? 'exercise' : 'exercises'}`, onPress: add }
          : null
      }
    />
  );
}
