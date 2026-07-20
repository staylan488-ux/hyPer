import { useEffect, useRef } from 'react';

/**
 * Living paper — the app's atmosphere layer.
 *
 * Two parts, both purely decorative (pointer-events: none, aria-hidden):
 *  - .paperlight: a barely-there warm light that drifts over the page like
 *    a slow afternoon across a desk. Plain alpha, monochrome-adjacent warmth,
 *    never a surface gradient. Static under prefers-reduced-motion.
 *  - .papergrain: animated film grain on a canvas, replacing the old static
 *    SVG noise. Ink-coloured specks at ~9fps, so the page feels printed on
 *    stock that breathes. Theme-aware (rebuilt when .dark/.light flips),
 *    paused when the tab is hidden, a single static frame under reduced motion.
 */

const TILE = 128;
const FRAME_COUNT = 6;
const SCALE = 0.66; // chunky film grain, cheap backing store
const FRAME_MS = 110; // ~9fps flicker — filmic, not video

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const value = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function PaperAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let tiles: HTMLCanvasElement[] = [];
    let raf = 0;
    let last = 0;
    let frame = 0;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const buildTiles = () => {
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim();
      const [r, g, b] = hexToRgb(ink || '#1A1612');
      tiles = Array.from({ length: FRAME_COUNT }, () => {
        const tile = document.createElement('canvas');
        tile.width = TILE;
        tile.height = TILE;
        const tctx = tile.getContext('2d');
        if (!tctx) return tile;
        const img = tctx.createImageData(TILE, TILE);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          // pow() skews alpha low so specks stay sparse and soft
          img.data[i + 3] = Math.pow(Math.random(), 1.6) * 255;
        }
        tctx.putImageData(img, 0, 0);
        return tile;
      });
    };

    const resize = () => {
      canvas.width = Math.ceil(window.innerWidth * SCALE);
      canvas.height = Math.ceil(window.innerHeight * SCALE);
    };

    const paint = () => {
      const { width, height } = canvas;
      if (tiles.length === 0 || width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);
      frame += 1;
      for (let y = 0; y < height; y += TILE) {
        for (let x = 0; x < width; x += TILE) {
          const idx = (((x / TILE) * 7 + (y / TILE) * 13 + frame) % FRAME_COUNT + FRAME_COUNT) % FRAME_COUNT;
          ctx.drawImage(tiles[idx], x, y);
        }
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < FRAME_MS) return;
      last = t;
      paint();
    };

    buildTiles();
    resize();

    if (reduced.matches) {
      paint(); // one still frame, no flicker
    } else {
      raf = requestAnimationFrame(loop);
    }

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        paint();
      }, 150);
    };

    // Theme flip (.dark/.light on <html>) → re-ink the grain
    const observer = new MutationObserver(() => {
      buildTiles();
      paint();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <>
      <div className="paperlight" aria-hidden />
      <canvas ref={canvasRef} className="papergrain" aria-hidden />
    </>
  );
}
