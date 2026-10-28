import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, MoveLeft, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/shared';
import { getLogDate, sumNutritionLogCalories } from './nutritionLogUtils';
import { servingLabel, sortLedgerEntries, sourceLabel } from '@/lib/nutritionLedger';
import { moveNutritionGroup, nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { springs } from '@/lib/animations';
import { decodeMealComposition } from '@/lib/mealComposition';
import type { NutritionGroup } from '@/types';
import './fuel.css';

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

  const sortedLogs = (entries: NutritionLedgerEntry[]) => sortLedgerEntries(entries);

  const dropInto = (groupId: string | null) => {
    if (draggedId) onMove(draggedId, groupId);
    setDraggedId(null);
    setActiveDropId(null);
  };

  const renderEntry = (log: NutritionLedgerEntry, index: number) => {
    const provenance = sourceLabel(log.source);
    const composition = decodeMealComposition(log.food?.description);
    const name = log.food?.name || 'Unknown Food';
    const time = format(getLogDate(log), 'h:mm a');
    const kcal = Math.round((log.food?.calories || 0) * log.servings);
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
        className={`fuel-entry ${draggedId === log.id ? 'opacity-45' : ''}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: deletedId === log.id ? 0 : 1,
          x: deletedId === log.id ? 60 : 0,
          y: 0,
          height: deletedId === log.id ? 0 : 'auto',
        }}
        exit={{ opacity: 0, x: 60, height: 0 }}
        transition={{ ...springs.settle, delay: deletedId === log.id ? 0 : Math.min(index * 0.025, 0.2) }}
      >
        <div className="fuel-entry-row">
          <button
            type="button"
            className="fuel-entry-grip"
            aria-label={`Move ${log.food?.name || 'entry'}`}
            onClick={() => setMovingEntry(log)}
          >
            <GripVertical strokeWidth={1.5} />
          </button>

          {/* The row itself edits the entry. */}
          <button type="button" className="fuel-entry-main" onClick={() => onEdit(log)} aria-label={`Edit entry: ${name}, ${time}, ${kcal} kcal`}>
            <span className="min-w-0">
              <span className="fuel-entry-name">{name}</span>
              <span className="fuel-entry-detail">
                {time}
                <span className="metal-sep" aria-hidden>·</span>{servingLabel(log)}
                <span className="metal-sep" aria-hidden>·</span><span className="whitespace-nowrap">{Math.round((log.food?.protein || 0) * log.servings)} g P</span>
                <span className="metal-sep" aria-hidden>·</span><span className="whitespace-nowrap">{provenance}</span>
              </span>
            </span>
            <span className="fuel-entry-kcal">
              {kcal.toLocaleString()}<small>kcal</small>
            </span>
          </button>

          <div className="fuel-entry-actions">
            {onMoveToPreviousDay && (
              <button
                type="button"
                className="fuel-icon-btn is-quiet"
                onClick={() => onMoveToPreviousDay(log.id)}
                aria-label="Move to yesterday"
                title="Move to yesterday"
              >
                <MoveLeft strokeWidth={1.5} />
              </button>
            )}
            <button type="button" className="fuel-icon-btn is-quiet is-danger" onClick={() => onDelete(log.id)} aria-label={`Remove entry: ${name}`}>
              <X strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {composition && (
          <details className="fuel-ingredients">
            <summary>
              {composition.ingredients.length} ingredient{composition.ingredients.length === 1 ? '' : 's'}
              <ChevronDown strokeWidth={1.5} aria-hidden />
            </summary>
            <ul>
              {composition.ingredients.map((ingredient) => {
                const servings = ingredient.servings * log.servings;
                return (
                  <li key={ingredient.id} className="fuel-ingredient">
                    <div className="min-w-0">
                      <p className="fuel-ingredient-name">{ingredient.food.name}</p>
                      <p className="fuel-ingredient-detail">
                        {servingLabel({ food: ingredient.food, servings })}
                        <span className="text-[var(--metal-ink-3)]"> · </span>
                        {Math.round(ingredient.food.protein * servings)} g P · {Math.round(ingredient.food.carbs * servings)} g C · {Math.round(ingredient.food.fat * servings)} g F
                      </p>
                    </div>
                    <span className="fuel-ingredient-kcal">{Math.round(ingredient.food.calories * servings)} kcal</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
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
        aria-label={title}
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
        className={`fuel-group transition-colors ${activeDropId === dropId ? 'is-drop-target' : ''}`}
      >
        <div className="fuel-group-head">
          <h3 className="min-w-0">
            <span className="fuel-group-title">{title}</span>
            <span className="fuel-group-count">{entries.length}</span>
          </h3>
          <div className="fuel-group-right">
            {group && (
              <div className="fuel-group-tools">
                <button
                  type="button"
                  className="fuel-icon-btn is-quiet"
                  disabled={!moveNutritionGroup(orderedGroups, group.id, -1)}
                  onClick={() => onReorderGroup(group.id, -1)}
                  aria-label={`Move ${title} earlier`}
                >
                  <ArrowUp strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="fuel-icon-btn is-quiet"
                  disabled={!moveNutritionGroup(orderedGroups, group.id, 1)}
                  onClick={() => onReorderGroup(group.id, 1)}
                  aria-label={`Move ${title} later`}
                >
                  <ArrowDown strokeWidth={1.5} />
                </button>
                {!group.label && (
                  <button type="button" className="fuel-icon-btn is-quiet is-danger" onClick={() => onDeleteGroup(group)} aria-label={`Delete ${title}`}>
                    <Trash2 strokeWidth={1.5} />
                  </button>
                )}
              </div>
            )}
            <span className="fuel-group-kcal">
              {totalCalories.toLocaleString()} kcal
            </span>
          </div>
        </div>
        {entries.length > 0 ? (
          <ul><AnimatePresence>{sortedLogs(entries).map(renderEntry)}</AnimatePresence></ul>
        ) : (
          <button
            type="button"
            className="fuel-group-empty"
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
      <div>
        {(unassigned.length > 0 || draggedId) && renderDropSection(null, unassigned)}
        {orderedGroups.map((group) => renderDropSection(group, logs.filter((log) => log.group_id === group.id)))}
      </div>

      <Modal isOpen={!!movingEntry} onClose={() => setMovingEntry(null)} title="Move food">
        <div className="pb-2">
          {[
            { id: null, label: 'Unassigned' },
            ...orderedGroups.map((group) => ({ id: group.id, label: nutritionGroupLabel(group, orderedGroups) })),
          ].map((destination) => {
            const current = (movingEntry?.group_id || null) === destination.id;
            return (
              <button
                key={destination.id || 'inbox'}
                type="button"
                className="fuel-option"
                onClick={() => {
                  if (movingEntry) onMove(movingEntry.id, destination.id);
                  setMovingEntry(null);
                }}
              >
                <span className="metal-row-title">{destination.label}</span>
                <span className={`fuel-option-value${current ? ' is-current' : ''}`}>
                  {current ? 'Current' : 'Move'}
                </span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
