// Debug builds only: the molten-glass field playing glass6.html's reference script, for
// side-by-side checks against the approved clip. Open it with launch arguments:
//
//   xcrun simctl launch <device> app.hyper.native -hyperRoute /glass-test \
//     [-hyperGlassSize small|full] [-hyperGlassLook dark|light] [-hyperGlassSnap 1|all|<frames>] [-hyperGlassDot 1]
//     [-hyperGlassDemo keep|fade] [-hyperGlassMode live]
//
// small is the reference's 270 × 587 pt phone (rounded like it), full fills the screen.
// The script normally loops every 10 s. -hyperGlassDemo keep plays it once and lets the field
// run on with the keep-alive that stops the glass thinning away; fade does the same without
// it (the reference left alone). Both log how much glass is showing once a simulated second.
// -hyperGlassSnap takes 1 (the four compared frames), all, or frame numbers such as 600,1800.
// live runs the field as the app does (real time, 30 fps idle) and drives the same script
// through the public calls (touch, wave, stir) from JavaScript, every 20 s; real touches on
// the screen stir it too.
// Release builds have no such page: the route leads to the app.
import { Redirect } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { Settings, StyleSheet, View } from 'react-native';

import { glassNative } from '../../modules/hyper-glass-field';
import { GlassField, glassStir, glassTouchHandlers, glassWave } from '~/components/GlassField';

/** The reference frames compared side by side: t = 0.99, 3.50, 6.40 and 8.50 s at 16 ms per frame. */
const SNAP_FRAMES = '62,219,400,531';

function arg(name: string): string | undefined {
  try {
    const v = Settings.get(name);
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
  } catch {
    return undefined;
  }
}

export default function GlassTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return arg('hyperGlassMode') === 'live' ? <LiveTest /> : <DemoTest />;
}

function DemoTest() {
  const size = arg('hyperGlassSize') === 'full' ? 'full' : 'small';
  const look = arg('hyperGlassLook') === 'light' ? 'light' : 'dark';
  const snapArg = arg('hyperGlassSnap');
  const demoArg = arg('hyperGlassDemo');
  const demo: 'reference' | 'keep' | 'fade' = demoArg === 'keep' || demoArg === 'fade' ? demoArg : 'reference';
  // 1: the four compared frames as PNGs; all: every frame as JPEGs (for a frame-exact video);
  // a list of frame numbers: those frames as PNGs.
  const snap =
    snapArg === '1'
      ? `glass-snaps|${size}-${look}|${SNAP_FRAMES}`
      : snapArg === 'all'
        ? `glass-frames-${size}-${look}|f|all`
        : snapArg && /^\d+(,\d+)*$/.test(snapArg)
          ? `glass-snaps|${demo}-${size}-${look}|${snapArg}`
          : undefined;
  const debug = { demo, demoDot: arg('hyperGlassDot') === '1', snapshot: snap, debugStats: true };
  return (
    <View style={styles.page}>
      {size === 'full' ? (
        <GlassField appearance={look} debug={debug} />
      ) : (
        <View style={styles.phone}>
          <GlassField appearance={look} debug={debug} />
        </View>
      )}
    </View>
  );
}

/** glass6.html's finger and press, in its 270 × 587 frame (ms from the script's start). */
function fingerAt(t: number): { x: number; y: number; press: boolean } | null {
  const down = 2500, up = 4300;
  if (t >= down - 150 && t <= up + 200) {
    const k = Math.min(1, Math.max(0, (t - down) / (up - down)));
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    return { x: 210 - 140 * e + 22 * Math.sin(e * Math.PI * 2), y: 480 - 230 * e, press: t >= down && t <= up };
  }
  return null;
}

function LiveTest() {
  const size = arg('hyperGlassSize') === 'full' ? 'full' : 'small';
  const look = arg('hyperGlassLook') === 'light' ? 'light' : 'dark';
  const box = useRef<ComponentRef<typeof View>>(null);
  const [dot, setDot] = useState<{ x: number; y: number; press: boolean } | null>(null);

  useEffect(() => {
    let frame = 0;
    let origin = { x: 0, y: 0, w: 270, h: 587 };
    let start = 0;
    let pressed = false;
    let waved = false;
    const loop = (now: number) => {
      if (!start) {
        start = now + 1500;
        box.current?.measureInWindow((x, y, w, h) => (origin = { x, y, w, h }));
      }
      const t = (now - start) % 20000;
      const sx = origin.w / 270, sy = origin.h / 587;
      const fg = t >= 0 ? fingerAt(t) : null;
      const at = (p: { x: number; y: number }) => [origin.x + p.x * sx, origin.y + p.y * sy] as const;
      if (fg?.press) {
        const [x, y] = at(fg);
        glassNative?.touch(pressed ? 1 : 0, x, y);
        pressed = true;
      } else if (pressed) {
        glassNative?.touch(2, 0, 0);
        pressed = false;
      }
      // Train's Log set, as in the reference.
      if (t >= 6000 && t < 6200 && !waved) {
        const [x, y] = at({ x: 135, y: 353 });
        glassWave(x, y);
        waved = true;
      }
      if (t < 6000) waved = false;
      // A scroll: the page moving up 12 pt a frame for a second.
      if (t >= 9000 && t < 10000) glassStir(0, 12);
      setDot(fg ? { x: fg.x * sx, y: fg.y * sy, press: fg.press } : t >= 6000 && t < 6280 ? { x: 135 * sx, y: 353 * sy, press: t < 6130 } : null);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const light = look === 'light';
  const dotView = dot ? (
    <View
      pointerEvents="none"
      style={[
        styles.dot,
        {
          left: dot.x - 17,
          top: dot.y - 17,
          opacity: dot.press ? 1 : 0.55,
          backgroundColor: light ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.30)',
          borderColor: light ? 'rgba(0,0,0,.30)' : 'rgba(255,255,255,.55)',
        },
      ]}
    />
  ) : null;
  return (
    <View style={styles.page} {...glassTouchHandlers}>
      <View ref={box} style={size === 'full' ? StyleSheet.absoluteFill : styles.phone} collapsable={false}>
        <GlassField appearance={look} debug={{ debugStats: true }} />
        {dotView}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 1 },
  page: { flex: 1, backgroundColor: '#0B0B0B', alignItems: 'center', justifyContent: 'center' },
  phone: { width: 270, height: 587, borderRadius: 34, overflow: 'hidden' },
});
