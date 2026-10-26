import { requireNativeModule } from 'expo';
import { findNodeHandle } from 'react-native';

export type WindowFrame = { x: number; y: number; width: number; height: number };

interface HyperViewNative {
  windowFrame(viewTag: number): Promise<WindowFrame | null>;
}

let loaded: HyperViewNative | null = null;
const native = (): HyperViewNative => (loaded ??= requireNativeModule<HyperViewNative>('HyperView'));

/**
 * Where a mounted view sits on screen, in window points, as iOS laid it out.
 * Null when the view is not on screen or cannot be found.
 */
export async function windowFrame(view: Parameters<typeof findNodeHandle>[0]): Promise<WindowFrame | null> {
  const tag = findNodeHandle(view);
  if (tag == null) return null;
  try {
    return await native().windowFrame(tag);
  } catch {
    return null;
  }
}
