import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, MoveLeft, Pencil, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/shared';
import { getLogDate, getLogTimestamp, sumNutritionLogCalories } from './nutritionLogUtils';
import { moveNutritionGroup, nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { springs } from '@/lib/animations';
import { decodeMealComposition } from '@/lib/mealComposition';
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
    description?: string | null;
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
  /** Present only on entries eligible for it; absent hides the control. */
  onMoveToPreviousDay?: (id: string) => void;
  onReorderGroup: (groupId: string, direction: -1 | 1) => void;
  onDeleteGroup: (group: NutritionGroup) => void;
}

function sourceLabel(source?: string): string {
  if (source === 'meal_builder') return 'Meal';
  if (!source || source === 'manual') return 'Manual';
  if (source === 'usda') return 'USDA';
  if (source === 'cronometer_csv') return 'Cronometer';
  if (source === 'photo_openai') return 'OpenAI photo';
  if (source === 'photo_anthropic') return 'Claude photo';
  if (source === 'gemini_label') return 'Gemini · label reviewed';
  if (source === 'gemini_estimate' || source === 'gemini_trial') return 'Gemini estimate';
  if (source === 'barcode_fatsecret') return 'FatSecret';
  if (source === 'barcode_open_food_facts') return 'Open Food Facts';
  if (source === 'barcode') return 'Barcode';
  return 'Manual';
}

function servingLabel(log: Pick<NutritionLedgerEntry, 'food' | 'servings'>): string {
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
  onMoveToPreviousDay,
  onReorderGroup,
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
    const composition = decodeMealComposition(log.food?.description);
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
        className={`grid grid-cols-[2.75rem_minmax(0,1fr)] items-start py-2 border-t border-[var(--color-border)] ${draggedId === log.id ? 'opacity-45' : ''}`}
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
          className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] cursor-grab active:cursor-grabbing"
          aria-label={`Move ${log.food?.name || 'entry'}`}
          onClick={() => setMovingEntry(log)}
        >
          <GripVertical className="w-4 h-4" strokeWidth={1.5} />
        </button>

        <div className="min-w-0">
          <div className="flex items-center justify-between min-h-11">
            <span className="t-data-sm text-[var(--color-muted)]">
              {format(getLogDate(log), 'h:mm a')}
            </span>
            <div className="flex shrink-0">
              {onMoveToPreviousDay && (
                <button
                  type="button"
                  className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                  onClick={() => onMoveToPreviousDay(log.id)}
                  aria-label="Move to yesterday"
                  title="Move to yesterday"
                >
                  <MoveLeft className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
              )}
              <button type="button" className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)]" onClick={() => onEdit(log)} aria-label="Edit entry">
                <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button type="button" className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-accent)]" onClick={() => onDelete(log.id)} aria-label="Remove entry">
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 pb-3">
            <div className="min-w-0">
              <p className="t-body font-medium leading-snug text-[var(--color-text)] break-words">{log.food?.name || 'Unknown Food'}</p>
              <p className="t-data-sm leading-relaxed text-[var(--color-muted)] mt-1">
                {servingLabel(log)} <span className="whitespace-nowrap">· {Math.round((log.food?.protein || 0) * log.servings)}g P</span>
                <span className="text-[var(--color-text-dim)] whitespace-nowrap"> · {provenance}</span>
              </p>
            </div>
            <span className="flex items-baseline gap-1 shrink-0">
              <span className="t-data text-[var(--color-text)]">{Math.round((log.food?.calories || 0) * log.servings)}</span>
              <span className="t-caption text-[var(--color-text-dim)]">kcal</span>
            </span>
          </div>
          {composition && (
            <details className="group border-t border-[var(--color-border)]">
              <summary className="pressable flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[var(--color-muted)] [&::-webkit-details-marker]:hidden">
                <span className="t-caption">{composition.ingredients.length} ingredient{composition.ingredients.length === 1 ? '' : 's'}</span>
                <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" strokeWidth={1.5} />
              </summary>
              <ul className="pb-2">
                {composition.ingredients.map((ingredient) => {
                  const servings = ingredient.servings * log.servings;
                  return (
                    <li key={ingredient.id} className="flex items-start justify-between gap-3 border-t border-[var(--color-border)] py-3">
                      <div className="min-w-0">
                        <p className="t-body break-words text-[var(--color-text)]">{ingredient.food.name}</p>
                        <p className="t-data-sm mt-1 text-[var(--color-muted)]">
                          {servingLabel({ food: ingredient.food, servings })}
                        </p>
                        <p className="t-data-sm mt-1 text-[var(--color-text-dim)]">
                          {Math.round(ingredient.food.protein * servings)}g P · {Math.round(ingredient.food.carbs * servings)}g C · {Math.round(ingredient.food.fat * servings)}g F
                        </p>
                      </div>
                      <span className="t-data-sm shrink-0 text-[var(--color-muted)]">{Math.round(ingredient.food.calories * servings)} kcal</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      </motion.li>
    );
  };

  const renderDropSection = (group: NutritionGroup | null, entries: NutritionLedgerEntry[]) => {
    const dropId = group?.id || 'inbox';
    const title = group ? nutritionGroupLabel(group, orderedGroups) : 'Unassigned';
    const totalCalories = Math.round(sumNutritionLogCalories(entries));
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
        className={`mt-6 border-t ${activeDropId === dropId ? 'border-[var(--color-border)] material-surface' : 'border-[var(--color-border)]'} transition-colors`}
      >
        <div className="flex items-center justify-between gap-2 py-3">
          <div className="min-w-0">
            <span className="t-heading">{title}</span>
            <span className="t-data-sm text-[var(--color-muted)] ml-2">{entries.length}</span>
          </div>
          <div className="flex shrink-0 items-center">
            {group && (
              <div className="flex items-center">
                <button
                  type="button"
                  className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] disabled:opacity-25"
                  disabled={!moveNutritionGroup(orderedGroups, group.id, -1)}
                  onClick={() => onReorderGroup(group.id, -1)}
                  aria-label={`Move ${title} earlier`}
                >
                  <ArrowUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] disabled:opacity-25"
                  disabled={!moveNutritionGroup(orderedGroups, group.id, 1)}
                  onClick={() => onReorderGroup(group.id, 1)}
                  aria-label={`Move ${title} later`}
                >
                  <ArrowDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
                {!group.label && (
                  <button type="button" className="pressable flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-accent)]" onClick={() => onDeleteGroup(group)} aria-label={`Delete ${title}`}>
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            )}
            <span className="t-data-sm min-w-[4.5rem] text-right text-[var(--color-text-dim)] whitespace-nowrap">
              {totalCalories.toLocaleString()} kcal
            </span>
          </div>
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
      {(unassigned.length > 0 || draggedId) && renderDropSection(null, unassigned)}
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
