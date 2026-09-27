import { NeutralToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';

/**
 * Renderer lifecycle shared by every Kinetic 3D scene. Only ever imported
 * lazily (it pulls in three.js).
 *
 * - Draws on demand: `invalidate()` paints one frame; `frame` returns true
 *   while it still has motion to show, and the loop stops when it returns
 *   false. Nothing renders while idle.
 * - Pauses while offscreen or while the document is hidden.
 * - Caps device pixel ratio, follows its container's size, reports context
 *   loss, and releases the GPU context on dispose (iOS limits live contexts).
 */
export interface SceneHost {
  renderer: WebGLRenderer;
  width: number;
  height: number;
  invalidate(): void;
  dispose(): void;
}

interface HostOptions {
  /** Advance and draw one frame; return true to keep animating. */
  frame: (dt: number, host: SceneHost) => boolean;
  onResize?: (width: number, height: number) => void;
  onContextLost?: () => void;
  maxPixelRatio?: number;
}

export function createSceneHost(canvas: HTMLCanvasElement, options: HostOptions): SceneHost {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(options.maxPixelRatio ?? 2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setClearColor(0x000000, 0);

  let raf = 0;
  let last = 0;
  let visible = true;
  let disposed = false;

  const host: SceneHost = {
    renderer,
    width: 0,
    height: 0,
    invalidate,
    dispose,
  };

  function tick(now: number) {
    raf = 0;
    if (disposed || !visible || document.visibilityState === 'hidden' || host.width === 0) {
      last = 0;
      return;
    }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const keepGoing = options.frame(dt, host);
    if (keepGoing) raf = requestAnimationFrame(tick);
    else last = 0;
  }

  function invalidate() {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  }

  const container = canvas.parentElement ?? canvas;
  const resize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === host.width && height === host.height) return;
    host.width = width;
    host.height = height;
    renderer.setSize(width, height, false);
    options.onResize?.(width, height);
    invalidate();
  };
  resize();
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(container);

  const intersection = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) invalidate();
      });
  intersection?.observe(canvas);

  const onVisibility = () => {
    if (document.visibilityState === 'visible') invalidate();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    intersection?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return host;
}
