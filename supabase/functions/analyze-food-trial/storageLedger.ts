import type { TrialLedger } from './gateway.ts';

/** Insert-only objects are both a durable request lock and a hard quota reservation.
 * Never use upsert, remove, refund or reclaim a slot: a lost response may already be billed.
 * https://supabase.com/docs/guides/storage/uploads/standard-uploads
 */
export function createStorageLedger(options: {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  fetch?: typeof fetch;
}): TrialLedger {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(options.bucket)) throw new Error('Invalid ledger bucket');
  const send = options.fetch ?? fetch;
  const root = `${options.url.replace(/\/$/, '')}/storage/v1`;
  const objectUrl = (path: string) => `${root}/object/${options.bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: `Bearer ${options.serviceRoleKey}`, apikey: options.serviceRoleKey };
  const request = async (url: string, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await send(url, { ...init, headers: { ...headers, ...init.headers }, signal: controller.signal });
      // Ledger objects contain only compact analysis output, never submitted images.
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error('Oversized ledger response');
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { throw new Error('Invalid ledger response'); }
      return { response, data };
    } finally { clearTimeout(timer); }
  };
  return {
    async assertPrivate() {
      const { response, data } = await request(`${root}/bucket/${options.bucket}`);
      if (!response.ok || data.public !== false || data.id !== options.bucket) throw new Error('Private ledger bucket is unavailable');
    },
    async insert(path, value) {
      const { response, data } = await request(objectUrl(path), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'false', 'Cache-Control': 'no-store' },
        body: JSON.stringify(value),
      });
      if (response.ok) return true;
      // A 400/409 alone is NOT proof of collision (permissions, missing bucket, etc.).
      const code = data.code ?? data.error;
      if ([400, 409].includes(response.status)
        && (code === 'ResourceAlreadyExists' || code === 'KeyAlreadyExists'
          || (code === 'Duplicate' && data.message === 'The resource already exists'))) return false;
      throw new Error('Ledger claim failed');
    },
    async read(path) {
      const { response, data } = await request(objectUrl(path));
      if (response.ok) return data;
      const code = data.code ?? data.error;
      if ([400, 404].includes(response.status)
        && (code === 'NoSuchKey' || (code === 'not_found' && data.message === 'Object not found')
          || (code === 'Not Found' && data.message === 'Object not found'))) return null;
      throw new Error('Ledger read failed');
    },
  };
}
