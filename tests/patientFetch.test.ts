import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkerUnreachableError, patientPost } from '@/lib/patientFetch';

const abortError = () => new DOMException('aborted', 'AbortError');

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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

  it('says the worker is unreachable within seconds, not after the whole budget', async () => {
    // refused connection / DNS failure / offline: fetch rejects instantly
    vi.useFakeTimers();
    const mock = vi.fn().mockRejectedValue(new TypeError('Load failed'));
    vi.stubGlobal('fetch', mock);
    const result = patientPost({ url: 'http://127.0.0.1:1/x', body: '{}', headers: {} });
    const settled = expect(result).rejects.toBeInstanceOf(WorkerUnreachableError);
    await vi.advanceTimersByTimeAsync(20_000);
    await settled;
    await expect(result).rejects.toThrow(/Can't reach the food-analysis worker/);
    // about one attempt per 2 s retry until the 15 s window: a handful, not ~450
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(mock.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('keeps re-attaching once an attempt has reached the worker', async () => {
    // the first attempt stayed open (the job started), then the socket was
    // killed; later instant failures are a network blip, not a dead worker
    const ok = new Response('{}', { status: 200 });
    let calls = 0;
    const mock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new TypeError('Load failed');
      }
      if (calls < 12) throw new TypeError('Load failed');
      return ok;
    });
    vi.stubGlobal('fetch', mock);
    await expect(post({
      reachedAfterMs: 20,
      unreachableAfterAttempts: 2,
      unreachableAfterMs: 0,
      totalBudgetMs: 2_000,
    })).resolves.toBe(ok);
    expect(mock).toHaveBeenCalledTimes(12);
  });

  it('never fails fast on timeouts - a hang looks like a long job', async () => {
    const mock = vi.fn().mockRejectedValue(abortError());
    vi.stubGlobal('fetch', mock);
    const result = post({
      unreachableAfterAttempts: 1,
      unreachableAfterMs: 0,
      totalBudgetMs: 60,
      retryDelayMs: 5,
    });
    await expect(result).rejects.not.toBeInstanceOf(WorkerUnreachableError);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('replaces a raw network error with a plain message when the budget runs out', async () => {
    let calls = 0;
    const mock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 30));
      throw new TypeError('Load failed');
    });
    vi.stubGlobal('fetch', mock);
    const result = post({ reachedAfterMs: 20, totalBudgetMs: 120, retryDelayMs: 5 });
    await expect(result).rejects.not.toThrow('Load failed');
    await expect(result).rejects.toThrow(/food-analysis worker/);
  });
});
