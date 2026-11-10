import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

interface HyperGlassFieldNative {
  /** False when the phone has no Metal device or the shaders failed to build. */
  available?: boolean;
  /** A finger on the page, in window points: phase 0 down, 1 moved, 2 up or cancelled. */
  touch(phase: number, x: number, y: number): void;
  /** The page scrolled by (dx, dy) points. */
  stir(dx: number, dy: number): void;
  /** The warm wave from a press at (x, y), in window points. */
  wave(x: number, y: number): void;
  /** A raw splat in the reference's units: x, y in 0…1 with y up; colour 0 for none. */
  splat(x: number, y: number, dx: number, dy: number, r: number, g: number, b: number, radius: number): void;
  /** 'dark' or 'light' for every field, or null to let each follow its own. */
  setAppearance(appearance: 'dark' | 'light' | null): void;
  /** Force Reduce Motion on or off for every field, or null to follow iOS. */
  setReduceMotion(on: boolean | null): void;
}

export type HyperGlassFieldViewProps = ViewProps & {
  appearance?: 'dark' | 'light';
  reduceMotion?: boolean;
  /** Stops the field (and its GPU work) while true. */
  paused?: boolean;
  /** Logs GPU time per frame to the device log every 2 s (also `-hyperGlassStats 1`). */
  debugStats?: boolean;
  /**
   * Debug comparison only, one step per frame: 'reference' loops glass6.html's 10 s script as
   * approved (no keep-alive); 'keep' plays it once and runs on with the keep-alive; 'fade' the
   * same without it. 'keep' and 'fade' log the meter once a simulated second.
   */
  demo?: 'reference' | 'keep' | 'fade';
  /** Debug comparison only: simulated ms per demo frame (16, the reference recording's clock). */
  demoFrameMs?: number;
  /** Debug comparison only: draw the scripted finger as the reference does. */
  demoDot?: boolean;
  /** Debug comparison only: 'dir|name|k1,k2' saves those demo frames as PNGs in Documents/dir. */
  snapshot?: string;
};

/** Null in a build without the module (an older binary): nothing draws and every call is a no-op. */
export const glassNative = requireOptionalNativeModule<HyperGlassFieldNative>('HyperGlassField');

export const hasGlassField = glassNative != null && glassNative.available !== false;

export const HyperGlassFieldView: ComponentType<HyperGlassFieldViewProps> | null = hasGlassField
  ? requireNativeView<HyperGlassFieldViewProps>('HyperGlassField')
  : null;
