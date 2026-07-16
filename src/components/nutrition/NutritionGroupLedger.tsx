import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { GripVertical, Pencil, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/shared';
import { getLogDate, getLogTimestamp } from './nutritionLogUtils';
import { nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { springs } from '@/lib/animations';
import type { NutritionGroup } from '@/types';

export interface NutritionLedgerEntry {
  id: string;
  date: string;
  logged_at: string | null;
  created_at?: string | null;
  servings: number;
  group_id?: string | null;
  sort_order?: number;
  source?: string;
  food: {
    name: string;
    calories: number;
    protein: number;
    serving_size?: number;
    serving_unit?: string;
  } | null;
}

interface NutritionGroupLedgerProps {
  logs: NutritionLedgerEntry[];
  groups: NutritionGroup[];
  deletedId: string | null;
  onEdit: (entry: NutritionLedgerEntry) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, groupId: string | null) => void;
  onDeleteGroup: (group: NutritionGroup) => void;
}

function sourceLabel(source?: string): string | null {
  if (source === 'cronometer_csv') return 'Cronometer';
  if (source === 'photo_openai') return 'OpenAI photo';
  if (source === 'photo_anthropic') return 'Claude photo';
  if (source === 'barcode') return 'Barcode';
  return null;
}

function servingLabel(log: NutritionLedgerEntry): string {
  const unit = log.food?.serving_unit?.trim();
  const servingSize = Number(log.food?.serving_size) || 1;
  if (unit && unit.toLowerCase() !== 'serving') {
    const amount = Math.round(servingSize * log.servings * 100) / 100;
    return `${amount} ${unit}`;
  }
  return `${log.servings} serving${log.servings !== 1 ? 's' : ''}`;
}

export function NutritionGroupLedger({
  logs,
  groups,
  deletedId,
  onEdit,
  onDelete,
  onMove,
  onDeleteGroup,
}: NutritionGroupLedgerProps) {
  const [movingEntry, setMovingEntry] = useState<NutritionLedgerEntry | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [activeDropId, setActiveDropId] = useState<string | null>(null);
  const orderedGroups = useMemo(() => sortNutritionGroups(groups), [groups]);

  const sortedLogs = (entries: NutritionLedgerEntry[]) => [...entries].sort((a, b) => (
    (a.sort_order || 0) - (b.sort_order || 0) || getLogTimestamp(a) - getLogTimestamp(b)
  ));

  const dropInto = (groupId: string | null) => {
    if (draggedId) onMove(draggedId, groupId);
    setDraggedId(null);
    setActiveDropId(null);
  };

  const renderEntry = (log: NutritionLedgerEntry, index: number) => {
    const provenance = sourceLabel(log.source);
    return (
      <motion.li
        key={log.id}
        draggable
        onDragStart={(event) => {
          const dragEvent = event as unknown as React.DragEvent<HTMLLIElement>;
          dragEvent.dataTransfer.effectAllowed = 'move';
          dragEvent.dataTransfer.setData('text/plain', log.id);
          setDraggedId(log.id);
        }}
        onDragEnd={() => {
          setDraggedId(null);
          setActiveDropId(null);
        }}
        className={`flex items-center gap-2 py-4 border-t border-[var(--color-border)] ${draggedId === log.id ? 'opacity-45' : ''}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: deletedId === log.id ? 0 : 1,
          x: deletedId === log.id ? 60 : 0,
          y: 0,
          height: deletedId === log.id ? 0 : 'auto',
        }}
        exit={{ opacity: 0, x: 60, height: 0 }}
        transition={{ ...springs.smooth, delay: deletedId === log.id ? 0 : Math.min(index * 0.025, 0.2) }}
      >
        <button
          type="button"
          className="pressable p-2 -ml-2 text-[var(--color-muted)] cursor-grab active:cursor-grabbing"
          aria-label={`Move ${log.food?.name || 'entry'}`}
          onClick={() => setMovingEntry(log)}
        >
          <GripVertical className="w-4 h-4" strokeWidth={1.5} />
        </button>

        <span className="t-data-sm text-[var(--color-muted)] w-14 shrink-0">
          {format(getLogDate(log), 'h:mm a')}
        </span>

        <div className="flex-1 min-w-0">
          <p className="t-body font-medium text-[var(--color-text)] truncate">{log.food?.name || 'Unknown Food'}</p>
          <p className="t-data-sm text-[var(--color-muted)] mt-0.5">
            {servingLabel(log)} · {Math.round((log.food?.protein || 0) * log.servings)}g P
            {provenance && <span className="text-[var(--color-text-dim)]"> · {provenance}</span>}
          </p>
        </div>

        <span className="flex items-baseline gap-1 shrink-0">
          <span className="number-medium text-[var(--color-text)]">{Math.round((log.food?.calories || 0) * log.servings)}</span>
          <span className="[font-family:var(--font-display)] italic text-xs text-[var(--color-text-dim)]">kcal</span>
        </span>

        <div className="flex shrink-0 -mr-2">
          <button type="button" className="pressable p-2 text-[var(--color-muted)]" onClick={() => onEdit(log)} aria-label="Edit entry">
            <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
          <button type="button" className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)]" onClick={() => onDelete(log.id)} aria-label="Remove entry">
            <X className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </motion.li>
    );
  };

  const renderDropSection = (group: NutritionGroup | null, entries: NutritionLedgerEntry[]) => {
    const dropId = group?.id || 'inbox';
    const title = group ? nutritionGroupLabel(group, orderedGroups) : 'Unassigned';
    return (
      <section
        key={dropId}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setActiveDropId(dropId);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveDropId(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!draggedId) setDraggedId(event.dataTransfer.getData('text/plain') || null);
          const movingId = draggedId || event.dataTransfer.getData('text/plain');
          if (movingId) onMove(movingId, group?.id || null);
          setDraggedId(null);
          setActiveDropId(null);
        }}
        className={`mt-6 border-t ${activeDropId === dropId ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]' : 'border-[var(--color-text)]'} transition-colors`}
      >
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <span className="t-heading">{title}</span>
            <span className="t-data-sm text-[var(--color-muted)] ml-2">{entries.length}</span>
          </div>
          {group && (
            <button type="button" className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-accent)]" onClick={() => onDeleteGroup(group)} aria-label={`Delete ${title}`}>
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>
        {entries.length > 0 ? (
          <ul><AnimatePresence>{sortedLogs(entries).map(renderEntry)}</AnimatePresence></ul>
        ) : (
          <button
            type="button"
            className="w-full py-5 border-t border-[var(--color-border)] t-caption text-left"
            onClick={() => draggedId && dropInto(group?.id || null)}
          >
            Drag food here or use its move handle.
          </button>
        )}
      </section>
    );
  };

  const unassigned = logs.filter((log) => !log.group_id || !orderedGroups.some((group) => group.id === log.group_id));

  return (
    <>
      {renderDropSection(null, unassigned)}
      {orderedGroups.map((group) => renderDropSection(group, logs.filter((log) => log.group_id === group.id)))}

      <Modal isOpen={!!movingEntry} onClose={() => setMovingEntry(null)} title="Move food">
        <div className="space-y-px">
          {[
            { id: null, label: 'Unassigned' },
            ...orderedGroups.map((group) => ({ id: group.id, label: nutritionGroupLabel(group, orderedGroups) })),
          ].map((destination) => (
            <button
              key={destination.id || 'inbox'}
              type="button"
              className="pressable w-full flex items-center justify-between py-4 border-t border-[var(--color-border)] text-left"
              onClick={() => {
                if (movingEntry) onMove(movingEntry.id, destination.id);
                setMovingEntry(null);
              }}
            >
              <span className="t-heading">{destination.label}</span>
              <span className="t-data-sm text-[var(--color-muted)]">
                {(movingEntry?.group_id || null) === destination.id ? 'Current' : 'Move'}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
