import { describe, expect, it, vi } from 'vitest';

import { createDatabaseLedger } from '../supabase/functions/analyze-food-trial/databaseLedger';

const USER = '11111111-1111-4111-8111-111111111111';
const PATH = `food-v1/${USER}/2026-11-08/slots/0.json`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function harness() {
  const legacy = { assertPrivate: vi.fn(async () => {}), read: vi.fn<() => Promise<unknown | null>>(async () => null) };
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
  const ledger = createDatabaseLedger({ url: 'https://project.supabase.co/', serviceRoleKey: 'test-only', legacy, fetch: send });
  return { legacy, send, ledger };
}

describe('database food ledger', () => {
  it('inserts with the path owner and never upserts or writes to legacy storage', async () => {
    const h = harness();
    expect(await h.ledger.insert(PATH, { requestId: 'abc' })).toBe(true);
    expect(h.legacy.read).toHaveBeenCalledWith(PATH);
    const [url, init] = h.send.mock.calls[0];
    expect(url).toBe('https://project.supabase.co/rest/v1/food_analysis_ledger');
    expect(init).toMatchObject({ method: 'POST', headers: { Prefer: 'return=minimal', Authorization: 'Bearer test-only', apikey: 'test-only' } });
    expect(JSON.parse(String(init?.body))).toEqual({ path: PATH, user_id: USER, value: { requestId: 'abc' } });
  });

  it('honors existing legacy claims and slots without a new database reservation', async () => {
    const h = harness();
    h.legacy.read.mockResolvedValue({ requestId: 'already-billed' });
    expect(await h.ledger.insert(PATH, { requestId: 'new' })).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('recognizes only explicit unique-key collisions, not FK, permission or server failures', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => json({ code: '23505' }, 409));
    expect(await h.ledger.insert(PATH, {})).toBe(false);
    for (const [status, code] of [[409, '23503'], [409, '42501'], [409, 'unknown'], [500, '23505']] as const) {
      h.send.mockImplementationOnce(async () => json({ code, message: 'private database detail' }, status));
      await expect(h.ledger.insert(PATH, {})).rejects.toThrow('Ledger claim failed');
    }
  });

  it('does not turn a lost write response into permission for a second reservation', async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(new Error('connection lost'));
    await expect(h.ledger.insert(PATH, {})).rejects.toThrow();
    expect(h.send).toHaveBeenCalledOnce();
  });

  it('reads database rows first, with owner and path filters, and falls back only when absent', async () => {
    const h = harness();
    h.send.mockImplementationOnce(async () => json([{ value: { status: 200, body: { summary: 'Meal' } } }]));
    expect(await h.ledger.read(PATH)).toEqual({ status: 200, body: { summary: 'Meal' } });
    const url = new URL(String(h.send.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ path: `eq.${PATH}`, user_id: `eq.${USER}`, select: 'value', limit: '1' });
    expect(h.legacy.read).not.toHaveBeenCalled();
    h.send.mockImplementationOnce(async () => json([]));
    h.legacy.read.mockResolvedValue({ requestId: 'legacy' });
    expect(await h.ledger.read(PATH)).toEqual({ requestId: 'legacy' });
    expect(h.legacy.read).toHaveBeenCalledWith(PATH);
  });

  it('fails closed on database/legacy outages and malformed records', async () => {
    const h = harness();
    for (const response of [json({ code: '42P01' }, 404), json({ code: '42501' }, 403), json({ value: {} }), json([{}]), json([{ value: null }])]) {
      h.send.mockResolvedValueOnce(response);
      await expect(h.ledger.read(PATH)).rejects.toThrow();
    }
    expect(h.legacy.read).not.toHaveBeenCalled();
    h.legacy.read.mockRejectedValue(new Error('Storage unavailable'));
    h.send.mockClear();
    await expect(h.ledger.insert(PATH, {})).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('requires the legacy bucket to be private and the database ledger to be ready', async () => {
    const h = harness();
    h.legacy.assertPrivate.mockRejectedValueOnce(new Error('public bucket'));
    await expect(h.ledger.assertPrivate()).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
    h.send.mockResolvedValueOnce(json({ code: '42P01' }, 404));
    await expect(h.ledger.assertPrivate()).rejects.toThrow();
    h.send.mockResolvedValueOnce(json([]));
    await expect(h.ledger.assertPrivate()).resolves.toBeUndefined();
  });

  it('rejects invalid or unowned paths before either backend is accessed', async () => {
    const h = harness();
    for (const path of ['food-v1/not-a-user/2026-11-08/slots/0.json', `${PATH}?user_id=eq.other`, `other/${USER}/slot.json`]) {
      await expect(h.ledger.insert(path, {})).rejects.toThrow('Invalid ledger path');
      await expect(h.ledger.read(path)).rejects.toThrow('Invalid ledger path');
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.legacy.read).not.toHaveBeenCalled();
  });
});
