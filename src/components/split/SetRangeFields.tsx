import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { resolveRepDraft, resolveSetRangeDraft, type SetRangeDraft, type SetRangeValues } from '@/lib/setRangeDraft';

type Field = keyof SetRangeDraft | 'minReps' | 'maxReps';

export interface SetRangeFieldValues extends SetRangeValues {
  target_reps_min: number;
  target_reps_max: number;
}

export type RepCommit = { target_reps_min: number } | { target_reps_max: number };

const DEFAULT_LABELS: Record<Field, string> = {
  minSets: 'Min sets',
  targetSets: 'Sets',
  maxSets: 'Max sets',
  minReps: 'Reps↓',
  maxReps: 'Reps↑',
};

const FIELDS: Array<{ field: Field; max: number }> = [
  { field: 'minSets', max: 10 },
  { field: 'targetSets', max: 10 },
  { field: 'maxSets', max: 10 },
  { field: 'minReps', max: 100 },
  { field: 'maxReps', max: 100 },
];

function fieldValue(values: SetRangeFieldValues, field: Field): number {
  switch (field) {
    case 'minSets': return values.target_sets_min;
    case 'targetSets': return values.target_sets;
    case 'maxSets': return values.target_sets_max;
    case 'minReps': return values.target_reps_min;
    case 'maxReps': return values.target_reps_max;
  }
}

/**
 * Set min/target/max and rep min/max cells for one exercise. Typing only
 * edits a draft of the focused cell; it commits (clamped and normalized) on
 * blur or Enter, so a cell can be cleared and retyped. Every other cell
 * shows the committed values, so outside changes such as a superset
 * partner's synced sets appear without remounting (which would drop focus).
 */
export function SetRangeFields({
  values,
  labels,
  onCommitSets,
  onCommitReps,
}: {
  values: SetRangeFieldValues;
  labels?: Partial<Record<Field, string>>;
  onCommitSets: (range: SetRangeValues) => void;
  onCommitReps: (patch: RepCommit) => void;
}) {
  const [editing, setEditing] = useState<{ field: Field; value: string } | null>(null);

  const commit = (field: Field, value: string) => {
    setEditing(null);

    if (field === 'minReps' || field === 'maxReps') {
      const current = fieldValue(values, field);
      const next = resolveRepDraft(value, current);
      if (next === current) return;
      onCommitReps(field === 'minReps' ? { target_reps_min: next } : { target_reps_max: next });
      return;
    }

    const draftFor = (f: keyof SetRangeDraft) => (f === field ? value : String(fieldValue(values, f)));
    const next = resolveSetRangeDraft(
      { minSets: draftFor('minSets'), targetSets: draftFor('targetSets'), maxSets: draftFor('maxSets') },
      values,
    );
    if (
      next.target_sets_min === values.target_sets_min
      && next.target_sets === values.target_sets
      && next.target_sets_max === values.target_sets_max
    ) return;
    onCommitSets(next);
  };

  return (
    <div className="grid grid-cols-3 min-[420px]:grid-cols-5 gap-3">
      {FIELDS.map(({ field, max }) => {
        const emphasized = field === 'targetSets';
        return (
          <SetRepCell key={field} label={labels?.[field] ?? DEFAULT_LABELS[field]}>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={max}
              value={editing?.field === field ? editing.value : String(fieldValue(values, field))}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEditing({ field, value: e.target.value })}
              onBlur={() => {
                if (editing?.field === field) commit(field, editing.value);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (editing?.field === field) commit(field, editing.value);
                }
              }}
              className={emphasized
                ? 'well w-full min-h-11 text-center t-data-sm text-[var(--color-accent)] outline-none focus:ring-[1.5px] focus:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]'
                : 'well w-full min-h-11 text-center t-data-sm text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[var(--color-border-strong)]'}
            />
          </SetRepCell>
        );
      })}
    </div>
  );
}

/** Labelled numeric cell — tracked-caps label over a recessed well input */
function SetRepCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col items-center gap-1">
      <span className="t-label-sm">{label}</span>
      {children}
    </label>
  );
}
