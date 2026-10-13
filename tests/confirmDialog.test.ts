import { describe, expect, it, vi } from 'vitest';
import { currentConfirm, registerConfirmHost, requestConfirm, settleConfirm, subscribeConfirm } from '@/lib/confirmDialog';

describe('in-app confirm', () => {
  it('answers no when no dialog host is mounted', async () => {
    expect(await requestConfirm({ title: 'Discard?' })).toBe(false);
    expect(currentConfirm()).toBeNull();
  });

  it('shows one question at a time and resolves with the choice', async () => {
    const release = registerConfirmHost();
    const listener = vi.fn();
    const unsubscribe = subscribeConfirm(listener);

    const first = requestConfirm({ title: 'First?' });
    expect(currentConfirm()).toMatchObject({ title: 'First?' });
    const second = requestConfirm({ title: 'Second?', destructive: true });
    expect(await first).toBe(false);
    expect(currentConfirm()).toMatchObject({ title: 'Second?', destructive: true });

    settleConfirm(true);
    expect(await second).toBe(true);
    expect(currentConfirm()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);

    const pending = requestConfirm({ title: 'Unmounted?' });
    release();
    expect(await pending).toBe(false);
    unsubscribe();
  });
});
