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
    style = { visibility: '', top: '', left: '', fontSize: '', transform: '' };
    attributes = new Map<string, string>();
    inert = false;
    bounds = bounds(0, 0, 0, 0);
    paintedBounds?: ReturnType<typeof bounds>;
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    append(child: FakeElement) { this.children.push(child); child.parent = this; }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
    getBoundingClientRect() {
      if (this.paintedBounds) return this.paintedBounds;
      if (this.style.left) {
        const translation = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(this.style.transform);
        return bounds(
          parseFloat(this.style.left) + Number(translation?.[1] ?? 0),
          parseFloat(this.style.top) + Number(translation?.[2] ?? 0), 0, 0,
        );
      }
      return this.bounds;
    }
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
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const win = Object.assign(new EventTarget(), {
    innerWidth: viewportWidth, innerHeight: 844,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
  });
  const doc = Object.assign(new EventTarget(), {
    body, documentElement, getElementById: () => root,
    createElement: () => new FakeElement(), fonts: { load: () => fonts.promise },
  });
  const preference = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', () => ({ fontSize: `${fontSize}px` }));
  return {
    target, body, documentElement, root, fonts, animations, win, preference, childBounds, frames,
    frame: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    },
    moveTarget: (dx: number, dy: number) => {
      [target, ...target.children].forEach((element) => {
        const box = element.bounds;
        element.bounds = bounds(box.left + dx, box.top + dy, box.width, box.height);
      });
    },
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
    env.frame();
    env.frame();
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
  ])('keeps $variant crisp with fixed large text layers and lands on measured letter positions', async ({
    fontSize, viewportWidth, openingSize, composedSize,
  }) => {
    const env = setup({ fontSize, viewportWidth });
    const cleanup = env.play();
    await resolveFonts(env.fonts);
    const mark = env.body.children[0].children[1];
    const textAnimations = mark.children.map((child) => env.animations.find((animation) => animation.element === child)!);

    const renderedPose = (animation: typeof textAnimations[number], frame: Keyframe) => {
      const match = /^translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)$/.exec(String(frame.transform));
      expect(match).not.toBeNull();
      return {
        left: parseFloat(mark.style.left) + Number(match![1]),
        top: parseFloat(mark.style.top) + Number(match![2]),
        fontSize: parseFloat(animation.element.style.fontSize) * Number(match![3]),
        scale: Number(match![3]),
      };
    };
    // Each layer's native text is large enough for its full animation. No
    // ancestor magnification or per-frame font/layout writes are allowed.
    expect(textAnimations).toHaveLength(3);
    expect(env.animations.some((animation) => animation.element === mark)).toBe(false);
    textAnimations.forEach((animation, index) => {
      expect(animation).toBeDefined();
      expect(animation.options).toMatchObject({ duration: 1800, fill: 'both' });
      expect(parseFloat(animation.element.style.fontSize)).toBeCloseTo(
        Math.max(fontSize, index === 1 ? openingSize : composedSize), 8,
      );
      animation.keyframes.forEach((frame) => {
        expect(Object.keys(frame).every((key) => ['transform', 'opacity', 'offset', 'easing'].includes(key))).toBe(true);
        const pose = renderedPose(animation, frame);
        expect(pose.scale).toBeGreaterThan(0);
        expect(pose.scale).toBeLessThanOrEqual(1);
      });
      const landing = animation.keyframes.at(-1)!;
      const pose = renderedPose(animation, landing);
      expect(landing.offset).toBe(1);
      expect(pose.fontSize).toBeCloseTo(fontSize, 8);
      expect(pose.left).toBeCloseTo(env.childBounds[index].left, 8);
      expect(pose.top).toBeCloseTo(env.childBounds[index].top, 8);
    });

    const pOpening = textAnimations[1].keyframes.find((frame) => frame.offset === .17)!;
    const openingPose = renderedPose(textAnimations[1], pOpening);
    expect(openingPose.fontSize).toBeCloseTo(openingSize, 8);
    const enlargedPWidth = env.childBounds[1].width * openingSize / fontSize;
    expect(openingPose.left + enlargedPWidth / 2).toBeCloseTo(viewportWidth / 2, 8);

    const composed = textAnimations.map((animation) => renderedPose(animation, animation.keyframes.find((frame) => frame.offset === .54)!));
    composed.forEach((pose) => expect(pose.fontSize).toBeCloseTo(composedSize, 8));
    const composedLeft = composed[0].left;
    const composedRight = composed[2].left + env.childBounds[2].width * composedSize / fontSize;
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

describe('brand intro live landing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('does not restart animations while geometry is stable and reveals the masthead after two settled frames', async () => {
    const env = setup();
    env.play();
    await resolveFonts(env.fonts);
    const animationCount = env.animations.length;
    for (let index = 0; index < 10; index++) env.frame();
    expect(env.animations).toHaveLength(animationCount);
    expect(env.frames.size).toBe(1);
    env.animations[0].complete();
    await Promise.resolve();
    env.frame();
    expect(env.target.style.visibility).toBe('hidden');
    env.frame();
    expect(env.target.style.visibility).toBe('');
    expect(env.body.children).toHaveLength(0);
    expect(env.frames.size).toBe(0);
  });

  it('follows a viewport shift during flight using translation alone and preserves the original glyph animations', async () => {
    const env = setup();
    env.play();
    await resolveFonts(env.fonts);
    const mark = env.body.children[0].children[1];
    const originalAnimations = [...env.animations];
    env.moveTarget(9, 62);
    env.frame();
    const correction = env.animations.at(-1)!;
    expect(correction.element).toBe(mark);
    expect(correction.options.duration).toBe(160);
    expect(correction.keyframes).toEqual([
      { transform: 'translate(0px, 0px)' },
      { transform: 'translate(9px, 62px)' },
    ]);
    originalAnimations.forEach((animation) => expect(animation.cancel).not.toHaveBeenCalled());
    correction.complete();
    await Promise.resolve();
    env.frame();
    env.frame();
    expect(env.target.style.visibility).toBe('hidden');
    expect(mark.getBoundingClientRect().left).toBe(env.target.bounds.left);
    expect(mark.getBoundingClientRect().top).toBe(env.target.bounds.top);
    originalAnimations[0].complete();
    await Promise.resolve();
    env.frame();
    env.frame();
    expect(env.target.style.visibility).toBe('');
    expect(env.frames.size).toBe(0);
  });

  it('waits for a late notch correction after flight completion before handing off to the real masthead', async () => {
    const env = setup();
    env.play();
    await resolveFonts(env.fonts);
    env.animations[0].complete();
    await Promise.resolve();
    env.frame();
    env.moveTarget(0, 62);
    env.frame();
    const correction = env.animations.at(-1)!;
    expect(correction.keyframes.at(-1)).toEqual({ transform: 'translate(0px, 62px)' });
    env.frame();
    env.frame();
    expect(env.target.style.visibility).toBe('hidden');
    correction.complete();
    await Promise.resolve();
    env.frame();
    expect(env.target.style.visibility).toBe('hidden');
    env.frame();
    expect(env.target.style.visibility).toBe('');
    expect(env.documentElement.getAttribute('data-brand-intro')).toBeNull();
    expect(env.frames.size).toBe(0);
  });

  it('retargets from the currently painted position when the destination moves again', async () => {
    const env = setup();
    env.play();
    await resolveFonts(env.fonts);
    const mark = env.body.children[0].children[1];
    env.moveTarget(0, 62);
    env.frame();
    const firstCorrection = env.animations.at(-1)!;
    // Represent a compositor frame partway through the first correction. A
    // restart from its old endpoint would introduce another visible jump.
    mark.paintedBounds = { ...mark.bounds, left: 37.25, top: 119, right: 37.25, bottom: 119 };
    env.moveTarget(20, -14);
    env.frame();
    const secondCorrection = env.animations.at(-1)!;
    expect(firstCorrection.cancel).toHaveBeenCalledTimes(1);
    expect(secondCorrection.keyframes).toEqual([
      { transform: 'translate(0px, 27.5px)' },
      { transform: 'translate(20px, 48px)' },
    ]);
    // A stale completion must not clear the new correction or reveal the page.
    firstCorrection.complete();
    env.animations[0].complete();
    await Promise.resolve();
    env.frame();
    env.frame();
    expect(env.target.style.visibility).toBe('hidden');
    mark.paintedBounds = undefined;
    secondCorrection.complete();
    await Promise.resolve();
    env.frame();
    expect(mark.getBoundingClientRect().left).toBe(env.target.bounds.left);
    expect(mark.getBoundingClientRect().top).toBe(env.target.bounds.top);
    env.frame();
    expect(env.target.style.visibility).toBe('');
    expect(env.frames.size).toBe(0);
  });

  it('removes queued tracking and ignores late callbacks when interrupted during correction', async () => {
    const env = setup();
    const cleanup = env.play({ pauseAt: .999 });
    await resolveFonts(env.fonts);
    env.moveTarget(0, 62);
    env.frame();
    const correction = env.animations.at(-1)!;
    const queuedCallback = [...env.frames.values()][0];
    const animationCount = env.animations.length;
    cleanup();
    expect(env.frames.size).toBe(0);
    expect(correction.cancel).toHaveBeenCalledTimes(1);
    expect(env.target.style.visibility).toBe('');
    env.moveTarget(0, 10);
    queuedCallback(0);
    correction.complete();
    await Promise.resolve();
    expect(env.animations).toHaveLength(animationCount);
    expect(env.body.children).toHaveLength(0);
    expect(env.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
