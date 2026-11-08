import { describe, expect, it, vi } from 'vitest';

import { createDeleteAccountHandler, listFilesUnder, type DeleteAccountServices, type StorageEntry } from '../supabase/functions/delete-account/handler';

const USER = '11111111-1111-4111-8111-111111111111';

function services(overrides: Partial<DeleteAccountServices> = {}) {
  const steps: string[] = [];
  const base: DeleteAccountServices = {
    authenticate: vi.fn(async (token: string) => (token === 'good-token' ? USER : null)),
    revokeWhoop: vi.fn(async (id: string) => { steps.push(`whoop:${id}`); }),
    removeFoodRecords: vi.fn(async (id: string) => { steps.push(`food:${id}`); }),
    deleteUser: vi.fn(async (id: string) => { steps.push(`user:${id}`); }),
    log: vi.fn(),
  };
  return { steps, services: { ...base, ...overrides } };
}

const post = (token?: string) =>
  new Request('https://example.invalid/functions/v1/delete-account', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe('delete-account function', () => {
  it('deletes the signed-in account last, after WHOOP and the food records', async () => {
    const { steps, services: s } = services();
    const response = await createDeleteAccountHandler(s)(post('good-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(steps).toEqual([`whoop:${USER}`, `food:${USER}`, `user:${USER}`]);
  });

  it('only ever deletes the account the token belongs to', async () => {
    const { services: s } = services();
    const handler = createDeleteAccountHandler(s);
    for (const request of [post(), post('bad-token'), new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'good-token' } })]) {
      const response = await handler(request);
      expect(response.status).toBe(401);
    }
    expect(s.deleteUser).not.toHaveBeenCalled();
    expect(s.revokeWhoop).not.toHaveBeenCalled();
  });

  it('answers CORS preflight and refuses other methods', async () => {
    const { services: s } = services();
    const handler = createDeleteAccountHandler(s);
    expect((await handler(new Request('https://example.invalid', { method: 'OPTIONS' }))).status).toBe(200);
    expect((await handler(new Request('https://example.invalid', { method: 'GET', headers: { Authorization: 'Bearer good-token' } }))).status).toBe(405);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });

  it('still deletes the account when WHOOP or the food records fail', async () => {
    const { steps, services: s } = services({
      revokeWhoop: vi.fn(async () => { throw new Error('WHOOP down'); }),
      removeFoodRecords: vi.fn(async () => { throw new Error('storage down'); }),
    });
    s.deleteUser = vi.fn(async (id: string) => { steps.push(`user:${id}`); });
    const response = await createDeleteAccountHandler(s)(post('good-token'));
    expect(response.status).toBe(200);
    expect(steps).toEqual([`user:${USER}`]);
    expect(s.log).toHaveBeenCalledTimes(2);
  });

  it('never reports success when the account itself was not deleted', async () => {
    const { services: s } = services({ deleteUser: vi.fn(async () => { throw new Error('Database error deleting user'); }) });
    const response = await createDeleteAccountHandler(s)(post('good-token'));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty('ok');
  });

  it('says to try again when the sign-in check itself fails', async () => {
    const { services: s } = services({ authenticate: vi.fn(async () => { throw new Error('timeout'); }) });
    const response = await createDeleteAccountHandler(s)(post('good-token'));
    expect(response.status).toBe(503);
    expect(s.deleteUser).not.toHaveBeenCalled();
  });
});

describe('listing the food records to remove', () => {
  it('walks every day and kind folder under the account', async () => {
    const tree: Record<string, StorageEntry[]> = {
      [`food-v1/${USER}`]: [{ name: '2026-11-07', id: null }, { name: '2026-11-08', id: null }],
      [`food-v1/${USER}/2026-11-07`]: [{ name: 'claims', id: null }, { name: 'results', id: null }],
      [`food-v1/${USER}/2026-11-07/claims`]: [{ name: 'a.json', id: '1' }],
      [`food-v1/${USER}/2026-11-07/results`]: [{ name: 'a.json', id: '2' }],
      [`food-v1/${USER}/2026-11-08`]: [{ name: 'slots', id: null }],
      [`food-v1/${USER}/2026-11-08/slots`]: [{ name: '0.json', id: '3' }, { name: '1.json', id: '4' }],
    };
    const files = await listFilesUnder(async (prefix) => tree[prefix] ?? [], `food-v1/${USER}/`);
    expect(files.sort()).toEqual([
      `food-v1/${USER}/2026-11-07/claims/a.json`,
      `food-v1/${USER}/2026-11-07/results/a.json`,
      `food-v1/${USER}/2026-11-08/slots/0.json`,
      `food-v1/${USER}/2026-11-08/slots/1.json`,
    ]);
  });

  it('reads past the first page of a big folder', async () => {
    const all = Array.from({ length: 5 }, (_, index) => ({ name: `${index}.json`, id: String(index) }));
    const list = vi.fn(async (_prefix: string, offset: number) => all.slice(offset, offset + 2));
    const files = await listFilesUnder(list, 'food-v1/x', 2);
    expect(files).toHaveLength(5);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('finds nothing for an account that never analysed food', async () => {
    expect(await listFilesUnder(async () => [], `food-v1/${USER}`)).toEqual([]);
  });
});
