import { useEffect, useRef } from 'react';

/** A static, theme-aware paper texture. No ongoing canvas animation. */

const TILE = 128;
const FRAME_COUNT = 6;
const SCALE = 0.66; // chunky film grain, cheap backing store

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
    let frame = 0;


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

    buildTiles();
    resize();
    paint();

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
      clearTimeout(resizeTimer);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="papergrain" aria-hidden />
    </>
  );
}
