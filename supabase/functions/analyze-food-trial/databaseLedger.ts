import type { TrialLedger } from './gateway.ts';

const PATH = /^food-v1\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/\d{4}-\d{2}-\d{2}\/(?:claims|results|slots)\/[a-z0-9]+\.json$/;

/** Insert-only, service-only rows cascade from auth.users. Storage is read-only
 * during cutover so old claims/quota/results still count, but cannot resurrect.
 */
export function createDatabaseLedger(options: {
  url: string;
  serviceRoleKey: string;
  legacy: Pick<TrialLedger, 'assertPrivate' | 'read'>;
  fetch?: typeof fetch;
}): TrialLedger {
  const send = options.fetch ?? fetch;
  const root = `${options.url.replace(/\/$/, '')}/rest/v1/food_analysis_ledger`;
  const headers = { Authorization: `Bearer ${options.serviceRoleKey}`, apikey: options.serviceRoleKey };
  const owner = (path: string) => {
    const match = PATH.exec(path);
    if (!match) throw new Error('Invalid ledger path');
    return match[1];
  };
  const request = async (query: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await send(`${root}${query}`, { ...init, headers: { ...headers, ...init.headers }, signal: controller.signal });
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error('Oversized ledger response');
      const data: unknown = text ? JSON.parse(text) : null;
      return { response, data };
    } finally { clearTimeout(timer); }
  };
  return {
    async assertPrivate() {
      await options.legacy.assertPrivate();
      // RLS and explicit grants are installed by the migration. Fail closed if
      // that migration is missing, rather than spend against untracked quota.
      const { response, data } = await request('?select=path&limit=0');
      if (!response.ok || !Array.isArray(data)) throw new Error('Database ledger is unavailable');
    },
    async insert(path, value) {
      const userId = owner(path);
      // A legacy reservation may already have incurred a charge. Never reclaim it.
      if (await options.legacy.read(path) !== null) return false;
      const { response, data } = await request('', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ path, user_id: userId, value }),
      });
      if (response.ok) return true;
      // Only a unique-key violation proves this request/slot was already claimed.
      if (response.status === 409 && data && typeof data === 'object' && 'code' in data && data.code === '23505') return false;
      throw new Error('Ledger claim failed');
    },
    async read(path) {
      const userId = owner(path);
      const query = new URLSearchParams({ path: `eq.${path}`, user_id: `eq.${userId}`, select: 'value', limit: '1' });
      const { response, data } = await request(`?${query}`);
      if (!response.ok || !Array.isArray(data)) throw new Error('Ledger read failed');
      if (!data.length) return options.legacy.read(path);
      const value: unknown = data[0]?.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid ledger record');
      return value;
    },
  };
}
