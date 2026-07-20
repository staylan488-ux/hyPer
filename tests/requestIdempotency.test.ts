import { describe, expect, it } from 'vitest';

import { createRequestIdempotencyKey } from '@/lib/requestIdempotency';

describe('request idempotency keys', () => {
  it('is stable for the same request and changes with the body', async () => {
    const first = await createRequestIdempotencyKey('photo', '{"a":1}');
    const again = await createRequestIdempotencyKey('photo', '{"a":1}');
    const changed = await createRequestIdempotencyKey('photo', '{"a":2}');
    expect(first).toBe(again);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^photo:[a-f0-9]{64}$/);
  });
});

