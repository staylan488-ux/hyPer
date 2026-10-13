import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, SelectSheet } from '@/components/shared';
import { customExercise } from '@/lib/customExercises';
import type { Exercise, MuscleGroup } from '@/types';
import { MUSCLE_GROUP_LABELS } from '@/types';

const MUSCLE_OPTIONS = (Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[])
  .map((value) => ({ value, label: MUSCLE_GROUP_LABELS[value] }));

/**
 * Names an exercise the library lacks. A name the library already has (loosely
 * compared) picks that exercise instead; a new one is added to the library
 * when the program is saved.
 */
export function CustomExerciseForm({
  initialName,
  initialMuscleGroup,
  library,
  onCreate,
  onCancel,
}: {
  initialName: string;
  initialMuscleGroup?: MuscleGroup;
  library: readonly Exercise[];
  onCreate: (exercise: Exercise) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName.trim());
  const [muscle, setMuscle] = useState<MuscleGroup>(initialMuscleGroup ?? 'chest');
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onCreate(customExercise(trimmed, muscle, library));
  };

  return (
    <form className="space-y-3 pt-3 border-t border-[var(--color-border)]" onSubmit={submit}>
      <span className="t-label block">Custom exercise</span>
      <Input
        aria-label="Exercise name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g., Landmine Press"
        maxLength={80}
        autoFocus
      />
      <SelectSheet title="Muscle group" value={muscle} onChange={setMuscle} options={MUSCLE_OPTIONS} />
      <p className="t-caption">Added to your exercise library when you save the program.</p>
      <div className="flex gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={!trimmed}>
          <Plus className="w-4 h-4" strokeWidth={2} aria-hidden />
          Add
        </Button>
      </div>
    </form>
  );
}
