// @vitest-environment happy-dom
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The live workout's movement list (native/src/components/DragList.tsx) on a
// small model of Reanimated 4's two threads, as react-native-reanimated's
// mutables.native.ts and react-native-worklets' threads.native.ts behave:
// worklets (gesture callbacks, reactions, animation callbacks, runOnUI and
// modify) run on the UI thread and write at once; a shared value written
// from JavaScript (an effect, onLayout) lands only when the UI thread next
// runs, and until then JavaScript still reads the old value.

type Animation = { animation: true; to: unknown; done?: (finished: boolean) => void };
type Reaction = { prepare: () => unknown; react: (next: unknown, previous: unknown) => void; ran: boolean; last: unknown };
type Handlers = Record<'onStart' | 'onUpdate' | 'onEnd' | 'onFinalize', (event?: unknown) => void>;

let onUI = false;
const uiJobs: Array<() => void> = [];
const jsJobs: Array<() => void> = [];
const settling: Array<(finished: boolean) => void> = [];
const reactions = new Set<Reaction>();

function runReactions() {
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    for (const reaction of reactions) {
      const next = reaction.prepare();
      if (reaction.ran && Object.is(next, reaction.last)) continue;
      const previous = reaction.ran ? reaction.last : null;
      reaction.ran = true;
      reaction.last = next;
      reaction.react(next, previous);
      changed = true;
    }
    if (!changed) return;
  }
}
function ui(run: () => void) {
  const was = onUI;
  onUI = true;
  try {
    run();
  } finally {
    onUI = was;
    if (!was) {
      onUI = true;
      runReactions();
      onUI = false;
    }
  }
}
/** The UI thread runs what JavaScript sent it. */
const flushUI = () => act(() => {
  while (uiJobs.length > 0) ui(uiJobs.shift()!);
});
/** JavaScript runs what the UI thread sent it (runOnJS). */
const flushJS = () => act(() => {
  while (jsJobs.length > 0) jsJobs.shift()!();
});
/** Every running animation reaches its end. */
const settle = () => act(() => {
  ui(() => settling.splice(0).forEach((done) => done(true)));
});

function makeShared<T>(initial: T) {
  let current: unknown = initial;
  const commit = (next: unknown) => {
    if (next && typeof next === 'object' && (next as Animation).animation) {
      current = (next as Animation).to;
      const done = (next as Animation).done;
      if (done) settling.push(done);
    } else {
      current = next;
    }
  };
  const write = (next: () => unknown) => (onUI ? commit(next()) : uiJobs.push(() => commit(next())));
  const shared = {
    get value() { return current as T; },
    set value(next: T) { write(() => next); },
    get: () => current as T,
    set: (next: T | ((value: T) => T)) => {
      const value = typeof next === 'function' ? (next as (value: T) => T)(current as T) : next;
      write(() => value);
    },
    modify: (modifier?: (value: T) => T) => write(() => (modifier ? modifier(current as T) : current)),
  };
  return shared;
}

const reanimated = {
  __esModule: true,
  default: { View: AnimatedView },
  useSharedValue<T>(initial: T) {
    const [shared] = useState(() => makeShared(initial));
    return shared;
  },
  useAnimatedReaction(prepare: Reaction['prepare'], react: Reaction['react']) {
    const [reaction] = useState<Reaction>(() => ({ prepare, react, ran: false, last: null }));
    reaction.prepare = prepare;
    reaction.react = react;
    useEffect(() => {
      reactions.add(reaction);
      ui(() => undefined);
      return () => { reactions.delete(reaction); };
    }, [reaction]);
  },
  useAnimatedStyle(style: () => Record<string, unknown>) {
    const [holder] = useState(() => ({ style }));
    holder.style = style;
    return holder;
  },
  withTiming: (to: unknown, _config?: unknown, done?: (finished: boolean) => void): Animation => ({ animation: true, to, done }),
  withSpring: (to: unknown): Animation => ({ animation: true, to }),
  runOnJS: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => { jsJobs.push(() => fn(...args)); },
  runOnUI: (fn: (...args: unknown[]) => void) => (...args: unknown[]) => { uiJobs.push(() => fn(...args)); },
};
let useState: typeof import('react').useState;
let useEffect: typeof import('react').useEffect;

/** Each item's node: names the row it sits in. */
function Marker({ id }: { id: string }) {
  return createElement('span', null, id);
}
function markerIn(node: ReactNode): string | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = markerIn(child);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ id?: string; children?: ReactNode }>;
  if (element.type === Marker) return element.props.id ?? null;
  return markerIn(element.props?.children);
}

const rows = new Map<string, { onLayout: (event: unknown) => void; style: unknown[] }>();
const gestures = new Map<string, Handlers>();

function AnimatedView({ style, onLayout, children }: { style?: unknown; onLayout?: (event: unknown) => void; children?: ReactNode }) {
  const id = onLayout ? markerIn(children) : null;
  if (id && onLayout) rows.set(id, { onLayout, style: Array.isArray(style) ? style : [style] });
  return createElement('div', null, children);
}
function GestureDetector({ gesture, children }: { gesture: { handlers: Handlers }; children: ReactNode }) {
  const id = markerIn(children);
  if (id) gestures.set(id, gesture.handlers);
  return children;
}
const Gesture = {
  Pan() {
    const handlers = {} as Handlers;
    const pan = {
      handlers,
      enabled: () => pan,
      activateAfterLongPress: () => pan,
      onStart: (fn: Handlers['onStart']) => { handlers.onStart = fn; return pan; },
      onUpdate: (fn: Handlers['onUpdate']) => { handlers.onUpdate = fn; return pan; },
      onEnd: (fn: Handlers['onEnd']) => { handlers.onEnd = fn; return pan; },
      onFinalize: (fn: Handlers['onFinalize']) => { handlers.onFinalize = fn; return pan; },
    };
    return pan;
  },
};

type DragListProps = {
  items: { key: string; node: ReactNode }[];
  enabled: boolean;
  revision?: number;
  onMove: (key: string, index: number) => void;
  onHold?: (key: string) => void;
};
let DragList: (props: DragListProps) => ReactElement;
let root: Root;
let host: HTMLDivElement;
const onMove = vi.fn();

function render(keys: string[], revision = 0) {
  act(() => {
    root.render(createElement(DragList, {
      items: keys.map((key) => ({ key, node: createElement(Marker, { id: key }) })),
      enabled: true,
      revision,
      onMove,
    }));
  });
}
function layOut(heights: Record<string, number>) {
  act(() => {
    for (const [id, height] of Object.entries(heights)) rows.get(id)!.onLayout({ nativeEvent: { layout: { height } } });
  });
}
function layOutOneByOne(heights: Record<string, number>) {
  for (const [id, height] of Object.entries(heights)) {
    layOut({ [id]: height });
    flushUI();
  }
}
/** Where each row is drawn, top to bottom. */
function tops(): Record<string, number> {
  return Object.fromEntries([...rows].map(([id, row]) => {
    const animated = row.style.find((entry) => entry && typeof entry === 'object' && 'style' in entry) as { style: () => { transform: { translateY: number }[] } };
    return [id, animated.style().transform[0].translateY];
  }));
}
/** Holds a row, drags it by `dy` and lets go. */
function drag(id: string, dy: number) {
  const pan = gestures.get(id)!;
  act(() => {
    ui(() => pan.onStart());
    ui(() => pan.onUpdate({ translationY: dy, translationX: 0 }));
    ui(() => pan.onEnd({ translationY: dy, translationX: 0 }));
    ui(() => pan.onFinalize());
  });
}

beforeEach(async () => {
  const React = await import('react');
  useState = React.useState;
  useEffect = React.useEffect;
  rows.clear();
  gestures.clear();
  reactions.clear();
  uiJobs.length = 0;
  jsJobs.length = 0;
  settling.length = 0;
  onMove.mockReset();
  ({ DragList } = loadNativeModule<{ DragList: typeof DragList }>('components/DragList.tsx', {
    'react-native': { StyleSheet: { hairlineWidth: 1 }, View: ({ children }: { children?: ReactNode }) => createElement('div', null, children) },
    'react-native-gesture-handler': { Gesture, GestureDetector },
    'react-native-reanimated': reanimated,
    '~/lib/haptics': { haptics: { lift: vi.fn(), land: vi.fn(), select: vi.fn() } },
    '~/lib/liftShadow': { liftShadow: () => undefined },
    '~/lib/motion': { blockExit: {}, rowEnter: {} },
    '~/theme/blanc': { radius: { label: 10 }, useBlanc: () => ({ label: '#fff', hairline: '#ddd' }) },
    './SwipeRow': { dismissOpenSwipeRow: vi.fn(), holdRowPresses: vi.fn(), releaseRowPresses: vi.fn() },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('DragList', () => {
  it('keeps every row\'s height when the rows lay out together', () => {
    render(['a', 'b', 'c']);
    flushUI();
    // One batch of layouts, before the UI thread has run any of them.
    layOut({ a: 120, b: 50, c: 50 });
    flushUI();
    expect(tops()).toEqual({ a: 0, b: 120, c: 170 });
  });

  it('puts the rows back when a drop fails to save before it has settled', () => {
    render(['a', 'b', 'c']);
    flushUI();
    layOutOneByOne({ a: 50, b: 50, c: 50 });

    drag('a', 120);
    flushJS();
    expect(onMove).toHaveBeenCalledWith('a', 2);
    // The save failed at once: the screen asks for its old order back.
    render(['a', 'b', 'c'], 1);
    flushUI();
    settle();
    flushUI();
    expect(tops()).toEqual({ a: 0, b: 50, c: 100 });
  });

  it('keeps a drop in place while it saves, and follows the saved order', () => {
    render(['a', 'b', 'c']);
    flushUI();
    layOutOneByOne({ a: 50, b: 50, c: 50 });

    drag('a', 120);
    flushJS();
    expect(tops()).toEqual({ a: 100, b: 0, c: 50 });
    render(['b', 'c', 'a']);
    flushUI();
    settle();
    flushUI();
    expect(tops()).toEqual({ a: 100, b: 0, c: 50 });
  });

  it('never lets an order from before a drop undo it', () => {
    render(['a', 'b', 'c']);
    flushUI();
    layOutOneByOne({ a: 50, b: 50, c: 50 });

    const pan = gestures.get('a')!;
    act(() => ui(() => pan.onStart()));
    // A re-read lands while the row is held.
    render(['a', 'b', 'c'], 1);
    flushUI();
    act(() => {
      ui(() => pan.onUpdate({ translationY: 120, translationX: 0 }));
      ui(() => pan.onEnd({ translationY: 120, translationX: 0 }));
      ui(() => pan.onFinalize());
    });
    flushJS();
    settle();
    flushUI();
    expect(tops()).toEqual({ a: 100, b: 0, c: 50 });
  });
});
