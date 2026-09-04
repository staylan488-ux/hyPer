import { describe, expect, it, vi } from 'vitest';
import { createWheelSelection } from '@/lib/wheelSelection';

describe('time wheel selection', () => {
  it('keeps an explicit minute when queued centering scrolls report an intermediate value', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.beginGesture();
    wheel.choose(30);
    // The old smooth centering + debounce could write 28 after tapping Done.
    wheel.scroll(28);
    wheel.scroll(29);
    wheel.scroll(30);
    expect(change.mock.calls).toEqual([[30]]);
  });

  it('accepts the next user scroll immediately without a timer that can outlive Done', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.choose(30);
    wheel.beginGesture();
    wheel.scroll(31);
    expect(change.mock.calls).toEqual([[30], [31]]);
    wheel.scroll(31);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('ignores opening layout scrolls and preserves the latest of rapid explicit taps', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.scroll(0);
    expect(change).not.toHaveBeenCalled();
    wheel.choose(30);
    wheel.choose(32);
    wheel.scroll(30);
    expect(change.mock.calls).toEqual([[30], [32]]);
  });
});
