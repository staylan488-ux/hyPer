import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { BarcodeScanner } from '@/components/nutrition/BarcodeScanner';

// Exercise effect scheduling and asynchronous bridge results without requiring
// a browser/camera. Slots preserve hook identities across explicit rerenders.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void };
  const state = { slots: [] as unknown[], cursor: 0, pending: [] as Effect[], effects: [] as Effect[] };
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    state,
    reset() { state.slots = []; state.cursor = 0; state.pending = []; state.effects = []; },
    commit() { for (const effect of state.pending.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; } },
    cleanup() { for (const effect of state.effects) { effect.cleanup?.(); effect.cleanup = undefined; } },
    replay() { state.pending.push(...state.effects); },
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
    useEffectEvent(callback: (...args: unknown[]) => unknown) {
      const index = state.cursor++;
      let event = state.slots[index] as { callback: typeof callback; invoke: typeof callback } | undefined;
      if (!event) {
        event = { callback, invoke: (...args) => event!.callback(...args) };
        state.slots[index] = event;
      }
      event.callback = callback;
      return event.invoke;
    },
  };
});
const native = vi.hoisted(() => ({ getAvailability: vi.fn(), scanBarcode: vi.fn(), isNativeIOS: vi.fn(() => true) }));
vi.mock('react', () => ({
  useRef: hooks.useRef, useState: hooks.useState, useCallback: hooks.useCallback,
  useEffect: hooks.useEffect, useEffectEvent: hooks.useEffectEvent,
}));
vi.mock('@/lib/nativeBridge', () => ({ NativeBarcode: native, isNativeIOS: native.isNativeIOS }));
vi.mock('@/components/shared', () => ({ Button: 'button', Input: 'input' }));
vi.mock('lucide-react', () => ({ Barcode: 'icon', Flashlight: 'icon', Keyboard: 'icon', Loader2: 'icon', ScanLine: 'icon' }));
vi.mock('barcode-detector/ponyfill', () => ({ BarcodeDetector: class {}, prepareZXingModule: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ tapHaptic: vi.fn() }));
vi.mock('@/lib/withTimeout', () => ({ withTimeout: (promise: Promise<unknown>) => promise }));

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (node && typeof node === 'object' && 'props' in node) return text((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}
function buttons(node: ReactNode): ReactElement<{ children?: ReactNode; onClick?: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const current = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  return [...(current.type === 'button' ? [current] : []), ...buttons(current.props.children)];
}
function setup() {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('window', { isSecureContext: true });
  const onDetected = vi.fn(async () => true);
  const render = (callback = onDetected) => { hooks.state.cursor = 0; return BarcodeScanner({ onDetected: callback }); };
  return {
    frames, onDetected, render,
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); },
  };
}

beforeEach(() => {
  hooks.reset();
  native.getAvailability.mockReset().mockResolvedValue({ available: true });
  native.scanBarcode.mockReset().mockImplementation(() => new Promise(() => {}));
  native.isNativeIOS.mockReturnValue(true);
});
afterEach(() => { hooks.cleanup(); vi.unstubAllGlobals(); });

describe('barcode scanner automatic startup', () => {
  it('starts once after mounting without an initial Start scanner control or rerender restart', async () => {
    const env = setup();
    const initial = env.render();
    expect(buttons(initial).map(button => text(button))).not.toContain('Start scanner');
    hooks.commit();
    expect(native.getAvailability).not.toHaveBeenCalled();
    env.frame();
    await tick();
    expect(native.getAvailability).toHaveBeenCalledOnce();
    expect(native.scanBarcode).toHaveBeenCalledOnce();
    env.render(vi.fn(async () => true));
    hooks.commit();
    env.frame();
    await tick();
    expect(native.scanBarcode).toHaveBeenCalledOnce();
  });

  it('waits for an explicit retry after native cancellation', async () => {
    const result = deferred<{ rawValue: string }>();
    native.scanBarcode.mockReturnValueOnce(result.promise);
    const env = setup();
    env.render();
    hooks.commit();
    env.frame();
    await tick();
    result.reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
    await tick();
    const cancelled = env.render();
    hooks.commit();
    env.frame();
    await tick();
    expect(native.scanBarcode).toHaveBeenCalledOnce();
    const retry = buttons(cancelled).find(button => /scan again|retry/i.test(text(button)));
    expect(retry).toBeDefined();
    retry!.props.onClick!();
    await tick();
    expect(native.scanBarcode).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed automatic start recoverable without repeatedly requesting the camera', async () => {
    native.getAvailability.mockRejectedValueOnce(new Error('Camera access denied'));
    const env = setup();
    env.render();
    hooks.commit();
    env.frame();
    await tick();
    const failed = env.render();
    hooks.commit();
    env.frame();
    await tick();
    expect(text(failed)).toContain('Camera access denied');
    expect(native.getAvailability).toHaveBeenCalledOnce();
    expect(native.scanBarcode).not.toHaveBeenCalled();
    const retry = buttons(failed).find(button => /scan again|retry/i.test(text(button)));
    expect(retry).toBeDefined();
    retry!.props.onClick!();
    await tick();
    expect(native.getAvailability).toHaveBeenCalledTimes(2);
    expect(native.scanBarcode).toHaveBeenCalledOnce();
  });

  it('does not open the native scanner when availability resolves after unmount', async () => {
    const availability = deferred<{ available: boolean }>();
    native.getAvailability.mockReturnValue(availability.promise);
    const env = setup();
    env.render();
    hooks.commit();
    env.frame();
    hooks.cleanup();
    availability.resolve({ available: true });
    await tick();
    expect(native.scanBarcode).not.toHaveBeenCalled();
    expect(env.onDetected).not.toHaveBeenCalled();
  });

  it('cancels scheduled startup and opens only one camera after StrictMode effect replay', async () => {
    const env = setup();
    env.render();
    hooks.commit();
    expect(env.frames.size).toBe(1);
    hooks.cleanup();
    expect(env.frames.size).toBe(0);
    hooks.replay();
    hooks.commit();
    env.frame();
    await tick();
    expect(native.getAvailability).toHaveBeenCalledOnce();
    expect(native.scanBarcode).toHaveBeenCalledOnce();
  });

  it('ignores a native scan result delivered after leaving the Scan tab', async () => {
    const result = deferred<{ rawValue: string; format: string }>();
    native.scanBarcode.mockReturnValue(result.promise);
    const env = setup();
    env.render();
    hooks.commit();
    env.frame();
    await tick();
    hooks.cleanup();
    result.resolve({ rawValue: '012345678905', format: 'upc_a' });
    await tick();
    expect(env.onDetected).not.toHaveBeenCalled();
  });
});
