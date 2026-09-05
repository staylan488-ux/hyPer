import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playBrandIntro } from '@/components/intro/brandIntro';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ animationFails = false } = {}) {
  const fonts = deferred<never[]>();
  const animations: { cancel: ReturnType<typeof vi.fn>; complete: () => void }[] = [];
  class FakeElement {
    children: FakeElement[] = [];
    parent?: FakeElement;
    className = '';
    classList = { add: vi.fn() };
    style = { visibility: '', top: '' };
    attributes = new Map<string, string>();
    inert = false;
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    append(child: FakeElement) { this.children.push(child); child.parent = this; }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
    getBoundingClientRect() { return { left: 24, top: 28, bottom: 52, width: 65, height: 24 }; }
    cloneNode() {
      const clone = new FakeElement();
      this.children.forEach(() => clone.append(new FakeElement()));
      return clone;
    }
    animate() {
      if (animationFails) throw new Error('Animation could not start');
      const completion = deferred<void>();
      // The travel animation owns completion; other decorative animations do not.
      const animation = { cancel: vi.fn(), complete: () => completion.resolve(), finished: completion.promise };
      animations.push(animation);
      return animation;
    }
  }
  const target = new FakeElement();
  target.append(new FakeElement());
  target.append(new FakeElement());
  target.append(new FakeElement());
  const body = new FakeElement();
  const documentElement = new FakeElement();
  const root = new FakeElement();
  const win = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
  const doc = Object.assign(new EventTarget(), {
    body, documentElement, getElementById: () => root,
    createElement: () => new FakeElement(), fonts: { load: () => fonts.promise },
  });
  const preference = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: '24px' }));
  return {
    target, body, documentElement, root, fonts, animations, win, preference,
    play: () => playBrandIntro(target as unknown as HTMLElement, preference as MediaQueryList),
  };
}

async function resolveFonts(fonts: ReturnType<typeof setup>['fonts']) {
  fonts.resolve([]);
  await Promise.resolve();
  await Promise.resolve();
}

describe('brand intro lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('restores the wordmark when font loading exceeds its deadline and ignores late fonts', async () => {
    const env = setup();
    env.play();
    expect(env.target.style.visibility).toBe('hidden');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBe('true');
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.target.style.visibility).toBe('');
    expect(env.body.children).toHaveLength(0);
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    await resolveFonts(env.fonts);
    expect(env.animations).toHaveLength(0);
  });

  it('consumes a skip tap so it cannot activate an unseen control', async () => {
    const env = setup();
    env.play();
    const interaction = new Event('click', { cancelable: true });
    env.win.dispatchEvent(interaction);
    expect(interaction.defaultPrevented).toBe(true);
    await resolveFonts(env.fonts);
    expect(env.body.children).toHaveLength(0);
    expect(env.target.style.visibility).toBe('');
    expect(env.animations).toHaveLength(0);
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
  });

  it('restores native navigation visibility on Tab without making the page inert or consuming navigation', () => {
    const env = setup();
    const cleanup = env.play();
    expect(env.documentElement.getAttribute('data-brand-intro')).toBe('true');
    expect(env.root.inert).toBe(false);
    expect(env.documentElement.inert).toBe(false);
    const interaction = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab' });
    env.win.dispatchEvent(interaction);
    expect(interaction.defaultPrevented).toBe(false);
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    cleanup();
  });

  it('preserves a pre-existing document marker when interrupted', () => {
    const env = setup();
    env.documentElement.setAttribute('data-brand-intro', 'false');
    const cleanup = env.play();
    expect(env.documentElement.getAttribute('data-brand-intro')).toBe('true');
    cleanup();
    expect(env.documentElement.getAttribute('data-brand-intro')).toBe('false');
  });

  it('restores the page if animation startup throws after the font deadline is cleared', async () => {
    const env = setup({ animationFails: true });
    env.play();
    await resolveFonts(env.fonts);
    await Promise.resolve();
    expect(env.target.style.visibility).toBe('');
    expect(env.body.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
  });

  it('cancels every running animation if reduced-motion preferences change', async () => {
    const env = setup();
    const cleanup = env.play();
    await resolveFonts(env.fonts);
    expect(env.animations.length).toBeGreaterThan(0);
    env.preference.dispatchEvent(new Event('change'));
    cleanup();
    env.win.dispatchEvent(new Event('resize'));
    expect(env.target.style.visibility).toBe('');
    expect(env.body.children).toHaveLength(0);
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    env.animations.forEach(animation => expect(animation.cancel).toHaveBeenCalledTimes(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('supports effect cleanup and immediate restart without stale async work removing the new overlay', async () => {
    const env = setup();
    const firstCleanup = env.play();
    firstCleanup();
    const secondCleanup = env.play();
    await resolveFonts(env.fonts);
    expect(env.body.children).toHaveLength(1);
    expect(env.target.style.visibility).toBe('hidden');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBe('true');
    env.animations[0].complete();
    await Promise.resolve();
    expect(env.body.children).toHaveLength(0);
    expect(env.target.style.visibility).toBe('');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    secondCleanup();
    env.animations.forEach(animation => expect(animation.cancel).toHaveBeenCalledTimes(1));
  });
});
