import { afterEach, describe, expect, it, vi } from 'vitest';

import { patientPost } from '@/lib/patientFetch';

const abortError = () => new DOMException('aborted', 'AbortError');

afterEach(() => { vi.restoreAllMocks(); });

function post(overrides: Partial<Parameters<typeof patientPost>[0]> = {}) {
  return patientPost({
    url: 'http://127.0.0.1:1/x',
    body: '{}',
    headers: {},
    attemptTimeoutMs: 50,
    totalBudgetMs: 400,
    retryDelayMs: 1,
    ...overrides,
  });
}

describe('patientPost', () => {
  it('returns the first real response', async () => {
    const response = new Response('{}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(post()).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries an aborted attempt with the SAME body and headers', async () => {
    // identical bytes -> identical idempotency key -> the worker re-attaches
    const ok = new Response('{}', { status: 200 });
    const mock = vi.fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', mock);
    await expect(post()).resolves.toBe(ok);
    expect(mock).toHaveBeenCalledTimes(2);
    const [first, second] = mock.mock.calls;
    expect(second[1].body).toBe(first[1].body);
    expect(second[1].headers).toEqual(first[1].headers);
  });

  it('retries a network drop too', async () => {
    const ok = new Response('{}', { status: 200 });
    const mock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', mock);
    await expect(post()).resolves.toBe(ok);
  });

  it('an HTTP error is an ANSWER, not a reason to retry', async () => {
    // a 400 from the worker would come back identical every time; retrying it
    // would burn the whole budget re-asking a settled question
    const bad = new Response('{"error":"nope"}', { status: 400 });
    const mock = vi.fn(async () => bad);
    vi.stubGlobal('fetch', mock);
    await expect(post()).resolves.toBe(bad);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('throws a non-transient error immediately', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('worker exploded'));
    vi.stubGlobal('fetch', mock);
    await expect(post()).rejects.toThrow('worker exploded');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('gives up once the budget is spent', async () => {
    const mock = vi.fn().mockRejectedValue(abortError());
    vi.stubGlobal('fetch', mock);
    await expect(post({ totalBudgetMs: 60, retryDelayMs: 10 })).rejects.toThrow();
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
