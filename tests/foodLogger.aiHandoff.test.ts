import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { FoodLogger } from '@/components/nutrition/FoodLogger';
import { FoodTrialLogger } from '@/components/nutrition/FoodTrialLogger';
import { previewFoodTrialResult } from '@/lib/foodTrial';

// Drive component callbacks and effects using the same explicit rerenders as
// barcodeScanner.test.ts; the keyed child is left mounted between tab changes.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void };
  const state = { slots: [] as unknown[], cursor: 0, pending: [] as Effect[], effects: [] as Effect[] };
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    state,
    reset() { state.slots = []; state.cursor = 0; state.pending = []; state.effects = []; },
    commit() { for (const effect of state.pending.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; } },
    cleanup() { for (const effect of state.effects) { effect.cleanup?.(); effect.cleanup = undefined; } },
    useRef(value: unknown) { const index = state.cursor++; return state.slots[index] ??= { current: value }; },
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value; }];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { deps: readonly unknown[]; callback: unknown } | undefined;
      if (previous && same(previous.deps, deps)) return previous.callback;
      state.slots[index] = { deps, callback };
      return callback;
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { deps: readonly unknown[]; value: unknown } | undefined;
      if (previous && same(previous.deps, deps)) return previous.value;
      const value = factory();
      state.slots[index] = { deps, value };
      return value;
    },
    useEffect(setup: Effect['setup'], deps?: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as Effect | undefined;
      if (previous && same(previous.deps, deps)) { previous.setup = setup; return; }
      const effect = previous ?? { setup };
      effect.setup = setup;
      effect.deps = deps;
      state.slots[index] = effect;
      if (!previous) state.effects.push(effect);
      state.pending.push(effect);
    },

  };
});

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: hooks.useRef, useState: hooks.useState, useCallback: hooks.useCallback,
  useMemo: hooks.useMemo, useEffect: hooks.useEffect,
}));

vi.mock('@/components/shared', () => Object.fromEntries(
  ['Button', 'DateField', 'FormField', 'Input', 'RailStrip', 'SegmentedControl', 'SelectSheet', 'Stepper', 'TimeField']
    .map((name) => [name, name]),
));
vi.mock('motion/react', () => ({ motion: { button: 'motion-button' } }));
vi.mock('@/hooks/useLitSurface', () => ({ useLitSurface: () => undefined }));
vi.mock('@/stores/authStore', () => {
  const getState = () => ({ user: { id: 'u1' } });
  return { useAuthStore: Object.assign((selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()), {
    getState, subscribe: () => () => {},
  }) };
});
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'test-token' } } }) },
  from: () => {
    const chain: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'in', 'order', 'limit']) chain[name] = () => chain;
    chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  },
} }));
const ai = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('@/lib/foodTrial', async (original) => ({
  ...(await original<typeof import('@/lib/foodTrial')>()),
  getFoodAnalysisMode: () => 'gemini', analyzeFoodTrial: ai.analyze,
}));
vi.mock('@/lib/photoAnalysis', () => ({ getPhotoWorkerSettings: () => ({ provider: 'openai' }) }));

type Element = ReactElement<{ children?: ReactNode }>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node && typeof node === 'object' && 'props' in node) return text((node as Element).props.children);
  return '';
}
function pick<Props>(tree: ReactNode, predicate: (node: Element) => boolean): ReactElement<Props> {
  const node = nodes(tree).find(predicate);
  if (!node) throw new Error('Expected control was not rendered');
  return node as ReactElement<Props>;
}
type ClickProps = { onClick: () => void; disabled?: boolean };
type ChangeProps = { onChange: (event: { target: { value: string } }) => void };
const trial = (tree: ReactNode) => pick<ComponentProps<typeof FoodTrialLogger>>(tree, (node) => node.type === FoodTrialLogger);

function setupLogger() {
  const props = { selectedDate: new Date(), initialMethod: 'photo' as const, onComplete: vi.fn() };
  const render = () => { hooks.state.cursor = 0; const tree = FoodLogger(props); hooks.commit(); return tree; };
  const openDescribe = () => {
    let tree = render();
    pick<{ onChange: (value: string) => void }>(tree, (node) => node.type === 'SegmentedControl').props.onChange('manual');
    tree = render();
    pick<ClickProps>(tree, (node) => node.type === 'button' && text(node).includes('Describe with AI')).props.onClick();
    tree = render();
    pick<ChangeProps>(tree, (node) => node.type === 'textarea').props.onChange({ target: { value: 'Chicken burrito' } });
    return render();
  };
  const handoff = (tree: ReactNode) => pick<ClickProps>(tree, (node) => node.type === 'Button' && text(node).includes('Review with Gemini'));
  return { render, openDescribe, handoff };
}

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('window', { confirm: vi.fn(() => false) });
});
afterEach(() => { hooks.cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Describe handoff to the retained AI logger', () => {
  it.each(['analysis', 'save'] as const)('cannot replace a meal while %s runs', (operation) => {
    const logger = setupLogger();
    const initial = trial(logger.render());
    initial.props.onAnalysisBusyChange?.(operation === 'analysis');
    initial.props.onDraftStateChange?.({ hasDraft: true, busy: true });
    const tree = logger.openDescribe();
    expect(logger.handoff(tree).props.disabled).toBe(true);
    // The handler itself also guards a stale queued click.
    logger.handoff(tree).props.onClick();
    expect(trial(logger.render()).key).toBe(initial.key);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('keeps a draft/result and its child identity when replacement is declined', () => {
    const logger = setupLogger();
    const initial = trial(logger.render());
    initial.props.onDraftStateChange?.({ hasDraft: true, busy: false });
    const tree = logger.openDescribe();
    expect(trial(tree).key).toBe(initial.key);
    logger.handoff(tree).props.onClick();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(trial(logger.render()).key).toBe(initial.key);
  });

  it('replaces the meal and supplies the new hint only after confirmation', () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    const logger = setupLogger();
    const initial = trial(logger.render());
    initial.props.onDraftStateChange?.({ hasDraft: true, busy: false });
    logger.handoff(logger.openDescribe()).props.onClick();
    const next = trial(logger.render());
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(next.key).not.toBe(initial.key);
    expect(next.props.initialHint).toBe('Chicken burrito');
  });

  it('opens a fresh empty AI logger without asking to discard work', () => {
    const logger = setupLogger();
    logger.handoff(logger.openDescribe()).props.onClick();
    expect(trial(logger.render()).props.initialHint).toBe('Chicken burrito');
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe('AI draft reporting', () => {
  it('counts a photo-only draft and keeps protecting its result after the photo is removed', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:meal');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    ai.analyze.mockResolvedValue({ ...previewFoodTrialResult, items: [], clarification: 'How much did you eat?' });
    const onDraftStateChange = vi.fn();
    const props: ComponentProps<typeof FoodTrialLogger> = {
      whenRow: null, prepareImage: vi.fn(async () => ({ imageBase64: 'test-image', mimeType: 'image/jpeg' })),
      onSave: vi.fn(), onDraftStateChange,
    };
    const render = () => { hooks.state.cursor = 0; const tree = FoodTrialLogger(props); hooks.commit(); return tree; };
    let tree = render();
    pick<{ onChange: (event: { target: { files: File[]; value: string } }) => void }>(tree, (node) => node.type === 'input')
      .props.onChange({ target: { files: [new File(['photo'], 'meal.jpg', { type: 'image/jpeg' })], value: '' } });
    tree = render();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: true, busy: false });
    pick<ClickProps>(tree, (node) => node.type === 'Button' && text(node).includes('Analyze meal')).props.onClick();
    render();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: true, busy: true });
    for (let index = 0; index < 20; index++) await Promise.resolve();
    tree = render();
    pick<ClickProps>(tree, (node) => node.type === 'Button' && text(node).includes('Remove photo')).props.onClick();
    render();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: true, busy: false });
  });

  it('reports typed text and clears its report on unmount', () => {
    const onDraftStateChange = vi.fn();
    const props: ComponentProps<typeof FoodTrialLogger> = {
      whenRow: null, prepareImage: vi.fn(), onSave: vi.fn(), onDraftStateChange,
    };
    const render = () => { hooks.state.cursor = 0; const tree = FoodTrialLogger(props); hooks.commit(); return tree; };
    const first = render();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: false, busy: false });
    pick<ChangeProps>(first, (node) => node.type === 'textarea').props.onChange({ target: { value: 'Chicken meal' } });
    render();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: true, busy: false });
    hooks.cleanup();
    expect(onDraftStateChange).toHaveBeenLastCalledWith({ hasDraft: false, busy: false });
  });
});
