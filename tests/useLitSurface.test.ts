import { describe, expect, it, vi } from 'vitest';

// Run the hook's callback outside a renderer: useCallback just returns it.
vi.mock('react', () => ({ useCallback: <T,>(callback: T) => callback }));
const { release } = vi.hoisted(() => ({ release: vi.fn() }));
vi.mock('../src/lib/litSurfaces', () => ({ registerLitSurface: vi.fn(() => release) }));

import { registerLitSurface } from '../src/lib/litSurfaces';
import { useLitSurface } from '../src/hooks/useLitSurface';

const element = { id: 'bar' } as unknown as HTMLElement;

describe('useLitSurface', () => {
  it('keeps a merged setter ref working as before (RestTimerPill measurement)', () => {
    const setBar = vi.fn();
    const ref = useLitSurface(setBar);
    const cleanup = ref(element);
    expect(setBar).toHaveBeenLastCalledWith(element);
    expect(registerLitSurface).toHaveBeenCalledWith(element);

    expect(typeof cleanup).toBe('function');
    (cleanup as () => void)();
    expect(setBar).toHaveBeenLastCalledWith(null);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps a merged ref object current (Modal dialog, drag ghost)', () => {
    const own = { current: null as HTMLElement | null };
    const cleanup = useLitSurface(own)(element) as () => void;
    expect(own.current).toBe(element);
    cleanup();
    expect(own.current).toBeNull();
  });

  it('lights several elements through one ref, each released on its own', () => {
    const ref = useLitSurface();
    const other = { id: 'menu' } as unknown as HTMLElement;
    const first = ref(element) as () => void;
    const second = ref(other) as () => void;
    expect(registerLitSurface).toHaveBeenCalledWith(other);
    first();
    second();
    expect(release).toHaveBeenCalledTimes(2);
  });
});
