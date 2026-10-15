import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type PointerActivationConstraint,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { commitFocusedField } from '@/lib/commitFocusedField';
import { selectionHaptic, selectionHapticEnd, selectionHapticStart, tapHaptic } from '@/lib/haptics';
import '@/components/split/program.css';
import './split-editor.css';

/**
 * Mouse and pen drag after a small move. Touch is left to the TouchSensor's
 * press-and-hold, so a swipe over a handle scrolls instead of dragging.
 */
class MouseAndPenSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
      nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== 'touch',
  }];
}

const POINTER: PointerActivationConstraint = { distance: 4 };
const PRESS_AND_HOLD: PointerActivationConstraint = { delay: 200, tolerance: 6 };
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * A vertical list reordered by dragging each item's handle: press and hold on
 * touch, drag with a mouse, or Space/arrows/Space from the keyboard.
 */
export function SortableList({
  ids,
  onMove,
  describe,
  children,
}: {
  ids: string[];
  /** Called once per drop that changed the order. */
  onMove: (activeId: string, overId: string) => void;
  /** Spoken name of an item, for screen reader announcements. */
  describe: (id: string) => string;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: POINTER }),
    useSensor(TouchSensor, { activationConstraint: PRESS_AND_HOLD }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // The live region has to sit inside the open sheet: everything else is inert.
  const [region, setRegion] = useState<HTMLDivElement | null>(null);
  const [sorting, setSorting] = useState(false);

  const announcements = useMemo<Announcements>(() => {
    const position = (id: string | number) => ids.indexOf(String(id)) + 1;
    return {
      onDragStart: ({ active }) => `Picked up ${describe(String(active.id))}, position ${position(active.id)} of ${ids.length}.`,
      onDragOver: ({ active, over }) => (over
        ? `${describe(String(active.id))} is at position ${position(over.id)} of ${ids.length}.`
        : `${describe(String(active.id))} is no longer over the list.`),
      onDragEnd: ({ active, over }) => (over
        ? `${describe(String(active.id))} dropped at position ${position(over.id)} of ${ids.length}.`
        : `${describe(String(active.id))} dropped.`),
      onDragCancel: ({ active }) => `Moving ${describe(String(active.id))} cancelled.`,
    };
  }, [describe, ids]);

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setSorting(false);
    selectionHapticEnd();
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
  }, [onMove]);

  return (
    <div ref={setRegion} className="split-sortable-list" data-sorting={sorting || undefined}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        accessibility={{
          container: region ?? undefined,
          announcements,
          screenReaderInstructions: {
            draggable: 'To reorder, press Space, use the arrow keys to move, and press Space again to drop. Escape cancels. Supersets move together.',
          },
        }}
        onDragStart={() => {
          // A name being typed commits before its row moves.
          commitFocusedField();
          setSorting(true);
          tapHaptic();
          selectionHapticStart();
        }}
        onDragOver={({ over }) => { if (over) selectionHaptic(); }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setSorting(false);
          selectionHapticEnd();
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    </div>
  );
}

type HandleContext = ReturnType<typeof useSortable> & { label: string };
const SortableHandleContext = createContext<HandleContext | null>(null);

/** One draggable item; its <DragHandle> starts the drag. */
export function SortableItem({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const sortable = useSortable({ id });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  return (
    <div
      ref={setNodeRef}
      className="split-sortable"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <SortableHandleContext.Provider value={{ ...sortable, label }}>
        <div className="split-sortable-body">{children}</div>
      </SortableHandleContext.Provider>
    </div>
  );
}

export function DragHandle() {
  const sortable = useContext(SortableHandleContext);
  if (!sortable) return null;
  const { attributes, listeners, setActivatorNodeRef, label } = sortable;
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="split-drag-handle"
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${label}`}
      title="Hold and drag to reorder"
    >
      <GripVertical className="w-4 h-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}
