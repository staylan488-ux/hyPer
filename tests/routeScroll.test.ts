import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindRouteScroll } from '@/lib/routeScroll';

class ScrollViewport extends EventTarget {
  height = 1600;
  clientHeight = 600;
  firstElementChild = {};
  private position = 0;
  get scrollTop() { return this.position; }
  set scrollTop(value: number) { this.position = Math.max(0, Math.min(value, this.height - this.clientHeight)); }
  asElement() { return this as unknown as HTMLElement; }
}

let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;
function setupObserver() {
  disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('tab scroll continuity', () => {
  it('opens a new destination at the top and returns to the previous reading position', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    const memory = new Map<string, number>();
    let cleanup = bindRouteScroll(viewport.asElement(), '/', memory);
    viewport.scrollTop = 420;
    viewport.dispatchEvent(new Event('scroll'));
    cleanup();
    cleanup = bindRouteScroll(viewport.asElement(), '/nutrition', memory);
    expect(viewport.scrollTop).toBe(0);
    viewport.scrollTop = 200;
    viewport.dispatchEvent(new Event('scroll'));
    cleanup();
    cleanup = bindRouteScroll(viewport.asElement(), '/', memory);
    expect(viewport.scrollTop).toBe(420);
    expect(memory.get('/nutrition')).toBe(200);
    cleanup();
  });

  it('waits for delayed content without replacing the saved position with a clamped scroll', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    viewport.height = 600;
    const memory = new Map([['/history', 760]]);
    const cleanup = bindRouteScroll(viewport.asElement(), '/history', memory);
    viewport.dispatchEvent(new Event('scroll'));
    expect(memory.get('/history')).toBe(760);
    viewport.height = 1800;
    resize();
    expect(viewport.scrollTop).toBe(760);
    cleanup();
  });

  it('captures the final scroll position before navigation even when the scroll event has not arrived', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    const shell = new EventTarget();
    const memory = new Map<string, number>();
    const cleanup = bindRouteScroll(viewport.asElement(), '/settings', memory, { navigation: shell });
    viewport.scrollTop = 690;
    viewport.dispatchEvent(new Event('scroll'));
    viewport.scrollTop = 844;
    // Tab click capture precedes Router's click handler and DOM replacement.
    shell.dispatchEvent(new Event('click'));
    viewport.height = 900;
    viewport.scrollTop = 844; // The shorter destination clamps the live DOM.
    cleanup();
    expect(memory.get('/settings')).toBe(844);
    viewport.height = 1600;
    const leave = bindRouteScroll(viewport.asElement(), '/settings', memory);
    expect(viewport.scrollTop).toBe(844);
    leave();
    shell.dispatchEvent(new Event('click'));
    expect(memory.get('/settings')).toBe(844);
  });

  it('captures browser back navigation before the route changes', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    const history = new EventTarget();
    const memory = new Map<string, number>();
    const cleanup = bindRouteScroll(viewport.asElement(), '/history', memory, { history });
    viewport.scrollTop = 450;
    history.dispatchEvent(new Event('popstate'));
    expect(memory.get('/history')).toBe(450);
    cleanup();
    viewport.scrollTop = 0;
    history.dispatchEvent(new Event('popstate'));
    expect(memory.get('/history')).toBe(450);
  });

  it('does not jump after loading when the person has taken over scrolling', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    viewport.height = 800;
    const memory = new Map([['/history', 760]]);
    const cleanup = bindRouteScroll(viewport.asElement(), '/history', memory);
    viewport.dispatchEvent(new Event('touchstart'));
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    viewport.height = 1800;
    resize();
    expect(viewport.scrollTop).toBe(80);
    expect(memory.get('/history')).toBe(80);
    cleanup();
  });

  it('removes listeners on navigation so the outgoing route cannot capture new scrolls', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    const memory = new Map([['/', 120]]);
    const cleanup = bindRouteScroll(viewport.asElement(), '/', memory);
    cleanup();
    viewport.scrollTop = 640;
    viewport.dispatchEvent(new Event('scroll'));
    expect(memory.get('/')).toBe(120);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe('native tab scroll continuity', () => {
  it('captures a pending compositor position before the native router changes pages', () => {
    setupObserver();
    const viewport = new ScrollViewport();
    const memory = new Map<string, number>();
    const history = new EventTarget();
    const cleanup = bindRouteScroll(viewport.asElement(), '/', memory, { history });
    viewport.scrollTop = 430;
    history.dispatchEvent(new Event('hyper:native-navigation'));
    viewport.scrollTop = 0;
    cleanup();
    expect(memory.get('/')).toBe(430);
    history.dispatchEvent(new Event('hyper:native-navigation'));
    expect(memory.get('/')).toBe(430);
  });
});
