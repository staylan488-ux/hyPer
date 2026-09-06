import { afterEach, describe, expect, it, vi } from 'vitest';
import { appViewport, revealSheetField } from '../src/lib/appViewport';
import { useAppViewport } from '../src/hooks/useAppViewport';

const lifecycle = vi.hoisted(() => ({ effect: undefined as (() => void | (() => void)) | undefined }));
vi.mock('react', () => ({ useLayoutEffect: (effect: () => void | (() => void)) => { lifecycle.effect = effect; } }));

class TestElement {
  parentElement: TestElement | null = null;
  scrollHeight = 300;
  clientHeight = 300;
  scrollTop = 0;
  overflowY = 'visible';
  inert = false;
  editable = false;
  dialog: TestElement | null = null;
  bounds = { top: 0, bottom: 300 };
  getBoundingClientRect() { return this.bounds; }
  matches() { return this.editable; }
  closest() { return this.dialog; }
}
const element = (value: TestElement) => value as unknown as HTMLElement;
const computedStyle = (value: TestElement) => ({ overflowY: value.overflowY });

function browser() {
  const values = new Map<string, string>();
  const root = {
    clientHeight: 800,
    style: { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key) },
    dataset: {} as Record<string, string>,
  };
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  const win = Object.assign(new EventTarget(), { innerHeight: 800, visualViewport: viewport });
  const doc = Object.assign(new EventTarget(), { documentElement: root, activeElement: null as TestElement | null });
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('getComputedStyle', computedStyle);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    values, root, viewport, win, doc, frames,
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); },
    mount: function TestViewportEffect() { useAppViewport(); return lifecycle.effect!() as () => void; },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('app viewport geometry', () => {
  it('uses layout height when visualViewport is unavailable', () => {
    expect(appViewport(800)).toEqual({ height: 800, top: 0, inset: 0, keyboardOpen: false, zoomed: false });
  });

  it('tracks keyboard closure even when iOS leaves the page magnified', () => {
    expect(appViewport(800, { height: 250, offsetTop: 90, scale: 2 })).toMatchObject({ height: 500, top: 0, inset: 300, keyboardOpen: true });
    expect(appViewport(800, { height: 400, offsetTop: 90, scale: 2 })).toMatchObject({ height: 800, top: 0, inset: 0, keyboardOpen: false });
  });

  it('does not mistake a pinch zoom or a zoom pan for a keyboard', () => {
    expect(appViewport(800, { height: 400, offsetTop: 150, scale: 2 })).toEqual({ height: 800, top: 0, inset: 0, keyboardOpen: false, zoomed: true });
  });

  it('follows the full normal-scale native pan even beyond the height difference', () => {
    expect(appViewport(800, { height: 450, offsetTop: 50, scale: 1 })).toMatchObject({ height: 450, top: 50, inset: 300, keyboardOpen: true });
    expect(appViewport(800, { height: 450, offsetTop: -20, scale: 1 }).top).toBe(0);
    expect(appViewport(800, { height: 450, offsetTop: 500, scale: 1 })).toMatchObject({ top: 500, inset: 0 });
    expect(appViewport(800, { height: 820, offsetTop: 0, scale: 1 }).height).toBe(800);
  });
});

describe('native keyboard geometry', () => {
  it('keeps keyboard presence separate from the gap below a panned viewport', () => {
    expect(appViewport(874, { height: 471, offsetTop: 403, scale: 1 }))
      .toEqual({ height: 471, top: 403, inset: 0, keyboardOpen: true, zoomed: false });
    expect(appViewport(874, { height: 874, offsetTop: 0, scale: 1 }).keyboardOpen).toBe(false);
  });
});

describe('revealing fields within sheets', () => {
  it('reveals a nested clipped field without scrolling the dialog or underlying page', () => {
    vi.stubGlobal('getComputedStyle', computedStyle);
    const page = new TestElement();
    const dialog = new TestElement();
    const outer = new TestElement();
    const inner = new TestElement();
    const field = new TestElement();
    dialog.parentElement = page;
    outer.parentElement = dialog;
    inner.parentElement = outer;
    field.parentElement = inner;
    for (const container of [page, dialog, outer, inner]) { container.scrollHeight = 1000; container.overflowY = 'auto'; }
    inner.bounds = { top: 100, bottom: 250 };
    outer.bounds = { top: 50, bottom: 200 };
    // Model the field moving with each scroll, as it does in the browser.
    field.getBoundingClientRect = () => ({ top: 260 - inner.scrollTop - outer.scrollTop, bottom: 290 - inner.scrollTop - outer.scrollTop });
    revealSheetField(element(field), element(dialog));
    expect(inner.scrollTop).toBe(52);
    expect(outer.scrollTop).toBe(50);
    expect(field.getBoundingClientRect()).toEqual({ top: 158, bottom: 188 });
    expect(dialog.scrollTop).toBe(0);
    expect(page.scrollTop).toBe(0);
  });

  it('leaves visible fields and non-scrollable ancestors alone, and reveals fields clipped above', () => {
    vi.stubGlobal('getComputedStyle', computedStyle);
    const dialog = new TestElement();
    const container = new TestElement();
    const field = new TestElement();
    container.parentElement = dialog;
    field.parentElement = container;
    container.overflowY = 'auto';
    field.bounds = { top: -30, bottom: 0 };
    revealSheetField(element(field), element(dialog));
    expect(container.scrollTop).toBe(0); // No overflow to scroll.
    container.scrollHeight = 600;
    container.scrollTop = 80;
    revealSheetField(element(field), element(dialog));
    expect(container.scrollTop).toBe(38);
    field.bounds = { top: 20, bottom: 60 };
    revealSheetField(element(field), element(dialog));
    expect(container.scrollTop).toBe(38);
    container.overflowY = 'hidden';
    field.bounds = { top: 400, bottom: 430 };
    revealSheetField(element(field), element(dialog));
    expect(container.scrollTop).toBe(38);
  });
});

describe('useAppViewport keyboard lifecycle', () => {
  it('uses the layout viewport when WKWebView both pans and shrinks innerHeight', () => {
    const env = browser();
    env.root.clientHeight = 874;
    env.win.innerHeight = 471;
    Object.assign(env.viewport, { height: 471, offsetTop: 403 });
    const cleanup = env.mount();
    expect(env.values.get('--app-viewport-top')).toBe('403px');
    expect(env.values.get('--app-viewport-height')).toBe('471px');
    expect(env.root.dataset.keyboardOpen).toBe('true');
    env.win.innerHeight = 874;
    Object.assign(env.viewport, { height: 874, offsetTop: 0 });
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(env.values.get('--app-viewport-height')).toBe('874px');
    expect(env.values.get('--app-viewport-top')).toBe('0px');
    expect(env.root.dataset.keyboardOpen).toBe('false');
    cleanup();
  });

  it('restores shell geometry on keyboard dismissal while zoom and focus remain', () => {
    const env = browser();
    const field = new TestElement();
    field.editable = true;
    env.doc.activeElement = field;
    const cleanup = env.mount();
    Object.assign(env.viewport, { height: 250, scale: 2 });
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(env.values.get('--app-viewport-height')).toBe('500px');
    expect(env.root.dataset.keyboardOpen).toBe('true');
    // iOS keyboard dismissal need not blur the focused input or reset zoom.
    env.viewport.height = 400;
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(env.doc.activeElement).toBe(field);
    expect(env.values.get('--app-viewport-height')).toBe('800px');
    expect(env.values.get('--app-keyboard-inset')).toBe('0px');
    expect(env.root.dataset.keyboardOpen).toBe('false');
    cleanup();
  });

  it('updates without focused inputs and removes every listener and pending frame on unmount', () => {
    const env = browser();
    const targets = [env.viewport, env.win, env.doc];
    const added = targets.map(target => vi.spyOn(target, 'addEventListener'));
    const removed = targets.map(target => vi.spyOn(target, 'removeEventListener'));
    const cleanup = env.mount();
    env.viewport.height = 480;
    env.viewport.dispatchEvent(new Event('resize'));
    expect(env.root.dataset.keyboardOpen).toBe('true');
    env.viewport.offsetTop = 20;
    env.viewport.dispatchEvent(new Event('scroll'));
    expect(env.values.get('--app-viewport-top')).toBe('20px');
    Object.assign(env.viewport, { height: 800, offsetTop: 0 });
    env.win.dispatchEvent(new Event('resize'));
    expect(env.root.dataset.keyboardOpen).toBe('false');
    expect(env.frames.size).toBe(1);
    cleanup();
    targets.forEach((_, index) => expect(removed[index].mock.calls).toEqual(added[index].mock.calls));
    expect(env.frames.size).toBe(0);
    expect(env.values.size).toBe(0);
    expect(env.root.dataset.keyboardOpen).toBeUndefined();
    env.viewport.dispatchEvent(new Event('resize'));
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(env.values.size).toBe(0);
  });

  it('reveals focused fields after resize but respects deliberate zoom and inert sheets', () => {
    const env = browser();
    const dialog = new TestElement();
    const container = new TestElement();
    container.parentElement = dialog;
    container.scrollHeight = 1000;
    container.overflowY = 'auto';
    const field = new TestElement();
    field.parentElement = container;
    field.dialog = dialog;
    field.editable = true;
    field.bounds = { top: 350, bottom: 380 };
    env.doc.activeElement = field;
    const cleanup = env.mount();
    env.doc.dispatchEvent(new Event('focusin'));
    expect(container.scrollTop).toBe(0);
    env.flush();
    expect(container.scrollTop).toBe(92);
    container.scrollTop = 0;
    env.viewport.scale = 2;
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(container.scrollTop).toBe(0);
    env.viewport.scale = 1;
    dialog.inert = true;
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(container.scrollTop).toBe(0);
    dialog.inert = false;
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(container.scrollTop).toBe(92);
    cleanup();
  });
});
