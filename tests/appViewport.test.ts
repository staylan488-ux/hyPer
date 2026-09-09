import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appViewport, revealSheetField } from '../src/lib/appViewport';
import { useAppViewport } from '../src/hooks/useAppViewport';

const lifecycle = vi.hoisted(() => ({ effect: undefined as (() => void | (() => void)) | undefined }));
const native = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => false), addListener: vi.fn() }));
vi.mock('react', () => ({ useLayoutEffect: (effect: () => void | (() => void)) => { lifecycle.effect = effect; } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native.isNativePlatform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener } }));

class TestElement {
  parentElement: TestElement | null = null;
  scrollHeight = 300;
  clientHeight = 300;
  scrollTop = 0;
  overflowY = 'visible';
  inert = false;
  editable = false;
  dialog: TestElement | null = null;
  workoutEntry: TestElement | null = null;
  appViewport: TestElement | null = null;
  bounds = { top: 0, bottom: 300 };
  getBoundingClientRect() { return this.bounds; }
  matches() { return this.editable; }
  closest(selector: string) {
    if (selector === '[role="dialog"]') return this.dialog;
    if (selector === '[data-workout-set-entry]') return this.workoutEntry;
    if (selector === '.app-viewport') return this.appViewport;
    return null;
  }
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
  const doc = Object.assign(new EventTarget(), {
    documentElement: root, activeElement: null as TestElement | null, visibilityState: 'visible',
  });
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

beforeEach(() => {
  native.isNativePlatform.mockReturnValue(false);
  native.addListener.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it('keeps the inline workout input and save row visible inside the resized app scroll container', () => {
    const env = browser();
    const documentScroller = new TestElement();
    const shell = new TestElement();
    const route = new TestElement();
    const entry = new TestElement();
    const field = new TestElement();
    shell.parentElement = documentScroller;
    route.parentElement = shell;
    entry.parentElement = route;
    entry.appViewport = shell;
    field.parentElement = entry;
    field.workoutEntry = entry;
    field.editable = true;
    for (const container of [documentScroller, shell, route]) {
      container.scrollHeight = 1200;
      container.overflowY = 'auto';
    }
    documentScroller.scrollTop = 60;
    route.bounds = { top: 0, bottom: 800 };
    entry.getBoundingClientRect = () => ({ top: 700 - route.scrollTop, bottom: 760 - route.scrollTop });
    field.getBoundingClientRect = () => ({ top: 700 - route.scrollTop, bottom: 724 - route.scrollTop });
    env.doc.activeElement = field;
    const cleanup = env.mount();
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(route.scrollTop).toBe(0);

    // Resizing for the keyboard must retain the save control as well as the input.
    env.viewport.height = 480;
    route.bounds.bottom = 480;
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(route.scrollTop).toBe(292);
    expect(entry.getBoundingClientRect()).toEqual({ top: 408, bottom: 468 });
    expect(documentScroller.scrollTop).toBe(60);
    expect(shell.scrollTop).toBe(0);

    route.scrollTop = 0;
    env.viewport.scale = 2;
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(route.scrollTop).toBe(0);
    env.viewport.scale = 1;
    shell.inert = true;
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(route.scrollTop).toBe(0);
    shell.inert = false;
    field.workoutEntry = null;
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(route.scrollTop).toBe(0);
    cleanup();
  });

  it('prioritizes the dialog boundary over an inline workout marker, including inert dialogs', () => {
    const env = browser();
    const dialog = new TestElement();
    const container = new TestElement();
    const entry = new TestElement();
    const field = new TestElement();
    container.parentElement = dialog;
    container.scrollHeight = 1000;
    container.overflowY = 'auto';
    entry.parentElement = container;
    entry.bounds = { top: 250, bottom: 400 };
    entry.appViewport = dialog;
    field.parentElement = entry;
    field.dialog = dialog;
    field.workoutEntry = entry;
    field.editable = true;
    field.bounds = { top: 250, bottom: 280 };
    env.doc.activeElement = field;
    const cleanup = env.mount();
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(container.scrollTop).toBe(0); // Only the dialog's focused field needs revealing.
    dialog.inert = true;
    field.bounds = { top: 350, bottom: 380 };
    env.doc.dispatchEvent(new Event('focusin'));
    env.flush();
    expect(container.scrollTop).toBe(0);
    cleanup();
  });
});

describe('useAppViewport foreground recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it.each(['visibilitychange', 'pageshow', 'focus'])('remeasures on %s when no viewport resize was delivered', (event) => {
    const env = browser();
    Object.assign(env.viewport, { height: 480, offsetTop: 20 });
    const cleanup = env.mount();
    expect(env.values.get('--app-keyboard-inset')).toBe('300px');

    Object.assign(env.viewport, { height: 800, offsetTop: 0 });
    (event === 'visibilitychange' ? env.doc : env.win).dispatchEvent(new Event(event));
    expect(env.values.get('--app-viewport-height')).toBe('800px');
    expect(env.values.get('--app-viewport-top')).toBe('0px');
    expect(env.values.get('--app-keyboard-inset')).toBe('0px');
    expect(env.root.dataset.keyboardOpen).toBe('false');
    cleanup();
  });

  it('recovers geometry that settles after foreground without blurring or changing page scroll', () => {
    const env = browser();
    const page = new TestElement();
    const dialog = new TestElement();
    const container = new TestElement();
    const field = new TestElement();
    dialog.parentElement = page;
    container.parentElement = dialog;
    container.scrollHeight = 1000;
    container.overflowY = 'auto';
    field.parentElement = container;
    field.dialog = dialog;
    field.editable = true;
    field.bounds = { top: 350, bottom: 380 };
    page.scrollTop = 120;
    env.doc.activeElement = field;
    Object.assign(env.viewport, { height: 480, offsetTop: 20 });
    const cleanup = env.mount();
    env.doc.visibilityState = 'hidden';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    env.doc.visibilityState = 'visible';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    env.flush();
    expect(env.root.dataset.keyboardOpen).toBe('true');

    // The first resumed frame still reported the suspended keyboard layout.
    vi.advanceTimersByTime(250);
    Object.assign(env.viewport, { height: 800, offsetTop: 0 });
    vi.advanceTimersByTime(50);
    expect(env.values.get('--app-viewport-height')).toBe('800px');
    expect(env.values.get('--app-viewport-top')).toBe('0px');
    expect(env.values.get('--app-keyboard-inset')).toBe('0px');
    expect(env.root.dataset.keyboardOpen).toBe('false');
    expect(env.doc.activeElement).toBe(field);
    expect(page.scrollTop).toBe(120);
    expect(container.scrollTop).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(vi.getTimerCount()).toBe(0);
    cleanup();
  });

  it.each([
    { height: 480, offsetTop: 20, scale: 1, expectedHeight: '480px', expectedTop: '20px', inset: '300px', keyboardOpen: 'true' },
    { height: 250, offsetTop: 90, scale: 2, expectedHeight: '500px', expectedTop: '0px', inset: '300px', keyboardOpen: 'true' },
    { height: 400, offsetTop: 150, scale: 2, expectedHeight: '800px', expectedTop: '0px', inset: '0px', keyboardOpen: 'false' },
  ])('preserves live keyboard and zoom geometry on resume: $height/$scale', (geometry) => {
    const env = browser();
    Object.assign(env.viewport, geometry);
    const cleanup = env.mount();
    env.win.dispatchEvent(new Event('pageshow'));
    env.flush();
    vi.runAllTimers();
    expect(env.values.get('--app-viewport-height')).toBe(geometry.expectedHeight);
    expect(env.values.get('--app-viewport-top')).toBe(geometry.expectedTop);
    expect(env.values.get('--app-keyboard-inset')).toBe(geometry.inset);
    expect(env.root.dataset.keyboardOpen).toBe(geometry.keyboardOpen);
    cleanup();
  });

  it('cancels recovery while hidden or unmounted and coalesces repeated foreground events', () => {
    const env = browser();
    const cleanup = env.mount();
    env.win.dispatchEvent(new Event('pageshow'));
    const timerCount = vi.getTimerCount();
    env.win.dispatchEvent(new Event('focus'));
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(timerCount);
    expect(env.frames.size).toBe(1);

    env.doc.visibilityState = 'hidden';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    expect(env.frames.size).toBe(0);
    Object.assign(env.viewport, { height: 480, offsetTop: 20 });
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(env.values.get('--app-viewport-height')).toBe('800px');

    env.doc.visibilityState = 'visible';
    env.doc.dispatchEvent(new Event('visibilitychange'));
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    expect(env.frames.size).toBe(0);
    env.win.dispatchEvent(new Event('focus'));
    env.win.dispatchEvent(new Event('pageshow'));
    vi.runAllTimers();
    expect(env.values.size).toBe(0);
  });

  it('recovers from native foreground independently of browser events and removes its listener', async () => {
    native.isNativePlatform.mockReturnValue(true);
    const remove = vi.fn(async () => undefined);
    native.addListener.mockResolvedValue({ remove });
    const env = browser();
    const cleanup = env.mount();
    await Promise.resolve();
    expect(native.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
    const notify = native.addListener.mock.calls[0][1] as (state: { isActive: boolean }) => void;
    env.win.dispatchEvent(new Event('focus'));
    notify({ isActive: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(env.frames.size).toBe(0);
    Object.assign(env.viewport, { height: 480, offsetTop: 20 });
    env.viewport.dispatchEvent(new Event('resize'));
    env.flush();
    expect(env.values.get('--app-viewport-height')).toBe('800px');

    notify({ isActive: true });
    expect(env.values.get('--app-viewport-height')).toBe('480px');
    expect(env.root.dataset.keyboardOpen).toBe('true');
    Object.assign(env.viewport, { height: 800, offsetTop: 0 });
    vi.advanceTimersByTime(700);
    expect(env.values.get('--app-keyboard-inset')).toBe('0px');
    cleanup();
    expect(remove).toHaveBeenCalledOnce();
    notify({ isActive: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(env.values.size).toBe(0);
  });

  it('removes a native listener whose registration completes after unmount', async () => {
    native.isNativePlatform.mockReturnValue(true);
    const remove = vi.fn(async () => undefined);
    let registered!: (listener: { remove: () => Promise<void> }) => void;
    native.addListener.mockReturnValue(new Promise(resolve => { registered = resolve; }));
    const env = browser();
    const cleanup = env.mount();
    cleanup();
    registered({ remove });
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
    expect(env.values.size).toBe(0);
  });

  it('keeps browser recovery available when the native listener cannot attach', async () => {
    native.isNativePlatform.mockReturnValue(true);
    native.addListener.mockRejectedValue(new Error('Unavailable'));
    const env = browser();
    Object.assign(env.viewport, { height: 480, offsetTop: 20 });
    const cleanup = env.mount();
    await Promise.resolve();
    await Promise.resolve();
    Object.assign(env.viewport, { height: 800, offsetTop: 0 });
    env.win.dispatchEvent(new Event('focus'));
    expect(env.values.get('--app-keyboard-inset')).toBe('0px');
    cleanup();
  });
});
