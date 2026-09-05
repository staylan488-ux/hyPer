import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playBrandIntro } from '@/components/intro/brandIntro';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ animationFails = false, fontSize = 24, viewportWidth = 390 } = {}) {
  const fonts = deferred<never[]>();
  const animations: {
    element: FakeElement;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancel: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    currentTime: number;
    complete: () => void;
  }[] = [];
  const ratio = fontSize / 24;
  const bounds = (left: number, top: number, width: number, height: number) => ({
    left, top, width, height, right: left + width, bottom: top + height,
  });
  const targetBounds = bounds(37.25, 91.5, 67.5 * ratio, 22.2 * ratio);
  // Distinct fractional advances and baseline offsets catch accidental use of
  // clone/container geometry in place of each live letter run's measured box.
  const childBounds = [
    bounds(37.25, 91.5 + .6 * ratio, 24.125 * ratio, 21.6 * ratio),
    bounds(37.25 + 24.125 * ratio, 91.5, 15.75 * ratio, 21.6 * ratio),
    bounds(37.25 + 39.875 * ratio, 91.5 + .6 * ratio, 27.625 * ratio, 21.6 * ratio),
  ];
  class FakeElement extends EventTarget {
    children: FakeElement[] = [];
    parent?: FakeElement;
    className = '';
    classList = { add: vi.fn() };
    style = { visibility: '', top: '' };
    attributes = new Map<string, string>();
    inert = false;
    bounds = bounds(0, 0, 0, 0);
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    append(child: FakeElement) { this.children.push(child); child.parent = this; }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
    getBoundingClientRect() { return this.bounds; }
    cloneNode() {
      const clone = new FakeElement();
      this.children.forEach(() => clone.append(new FakeElement()));
      return clone;
    }
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      if (animationFails) throw new Error('Animation could not start');
      const completion = deferred<void>();
      // The travel animation owns completion; other decorative animations do not.
      const animation = {
        element: this, keyframes, options, cancel: vi.fn(), pause: vi.fn(), currentTime: 0,
        complete: () => completion.resolve(), finished: completion.promise,
      };
      animations.push(animation);
      return animation;
    }
  }
  const target = new FakeElement();
  target.bounds = targetBounds;
  childBounds.forEach((box) => {
    const child = new FakeElement();
    child.bounds = box;
    target.append(child);
  });
  const body = new FakeElement();
  const documentElement = new FakeElement();
  const root = new FakeElement();
  const win = Object.assign(new EventTarget(), { innerWidth: viewportWidth, innerHeight: 844 });
  const doc = Object.assign(new EventTarget(), {
    body, documentElement, getElementById: () => root,
    createElement: () => new FakeElement(), fonts: { load: () => fonts.promise },
  });
  const preference = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: `${fontSize}px` }));
  return {
    target, body, documentElement, root, fonts, animations, win, preference, childBounds,
    play: (options: { duration?: number; pauseAt?: number } = {}) => playBrandIntro(
      target as unknown as HTMLElement, preference as MediaQueryList, options,
    ),
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

  it('consumes a direct overlay tap, including blank areas on iOS, and cancels a paused intro', async () => {
    const env = setup();
    env.play({ pauseAt: .18 });
    await resolveFonts(env.fonts);
    const interaction = new Event('click', { cancelable: true });
    // Dispatch directly: a document-level handler alone does not make a blank
    // div clickable in iOS Safari, so the overlay must also own its handler.
    env.body.children[0].dispatchEvent(interaction);
    expect(interaction.defaultPrevented).toBe(true);
    expect(env.body.children).toHaveLength(0);
    expect(env.target.style.visibility).toBe('');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    env.animations.forEach((animation) => expect(animation.cancel).toHaveBeenCalledTimes(1));
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

describe('brand intro text rendering', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each([
    { variant: 'dashboard', fontSize: 24, viewportWidth: 390, openingSize: 125.8, composedSize: 68 },
    { variant: 'login', fontSize: 64, viewportWidth: 390, openingSize: 125.8, composedSize: 68 },
    { variant: 'narrow dashboard', fontSize: 24, viewportWidth: 320, openingSize: 106.56, composedSize: 57.6 },
    { variant: 'narrow login', fontSize: 64, viewportWidth: 320, openingSize: 106.56, composedSize: 57.6 },
  ])('paints $variant at displayed font sizes and lands on measured letter positions', async ({
    fontSize, viewportWidth, openingSize, composedSize,
  }) => {
    const env = setup({ fontSize, viewportWidth });
    const cleanup = env.play();
    await resolveFonts(env.fonts);
    const mark = env.body.children[0].children[1];
    const textAnimations = mark.children.map((child) => env.animations.find((animation) => animation.element === child)!);

    // Text must repaint at its actual size: no scaled ancestor or transformed
    // glyph layer may turn a masthead-sized backing into an enlarged bitmap.
    expect(textAnimations).toHaveLength(3);
    expect(env.animations.some((animation) => animation.element === mark)).toBe(false);
    textAnimations.forEach((animation, index) => {
      expect(animation).toBeDefined();
      expect(animation.options).toMatchObject({ duration: 1800, fill: 'both' });
      animation.keyframes.forEach((frame) => {
        expect(frame.transform).toBeUndefined();
        expect(frame.scale).toBeUndefined();
        expect(Number.parseFloat(String(frame.fontSize))).toBeGreaterThan(0);
      });
      const landing = animation.keyframes.at(-1)!;
      expect(landing.offset).toBe(1);
      expect(Number.parseFloat(String(landing.fontSize))).toBe(fontSize);
      expect(Number.parseFloat(String(landing.left))).toBeCloseTo(env.childBounds[index].left, 8);
      expect(Number.parseFloat(String(landing.top))).toBeCloseTo(env.childBounds[index].top, 8);
    });

    const pOpening = textAnimations[1].keyframes.find((frame) => frame.offset === .17)!;
    expect(Number.parseFloat(String(pOpening.fontSize))).toBeCloseTo(openingSize, 8);
    const enlargedPWidth = env.childBounds[1].width * openingSize / fontSize;
    expect(Number.parseFloat(String(pOpening.left)) + enlargedPWidth / 2).toBeCloseTo(viewportWidth / 2, 8);

    const composed = textAnimations.map((animation) => animation.keyframes.find((frame) => frame.offset === .54)!);
    composed.forEach((frame) => expect(Number.parseFloat(String(frame.fontSize))).toBeCloseTo(composedSize, 8));
    const composedLeft = Number.parseFloat(String(composed[0].left));
    const composedRight = Number.parseFloat(String(composed[2].left)) + env.childBounds[2].width * composedSize / fontSize;
    expect((composedLeft + composedRight) / 2).toBeCloseTo(viewportWidth / 2, 8);
    expect(env.target.style.visibility).toBe('hidden');
    cleanup();
  });

  it('pauses every visual on the same preview frame and still cleans up on interruption', async () => {
    const env = setup();
    env.play({ duration: 2400, pauseAt: .18 });
    await resolveFonts(env.fonts);
    expect(env.animations.length).toBeGreaterThan(0);
    env.animations.forEach((animation) => {
      expect(animation.pause).toHaveBeenCalledTimes(1);
      expect(animation.currentTime).toBe(432);
    });
    env.win.dispatchEvent(new Event('resize'));
    expect(env.body.children).toHaveLength(0);
    expect(env.target.style.visibility).toBe('');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    env.animations.forEach((animation) => expect(animation.cancel).toHaveBeenCalledTimes(1));
  });
});
