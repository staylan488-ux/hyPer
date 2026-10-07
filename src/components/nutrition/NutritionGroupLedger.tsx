import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, MoveLeft, Plus, Trash2, X } from 'lucide-react';
import './nutrition-ledger.css';
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
  /** Edit mode reveals move, reorder and delete controls; rows stay tappable to edit. */
  editing?: boolean;
  onDelete: (id: string) => void;
  onMove: (id: string, groupId: string | null) => void;
  /** Present only on entries eligible for it; absent hides the control. */
  onMoveToPreviousDay?: (id: string) => void;
  onReorderGroup: (groupId: string, direction: -1 | 1) => void;
  /** Log food straight into a meal from its empty row. */
  onAddToGroup?: (groupId: string) => void;
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
  editing = false,
  onEdit,
  onDelete,
  onMove,
  onMoveToPreviousDay,
  onReorderGroup,
  onDeleteGroup,
  onAddToGroup,
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

  const confirmDelete = (log: NutritionLedgerEntry) => {
    if (!window.confirm(`Delete ${log.food?.name || 'this entry'} from your log?`)) return;
    onDelete(log.id);
  };

  const renderEntry = (log: NutritionLedgerEntry, index: number) => {
    const provenance = sourceLabel(log.source);
    const showProvenance = provenance !== 'Manual';
    const composition = decodeMealComposition(log.food?.description);
    const name = log.food?.name || 'Unknown Food';
    const calories = Math.round((log.food?.calories || 0) * log.servings);
    const protein = Math.round((log.food?.protein || 0) * log.servings);
    const time = format(getLogDate(log), 'h:mm a');
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
        className="fuel-entry"
        data-dragging={draggedId === log.id || undefined}
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
          {/* The whole row opens the editor; move and delete live in Edit mode. */}
          <button type="button" className="fuel-entry-main" onClick={() => onEdit(log)}
            aria-label={`Edit ${name}, ${calories} kcal, ${time}`}>
            <span className="fuel-entry-line">
              <span className="fuel-entry-name">{name}</span>
              {!editing && <span className="fuel-entry-kcal">{calories}<span> kcal</span></span>}
            </span>
            <span className="fuel-entry-caption">
              {time} · {servingLabel(log)} · <span className="whitespace-nowrap">{protein}g P</span>
              {showProvenance && <> · <span className="whitespace-nowrap">{provenance}</span></>}
            </span>
          </button>
          {editing && (
            <div className="fuel-tools">
              {onMoveToPreviousDay && (
                <button type="button" className="fuel-tool" onClick={() => onMoveToPreviousDay(log.id)}
                  aria-label={`Move ${name} to yesterday`} title="Move to yesterday">
                  <MoveLeft size={15} strokeWidth={1.5} aria-hidden />
                </button>
              )}
              <button type="button" className="fuel-tool cursor-grab active:cursor-grabbing" aria-label={`Move ${name}`}
                onClick={() => setMovingEntry(log)}>
                <GripVertical size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button type="button" className="fuel-tool" onClick={() => confirmDelete(log)} aria-label={`Delete ${name}`}>
                <X size={15} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          )}
        </div>
        {composition && (
          <details className="fuel-entry-composition group">
            <summary>
              <span>{composition.ingredients.length} ingredient{composition.ingredients.length === 1 ? '' : 's'}</span>
              <ChevronDown size={14} strokeWidth={1.5} className="shrink-0 group-open:rotate-180" aria-hidden />
            </summary>
            <ul>
              {composition.ingredients.map((ingredient) => {
                const servings = ingredient.servings * log.servings;
                return (
                  <li key={ingredient.id}>
                    <div className="min-w-0">
                      <p className="fuel-ingredient-name">{ingredient.food.name}</p>
                      <p className="fuel-entry-caption">
                        {servingLabel({ food: ingredient.food, servings })} · {Math.round(ingredient.food.protein * servings)}g P · {Math.round(ingredient.food.carbs * servings)}g C · {Math.round(ingredient.food.fat * servings)}g F
                      </p>
                    </div>
                    <span className="fuel-entry-caption shrink-0">{Math.round(ingredient.food.calories * servings)} kcal</span>
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
        className="fuel-meal"
        data-drop-active={activeDropId === dropId || undefined}
      >
        <div className="fuel-meal-head">
          <h3 className="fuel-meal-title">
            {title}
            {/* An empty meal says so once, below ("Nothing logged."). */}
            {/* A dot keeps the count apart from a name ending in a numeral
                ("Snack 1 · 2", never "Snack 12"). */}
            {entries.length > 0 && <span className="fuel-meal-count"><span aria-hidden>· </span>{entries.length}</span>}
          </h3>
          {editing && group ? (
            // Fixed slots: earlier, later, delete. A meal that can't be deleted keeps its slot empty.
            <div className="fuel-tools">
              <button
                type="button"
                className="fuel-tool"
                disabled={!moveNutritionGroup(orderedGroups, group.id, -1)}
                onClick={() => onReorderGroup(group.id, -1)}
                aria-label={`Move ${title} earlier`}
              >
                <ArrowUp size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className="fuel-tool"
                disabled={!moveNutritionGroup(orderedGroups, group.id, 1)}
                onClick={() => onReorderGroup(group.id, 1)}
                aria-label={`Move ${title} later`}
              >
                <ArrowDown size={15} strokeWidth={1.5} aria-hidden />
              </button>
              {!group.label ? (
                <button type="button" className="fuel-tool" onClick={() => onDeleteGroup(group)} aria-label={`Delete ${title}`}>
                  <Trash2 size={15} strokeWidth={1.5} aria-hidden />
                </button>
              ) : <span className="fuel-tool" aria-hidden />}
            </div>
          ) : entries.length > 0 ? (
            <span className="fuel-meal-kcal">{totalCalories.toLocaleString()} kcal</span>
          ) : null}
        </div>
        {entries.length > 0 ? (
          <ul><AnimatePresence>{sortedLogs(entries).map(renderEntry)}</AnimatePresence></ul>
        ) : group && onAddToGroup && !editing && !draggedId ? (
          <div className="fuel-meal-empty fuel-meal-empty-add">
            <span>Nothing logged.</span>
            <button type="button" className="text-action" onClick={() => onAddToGroup(group.id)}>
              <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden />
              Add to {title}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="fuel-meal-empty"
            onClick={() => draggedId && dropInto(group?.id || null)}
          >
            {editing || draggedId ? 'Move food here with its handle.' : 'Nothing logged.'}
          </button>
        )}
      </section>
    );
  };

  const unassigned = logs.filter((log) => !log.group_id || !orderedGroups.some((group) => group.id === log.group_id));

  return (
    <>
      <div className="fuel-ledger">
        {(unassigned.length > 0 || draggedId) && renderDropSection(null, unassigned)}
        {orderedGroups.map((group) => renderDropSection(group, logs.filter((log) => log.group_id === group.id)))}
      </div>

      <Modal isOpen={!!movingEntry} onClose={() => setMovingEntry(null)} title="Move food">
        <div className="platter platter-flush mb-2">
          {[
            { id: null, label: 'Unassigned' },
            ...orderedGroups.map((group) => ({ id: group.id, label: nutritionGroupLabel(group, orderedGroups) })),
          ].map((destination) => (
            <button
              key={destination.id || 'inbox'}
              type="button"
              className="platter-row pressable w-full min-h-11 flex items-center justify-between gap-4 px-5 py-4 text-left"
              onClick={() => {
                if (movingEntry) onMove(movingEntry.id, destination.id);
                setMovingEntry(null);
              }}
            >
              <span className="t-heading">{destination.label}</span>
              <span className={`t-label-sm shrink-0 ${(movingEntry?.group_id || null) === destination.id ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                {(movingEntry?.group_id || null) === destination.id ? 'Current' : 'Move'}
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
