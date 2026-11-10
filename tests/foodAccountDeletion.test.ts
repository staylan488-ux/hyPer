import { describe, expect, it, vi } from 'vitest';

import { createTrialHandler } from '../supabase/functions/analyze-food-trial/gateway';
import { memoryGlobalQuota } from './helpers/globalQuota';
import { createDatabaseLedger } from '../supabase/functions/analyze-food-trial/databaseLedger';
import { createStorageLedger } from '../supabase/functions/analyze-food-trial/storageLedger';
import { createDeleteAccountHandler } from '../supabase/functions/delete-account/handler';

const USER = '11111111-1111-4111-8111-111111111111';
const ROOT = 'https://project.supabase.co';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function harness() {
  const legacy = new Map<string, unknown>();
  const records = new Map<string, { user_id: string; path: string; value: unknown }>();
  const users = new Set([USER]);
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/storage/v1/bucket/food-trial') return json({ id: 'food-trial', public: false });
    if (url.pathname.startsWith('/storage/v1/object/food-trial/')) {
      const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/food-trial/'.length));
      if (init?.method === 'POST') {
        if (legacy.has(path)) return json({ code: 'ResourceAlreadyExists' }, 409);
        legacy.set(path, JSON.parse(String(init.body)));
        return json({ Key: path });
      }
      return legacy.has(path) ? json(legacy.get(path)) : json({ code: 'NoSuchKey' }, 404);
    }
    if (url.pathname === '/rest/v1/food_analysis_ledger') {
      if (init?.method === 'POST') {
        const row = JSON.parse(String(init.body));
        if (!users.has(row.user_id)) return json({ code: '23503' }, 409);
        if (records.has(row.path)) return json({ code: '23505' }, 409);
        records.set(row.path, row);
        return new Response(null, { status: 201 });
      }
      const row = records.get(url.searchParams.get('path')?.slice(3) ?? '');
      return json(row ? [{ value: row.value }] : []);
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  const ledger = createDatabaseLedger({
    url: ROOT, serviceRoleKey: 'test-only', fetch: send,
    legacy: createStorageLedger({ url: ROOT, serviceRoleKey: 'test-only', bucket: 'food-trial', fetch: send }),
  });
  const work: Promise<unknown>[] = [];
  const analyze = vi.fn(async () => ({ items: [{ name: 'Private meal' }] }));
  const authenticate = async () => users.has(USER) ? USER : null;
  const gateway = createTrialHandler({
    config: { maxAttempts: 2, maxGlobalAttempts: 50, allowedOrigins: ['https://app.example.com'] },
    ledger, authenticate, isApproved: async () => true, globalQuota: memoryGlobalQuota(), analyze, waitUntil: (task) => { work.push(task); },
    now: () => Date.parse('2026-11-08T20:00:00Z'),
  });
  const removeFoodRecords = vi.fn(async () => { legacy.clear(); });
  const deleteUser = vi.fn(async (id: string) => {
    users.delete(id);
    // PostgreSQL's user FK cascades; real constraint/role checks live in the SQL regression.
    for (const [path, row] of records) if (row.user_id === id) records.delete(path);
  });
  const remove = createDeleteAccountHandler({ authenticate, whoopAccess: async () => null, revokeWhoop: async () => {}, removeFoodRecords, deleteUser });
  const request = (body: unknown) => gateway(new Request(ROOT, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const deleteAccount = () => remove(new Request(ROOT, { method: 'POST', headers: { Authorization: 'Bearer test-token' } }));
  return { legacy, records, users, send, analyze, work, request, deleteAccount, removeFoodRecords, deleteUser, ledger };
}

describe('food analysis crossing account deletion', () => {
  it('cascades results saved before deletion and rejects every kind of late ledger write', async () => {
    const h = harness();
    expect((await h.request({ hint: 'a private meal' })).status).toBe(200);
    expect(h.records.size).toBe(3);
    expect(h.legacy.size).toBe(0);
    expect((await h.deleteAccount()).status).toBe(200);
    for (const kind of ['claims', 'slots', 'results']) {
      await expect(h.ledger.insert(`food-v1/${USER}/2026-11-08/${kind}/0.json`, {})).rejects.toThrow();
    }
    expect(h.records.size).toBe(0);
    expect(h.legacy.size).toBe(0);
    expect(h.send.mock.calls.filter(([url, init]) => String(url).includes('/storage/') && init?.method === 'POST')).toHaveLength(0);
  });

  it('preserves legacy replay, uncertain claims and daily quotas through cutover', async () => {
    const h = harness();
    const initial = await (await h.request({ hint: 'a private meal' })).json();
    // The same data under the old writer; the new ledger starts empty.
    for (const [path, row] of h.records) h.legacy.set(path, row.value);
    h.records.clear();
    expect(await (await h.request({ hint: 'a private meal' })).json()).toMatchObject({ requestId: initial.requestId, replayed: true });
    expect(h.analyze).toHaveBeenCalledOnce();
    h.legacy.delete(`food-v1/${USER}/2026-11-08/results/${initial.requestId}.json`);
    expect((await h.request({ hint: 'a private meal' })).status).toBe(409);
    expect(h.analyze).toHaveBeenCalledOnce();
    expect((await h.request({ hint: 'another meal' })).status).toBe(200);
    expect((await h.request({ hint: 'third meal' })).status).toBe(429);
    expect(h.analyze).toHaveBeenCalledTimes(2);
    expect(await (await h.request({ action: 'status' })).json()).toMatchObject({ attemptsUsed: 2 });
  });

  it('keeps cleanup retryable after a partially removed legacy prefix', async () => {
    const h = harness();
    h.legacy.set(`food-v1/${USER}/old/results/one.json`, { summary: 'Private meal' });
    h.legacy.set(`food-v1/${USER}/old/results/two.json`, { summary: 'Private meal' });
    h.removeFoodRecords.mockImplementationOnce(async () => {
      h.legacy.delete(`food-v1/${USER}/old/results/one.json`);
      throw new Error('lost removal response');
    });
    expect((await h.deleteAccount()).status).toBe(503);
    expect(h.users.has(USER)).toBe(true);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.legacy.size).toBe(1);
    expect((await h.deleteAccount()).status).toBe(200);
    expect(h.legacy.size).toBe(0);
    expect(h.users.size).toBe(0);
  });

  it.each([false, true])('cannot recreate a result after deletion (model failure: %s)', async (failure) => {
    const h = harness();
    let finish!: () => void;
    h.analyze.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => failure ? reject(new Error('upstream failure')) : resolve({ items: [{ name: 'Private meal' }] });
    }));
    const response = await h.request({ hint: 'a private meal', progress: true });
    expect(response.status).toBe(200);
    await response.body!.cancel();
    expect(h.analyze).toHaveBeenCalledOnce();
    expect(h.work).toHaveLength(1);
    expect((await h.deleteAccount()).status).toBe(200);
    expect(h.users.size).toBe(0);
    finish();
    await Promise.all(h.work);
    expect(h.records.size).toBe(0);
    expect(h.legacy.size).toBe(0);
    expect((await h.request({ hint: 'a private meal' })).status).toBe(401);
  });
});
