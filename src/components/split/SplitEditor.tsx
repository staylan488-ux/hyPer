import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LineButton } from '@/components/metal';
import { useSplitEditStore, type CreateSplitFn, type SavedSplit } from '@/stores/splitEditStore';
import { springs } from '@/lib/animations';
import { CommitInput } from '@/components/split/editor/CommitInput';
import { DayCard } from '@/components/split/editor/DayCard';
import { EditorFooter } from '@/components/split/editor/EditorFooter';
import { RestoreBanner } from '@/components/split/editor/RestoreBanner';
import { SortableList } from '@/components/split/editor/SortableList';
import { cancelSplitEdit, saveSplitEdit } from '@/components/split/editor/editorActions';
import type { PickExercise } from '@/components/split/editor/types';
import '@/components/split/program.css';

interface SplitEditorProps {
  createSplit: CreateSplitFn;
  onClose: () => void;
  onSaved: (saved: SavedSplit) => void;
  onPickExercise: PickExercise;
  /** Shown above the form, e.g. template exercises the library lacked. */
  notice?: string | null;
}

/**
 * The one program editor, for new and existing programs alike. A new program
 * arrives as a seeded draft and is created on save.
 */
export function SplitEditor({ createSplit, onClose, onSaved, onPickExercise, notice }: SplitEditorProps) {
  const draft = useSplitEditStore((s) => s.draft);
  const isDirty = useSplitEditStore((s) => s.isDirty);
  const restorable = useSplitEditStore((s) => s.restorable);
  const baseSignature = useSplitEditStore((s) => s.baseSignature);
  const renameSplit = useSplitEditStore((s) => s.renameSplit);
  const updateDescription = useSplitEditStore((s) => s.updateDescription);
  const addDay = useSplitEditStore((s) => s.addDay);
  const moveDay = useSplitEditStore((s) => s.moveDay);
  const restoreSaved = useSplitEditStore((s) => s.restoreSaved);
  const dismissRestore = useSplitEditStore((s) => s.dismissRestore);

  // Days open as a one-line overview (a single-day program opens expanded);
  // tapping a day opens it for editing.
  const [expandedDays, setExpandedDays] = useState<ReadonlySet<string>>(() => {
    const days = useSplitEditStore.getState().draft?.days ?? [];
    return new Set(days.length === 1 ? [days[0].id] : []);
  });

  const toggleDay = useCallback((dayId: string) => {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  }, []);

  const describeDay = useCallback((dayId: string) => {
    const days = useSplitEditStore.getState().draft?.days ?? [];
    const index = days.findIndex((day) => day.id === dayId);
    return days[index]?.day_name.trim() || `Day ${index + 1}`;
  }, []);

  const handleCancel = useCallback(() => {
    void cancelSplitEdit(onClose);
  }, [onClose]);

  const handleSave = useCallback(() => {
    void saveSplitEdit({ createSplit, onSaved, onClose });
  }, [createSplit, onSaved, onClose]);

  const handleAddDay = useCallback(() => {
    const count = useSplitEditStore.getState().draft?.days.length ?? 0;
    addDay(`Day ${count + 1}`);
    const added = useSplitEditStore.getState().draft?.days.at(-1);
    if (added) setExpandedDays((current) => new Set(current).add(added.id));
  }, [addDay]);

  const days = draft?.days;
  const dayIds = useMemo(() => days?.map((day) => day.id) ?? [], [days]);

  if (!draft) {
    return (
      <div className="pt-4 flex items-center justify-center py-20">
        <p className="metal-eyebrow">No program loaded</p>
      </div>
    );
  }

  return (
    <div className="pt-1 pb-2">
      {restorable && !isDirty && (
        <div className="mb-7">
          <RestoreBanner
            stored={restorable}
            changedSince={Boolean(restorable.baseSignature && baseSignature && restorable.baseSignature !== baseSignature)}
            onRestore={restoreSaved}
            onDismiss={dismissRestore}
          />
        </div>
      )}

      {notice && <p className="metal-flag mt-0 mb-6" role="status"><span>{notice}</span></p>}

      <section className="split-sheet-section space-y-4">
        <p className="metal-eyebrow">Program details</p>
        <CommitInput
          label="Program name"
          value={draft.name}
          onCommit={renameSplit}
          placeholder="e.g., Push Pull Legs"
          maxLength={60}
        />
        <CommitInput
          label="Description"
          value={draft.description ?? ''}
          onCommit={updateDescription}
          placeholder="Optional description…"
          maxLength={200}
        />
      </section>

      <section className="split-sheet-section">
        <div className="split-sheet-head">
          <p className="metal-eyebrow">Training days</p>
          <span className="metal-section-head-right">
            <span><b>{draft.days.length}</b> {draft.days.length === 1 ? 'day' : 'days'}</span>
          </span>
        </div>

        <SortableList ids={dayIds} onMove={moveDay} describe={describeDay}>
          <div className="split-days">
            {/* Existing days appear at once; added and removed ones fade. */}
            <AnimatePresence initial={false}>
              {draft.days.map((day, index) => (
                <motion.div
                  key={day.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={springs.settle}
                >
                  <DayCard
                    day={day}
                    index={index}
                    total={draft.days.length}
                    expanded={expandedDays.has(day.id)}
                    onToggle={toggleDay}
                    onPickExercise={onPickExercise}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </SortableList>

        <LineButton plus className="mt-4" onClick={handleAddDay}>Add day</LineButton>
      </section>

      <EditorFooter isNew={Boolean(draft._isNew)} onCancel={handleCancel} onSave={handleSave} />
    </div>
  );
}
