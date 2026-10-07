import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { Nutrition } from '@/pages/Nutrition';

// Preserve hook identities and commit effects between explicit component
// renders, as in the barcode scanner's native callback tests.
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
  ['Button', 'EmptyState', 'LiquidOrb', 'Modal', 'RailStrip', 'RollingNumber', 'Screen', 'Toast', 'PageTitle', 'SealMark'].map((name) => [name, name]),
));
vi.mock('@/components/nutrition/MealLogger', () => ({ MealLogger: 'MealLogger' }));
vi.mock('@/components/nutrition/NutritionGroupLedger', () => ({ NutritionGroupLedger: 'NutritionGroupLedger' }));
vi.mock('@/hooks/useTargetSeal', () => ({ useTargetSeal: () => ({ met: false, anchorRef: null }) }));
vi.mock('@/stores/appStore', () => {
  const fetchMacroTarget = vi.fn();
  return { useAppStore: () => ({ macroTarget: null, fetchMacroTarget }) };
});
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => 'u1' }));
const db = vi.hoisted(() => ({
  logs: vi.fn(),
  insertResult: Promise.resolve({ data: null, error: null }) as Promise<unknown>,
  orderResult: Promise.resolve({ data: null, error: null }) as Promise<unknown>,
  inserted: vi.fn(),
  updated: vi.fn(),
}));
vi.mock('@/lib/nutritionLogQueries', () => ({ fetchNutritionLogsWithFoods: db.logs }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let from = '';
  let operation = 'read';
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'order']) chain[method] = () => chain;
  chain.gte = (_column: string, value: string) => { from = value; return chain; };
  chain.insert = (...args: unknown[]) => { operation = 'insert'; db.inserted(...args); return chain; };
  chain.update = (...args: unknown[]) => { operation = 'update'; db.updated(...args); return chain; };
  chain.then = (resolve: (result: unknown) => unknown) => {
    if (operation === 'insert') return db.insertResult.then(resolve);
    if (operation === 'update') return db.orderResult.then(resolve);
    const data = from.startsWith('2026-09') ? ['breakfast', 'lunch', 'dinner'].map((label, index) => ({
      id: label, user_id: 'u1', date: '2026-09-15', kind: 'meal', label, sort_order: index,
    })) : [];
    return Promise.resolve({ data, error: null }).then(resolve);
  };
  return chain;
} } }));

type Element = ReactElement<{ children?: ReactNode; 'aria-label'?: string; value?: string; onClick?: () => void }>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
const tick = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
afterEach(() => { hooks.cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['insert', 'order'] as const)('keeps the selected month when an old default-group %s fails', async (failure) => {
  hooks.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-04T12:00:00'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let finish!: (result: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  db.insertResult = failure === 'insert' ? pending : Promise.resolve({
    data: ['breakfast', 'lunch', 'dinner'].map((label, index) => ({
      id: label, user_id: 'u1', date: '2026-10-04', kind: 'meal', label, sort_order: index + 8,
    })), error: null,
  });
  db.orderResult = pending;
  db.logs.mockImplementation(async (_userId: string, range: { from: string }) => ({
    data: [{
      id: range.from, user_id: 'u1', date: range.from.startsWith('2026-09') ? '2026-09-15' : '2026-10-04',
      food_id: 'f1', servings: 1,
      food: { id: 'f1', name: 'Test', calories: 500, protein: 20, carbs: 30, fat: 10 },
    }], error: null,
  }));
  const render = () => { hooks.state.cursor = 0; const tree = Nutrition(); hooks.commit(); return tree; };
  let tree = render();
  await vi.advanceTimersByTimeAsync(0);
  await tick();
  tree = render();
  await tick();
  expect(db.inserted).toHaveBeenCalledTimes(1);
  if (failure === 'order') expect(db.updated).toHaveBeenCalled();
  nodes(tree).find((node) => node.props['aria-label'] === 'Previous month')!.props.onClick!();
  tree = render();
  await vi.advanceTimersByTimeAsync(0);
  await tick();
  tree = render();
  nodes(tree).find((node) => node.props['aria-label'] === 'Tuesday, September 15')!.props.onClick!();
  tree = render();
  await tick();
  expect(nodes(tree).find((node) => node.type === 'RollingNumber')!.props.value).toBe('500');
  const readsBeforeFailure = db.logs.mock.calls.length;
  finish({ data: null, error: { message: 'offline' } });
  await tick();
  tree = render();
  expect(nodes(tree).find((node) => node.type === 'RollingNumber')!.props.value).toBe('500');
  expect(db.logs.mock.calls.length).toBe(readsBeforeFailure);
});
