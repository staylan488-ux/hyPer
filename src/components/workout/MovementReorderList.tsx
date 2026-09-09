import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical } from 'lucide-react';
import { tapHaptic } from '@/lib/haptics';
import { movementBlocks, movementScrollSpeed, moveMovementBlock, type ReorderMovement } from './movementOrder';
import './movement-reorder.css';

type DragContext = {
  available: boolean;
  busy: boolean;
  activeId: string | null;
  instructionsId: string;
  pointerDown: (id: string, event: PointerEvent<HTMLButtonElement>) => void;
  keyDown: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
};
const MovementDragContext = createContext<DragContext | null>(null);

type RowBox = { node: HTMLElement; top: number; height: number };
type DragSession = {
  id: string;
  pointerId: number | null;
  pointerY: number;
  startY: number;
  grabOffset: number;
  moved: boolean;
  originalTop: number;
  order: string[];
  blocks: string[][];
  destination: number;
  rows: Map<string, RowBox>;
  centers: number[];
  scroller: HTMLElement | null;
  initialScrollTop: number;
  gap: number;
  left: number;
  width: number;
  names: string[];
  handle: HTMLButtonElement;
  frame: number;
  cleanup: () => void;
};

function dragPosition(session: DragSession) {
  const first = session.blocks.find((block) => block.includes(session.id))?.[0] ?? session.id;
  return session.order.indexOf(first) + 1;
}

/** Drag only from a handle: scrolling, text entry and movement disclosure stay independent. */
export function MovementReorderList({ items, onReorder, children }: {
  items: ReorderMovement[];
  onReorder: (ids: string[]) => Promise<void>;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const itemsRef = useRef(items);
  useLayoutEffect(() => { itemsRef.current = items; }, [items]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ left: number; width: number; top: number; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const instructionsId = useId();
  const available = movementBlocks(items).length > 1;

  const restoreFocus = useCallback((session: DragSession, restoreScroll: boolean) => {
    requestAnimationFrame(() => {
      if (!mounted.current || !session.handle.isConnected) return;
      const scroller = session.scroller;
      if (scroller) {
        if (restoreScroll) scroller.scrollTop = session.initialScrollTop;
        const viewport = scroller.getBoundingClientRect();
        const handle = session.handle.getBoundingClientRect();
        if (handle.top < viewport.top) scroller.scrollTop += handle.top - viewport.top - 12;
        else if (handle.bottom > viewport.bottom) scroller.scrollTop += handle.bottom - viewport.bottom + 12;
      }
      session.handle.focus({ preventScroll: true });
    });
  }, []);

  const clearVisuals = useCallback(() => {
    const session = sessionRef.current;
    if (session) {
      cancelAnimationFrame(session.frame);
      session.cleanup();
      for (const { node } of session.rows.values()) {
        node.style.removeProperty('--movement-drag-offset');
        node.removeAttribute('data-drag-source');
      }
    }
    sessionRef.current = null;
    setActiveId(null);
    setGhost(null);
  }, []);

  const finish = useCallback((cancel: boolean) => {
    const session = sessionRef.current;
    if (!session || busyRef.current) return;
    cancelAnimationFrame(session.frame);
    session.cleanup();
    const original = itemsRef.current.map((item) => item.id);
    const changed = session.order.some((id, index) => id !== original[index]);
    if (cancel || !changed) {
      clearVisuals();
      setMessage(cancel ? 'Reordering cancelled.' : 'Order unchanged.');
      restoreFocus(session, true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage('Saving movement order…');
    // Keep the preview positions until persistence settles; write only once per drop.
    for (const { node } of session.rows.values()) node.removeAttribute('data-drag-source');
    let failed = false;
    void onReorder(session.order).then(() => {
      if (mounted.current) setMessage(`${session.names.join(' and ')} moved to position ${dragPosition(session)}.`);
    }).catch(() => {
      failed = true;
      if (mounted.current) {
        setError(true);
        setMessage('Could not save the order. Your previous order is restored. Drag again to retry.');
      }
    }).finally(() => {
      if (!mounted.current) return;
      busyRef.current = false;
      setBusy(false);
      clearVisuals();
      restoreFocus(session, failed);
    });
  }, [clearVisuals, onReorder, restoreFocus]);

  const place = useCallback((session: DragSession, destination: number) => {
    session.destination = destination;
    session.order = moveMovementBlock(session.blocks, session.id, destination);
    let top = Math.min(...Array.from(session.rows.values(), (row) => row.top));
    for (const id of session.order) {
      const row = session.rows.get(id);
      if (!row) continue;
      row.node.style.setProperty('--movement-drag-offset', `${top - row.top}px`);
      top += row.height + session.gap;
    }
  }, []);

  const begin = useCallback((id: string, handle: HTMLButtonElement, pointerId: number | null, pointerY: number) => {
    if (sessionRef.current || busyRef.current || !listRef.current) return;
    const blocks = movementBlocks(itemsRef.current);
    if (blocks.length < 2) return;
    const source = blocks.find((block) => block.includes(id));
    const node = handle.closest<HTMLElement>('[data-movement-reorder-id]');
    if (!source || !node) return;
    const bounds = node.getBoundingClientRect();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('input, textarea')) focused.blur();
    handle.focus({ preventScroll: true });
    const session: DragSession = {
      id, pointerId, pointerY, startY: pointerY, grabOffset: 0, moved: false, originalTop: bounds.top,
      order: itemsRef.current.map((item) => item.id), blocks,
      destination: blocks.indexOf(source), rows: new Map(), centers: [],
      scroller: node.closest<HTMLElement>('[data-app-scroll-viewport]'),
      initialScrollTop: node.closest<HTMLElement>('[data-app-scroll-viewport]')?.scrollTop ?? 0,
      gap: 0, left: bounds.left, width: bounds.width,
      names: source.map((member) => itemsRef.current.find((item) => item.id === member)?.name ?? 'Movement'),
      handle, frame: 0, cleanup: () => {},
    };
    sessionRef.current = session;
    setError(false);
    setActiveId(id);
    if (pointerId !== null) setGhost({ left: session.left, width: session.width, top: pointerY - 28, names: session.names });
    setMessage(`${session.names.join(' and ')} picked up. Move to a new position; Escape cancels.`);
    tapHaptic();
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      event.preventDefault();
      session.pointerY = event.clientY;
      if (Math.abs(event.clientY - session.startY) > 4) session.moved = true;
    };
    const up = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== session.pointerId) return;
      // A quick release can arrive before the next frame; include its final position.
      if (session.rows.size && (session.moved || Math.abs(event.clientY - session.startY) > 4)) {
        const y = event.clientY + session.grabOffset + (session.scroller?.scrollTop ?? 0);
        place(session, session.centers.filter((center) => y > center).length);
      }
      finish(false);
    };
    const cancel = () => finish(true);
    const width = window.innerWidth;
    const resize = () => { if (window.innerWidth !== width) finish(true); };
    const visibility = () => { if (document.hidden) finish(true); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(true); }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('keydown', key);
    session.cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('keydown', key);
    };
  }, [finish, place]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    const list = listRef.current;
    if (!activeId || !session || !list || session.rows.size) return;
    // Compact only the presentation during drag. Inputs remain mounted with their drafts.
    const nodes = Array.from(list.querySelectorAll<HTMLElement>('[data-movement-reorder-id]'));
    const source = nodes.find((node) => node.dataset.movementReorderId === session.id);
    if (!source) {
      const frame = requestAnimationFrame(() => finish(true));
      return () => cancelAnimationFrame(frame);
    }
    if (session.scroller) session.scroller.scrollTop += source.getBoundingClientRect().top - session.originalTop;
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      const id = node.dataset.movementReorderId!;
      session.rows.set(id, { node, top: box.top + (session.scroller?.scrollTop ?? 0), height: box.height });
      if (session.blocks.find((block) => block.includes(session.id))?.includes(id)) node.dataset.dragSource = 'true';
    }
    const rows = Array.from(session.rows.values());
    session.gap = rows.length > 1 ? Math.max(0, rows[1].top - rows[0].top - rows[0].height) : 0;
    const remaining = session.blocks.filter((block) => !block.includes(session.id));
    const sourceRows = session.blocks.find((block) => block.includes(session.id))!.map((id) => session.rows.get(id)!);
    session.grabOffset = (Math.min(...sourceRows.map((row) => row.top)) + Math.max(...sourceRows.map((row) => row.top + row.height))) / 2
      - session.pointerY - (session.scroller?.scrollTop ?? 0);
    session.centers = remaining.map((block) => {
      const boxes = block.map((id) => session.rows.get(id)).filter((row): row is RowBox => !!row);
      return (Math.min(...boxes.map((row) => row.top)) + Math.max(...boxes.map((row) => row.top + row.height))) / 2;
    });
    let previousFrame = performance.now();
    const tick = (time: number) => {
      if (sessionRef.current !== session || busyRef.current) return;
      const frameScale = Math.min(32, Math.max(0, time - previousFrame)) / (1000 / 60);
      previousFrame = time;
      if (session.pointerId !== null && session.moved) {
        const scroller = session.scroller;
        if (scroller) {
          const bounds = scroller.getBoundingClientRect();
          const rest = document.querySelector<HTMLElement>('.studio-rest-bar')?.getBoundingClientRect();
          const bottom = Math.min(bounds.bottom, window.visualViewport?.height ?? window.innerHeight, rest?.height ? rest.top : Infinity);
          scroller.scrollTop += movementScrollSpeed(session.pointerY, bounds.top, bottom) * frameScale;
        }
        const contentY = session.pointerY + session.grabOffset + (scroller?.scrollTop ?? 0);
        const destination = session.centers.filter((center) => contentY > center).length;
        place(session, destination);
        if (ghostRef.current) ghostRef.current.style.transform = `translateY(${session.pointerY - 28}px)`;
      }
      session.frame = requestAnimationFrame(tick);
    };
    session.frame = requestAnimationFrame(tick);
  }, [activeId, finish, place]);

  // Adding/removing/substituting a movement during a drag invalidates its measured order.
  const membership = items.map((item) => `${item.id}:${item.supersetGroupId ?? ''}`).sort().join('|');
  useEffect(() => {
    if (!sessionRef.current || busyRef.current) return;
    const frame = requestAnimationFrame(() => finish(true));
    return () => cancelAnimationFrame(frame);
  }, [membership, finish]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = sessionRef.current;
      if (session) { cancelAnimationFrame(session.frame); session.cleanup(); }
    };
  }, []);

  const keyDown = (id: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (busyRef.current) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (sessionRef.current) finish(false);
      else begin(id, event.currentTarget, null, 0);
      return;
    }
    const session = sessionRef.current;
    if (!session || session.pointerId !== null || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const destination = Math.max(0, Math.min(session.blocks.length - 1,
      event.key === 'Home' ? 0 : event.key === 'End' ? session.blocks.length - 1 : session.destination + (event.key === 'ArrowUp' ? -1 : 1)));
    place(session, destination);
    const row = session.rows.get(id);
    if (row && session.scroller) {
      const rect = session.scroller.getBoundingClientRect();
      // Read the destination, not the in-flight CSS transition's old position.
      const top = row.top + Number.parseFloat(row.node.style.getPropertyValue('--movement-drag-offset') || '0') - session.scroller.scrollTop;
      if (top < rect.top) session.scroller.scrollTop += top - rect.top - 12;
      else if (top + row.height > rect.bottom) session.scroller.scrollTop += top + row.height - rect.bottom + 12;
    }
    setMessage(`${session.names.join(' and ')} at position ${dragPosition(session)} of ${session.order.length}. Press Space to drop.`);
  };
  return (
    <MovementDragContext.Provider value={{ available, busy, activeId, instructionsId, keyDown, pointerDown: (id, event) => {
      if (event.button !== 0 || busyRef.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      begin(id, event.currentTarget, event.pointerId, event.clientY);
    } }}>
      <div ref={listRef} className={`studio-reorder-list${activeId ? ' is-reordering' : ''}`} aria-busy={busy}>
        <p id={instructionsId} className="sr-only">Drag to reorder. With a keyboard, press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel. Supersets move together.</p>
        <p className={error ? 'studio-reorder-error' : 'sr-only'} role={error ? 'alert' : 'status'} aria-live="polite">{message}</p>
        {children}
      </div>
      {activeId && !busy && ghost && createPortal(
        <div ref={ghostRef} className="material-glass studio-movement-drag-ghost" aria-hidden
          style={{ left: ghost.left, width: ghost.width, transform: `translateY(${ghost.top}px)` }}>
          <GripVertical size={18} />
          <div>{ghost.names.length > 1 && <span className="t-label-sm">Superset</span>}{ghost.names.map((name, index) => <p key={index}>{name}</p>)}</div>
        </div>, document.body)}
    </MovementDragContext.Provider>
  );
}

export function MovementDragHandle({ exerciseId, name, onIntent }: { exerciseId: string; name: string; onIntent: () => void }) {
  const drag = useContext(MovementDragContext);
  if (!drag?.available) return null;
  return <button type="button" className="studio-movement-drag-handle" aria-label={`Reorder ${name}`}
    aria-describedby={drag.instructionsId} aria-pressed={drag.activeId === exerciseId} aria-disabled={drag.busy}
    title="Drag to reorder" onPointerDown={(event) => { onIntent(); drag.pointerDown(exerciseId, event); }}
    onKeyDown={(event) => { onIntent(); drag.keyDown(exerciseId, event); }}><GripVertical size={18} aria-hidden /></button>;
}
