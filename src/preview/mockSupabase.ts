// DEV-ONLY in-memory Supabase stand-in. Returns the canned previewTables rows
// through a chainable query builder that honours the common filters (eq/in/
// gte/lte/order/limit/single/count) well enough for a visual preview.
import type { SupabaseClient } from '@supabase/supabase-js';
import { previewTables, PREVIEW_USER_ID } from './previewData';

const PREVIEW_USER = {
  id: PREVIEW_USER_ID,
  email: 'preview@hyper.app',
  user_metadata: { full_name: 'Sam Rivera' },
  app_metadata: {},
  aud: 'authenticated',
  created_at: new Date(0).toISOString(),
};

type Row = Record<string, unknown>;
type Predicate = (r: Row) => boolean;

class MockBuilder implements PromiseLike<{ data: unknown; error: null; count: number }> {
  private rows: Row[];
  private filters: Predicate[] = [];
  private orderSpec: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeSpec: [number, number] | null = null;
  private wantSingle = false;
  private headOnly = false;
  private mutate: Row[] | null = null;
  private updateVals: Row | null = null;
  private del = false;

  constructor(table: string) {
    this.rows = (previewTables[table] ?? []).map((r) => ({ ...r }));
  }

  select(_cols?: string, opts?: { head?: boolean; count?: string }) {
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: Row | Row[]) { this.mutate = Array.isArray(values) ? values : [values]; return this; }
  upsert(values: Row | Row[]) { this.mutate = Array.isArray(values) ? values : [values]; return this; }
  update(values: Row) { this.updateVals = values; return this; }
  delete() { this.del = true; return this; }

  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, arr: unknown[]) { this.filters.push((r) => arr.includes(r[col])); return this; }
  is(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  gte(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) >= (val as number | string)); return this; }
  lte(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) <= (val as number | string)); return this; }
  gt(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) > (val as number | string)); return this; }
  lt(col: string, val: unknown) { this.filters.push((r) => (r[col] as number | string) < (val as number | string)); return this; }
  ilike(col: string, pattern: string) { const s = String(pattern).replace(/%/g, '').toLowerCase(); this.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(s)); return this; }
  like(col: string, pattern: string) { return this.ilike(col, pattern); }
  contains() { return this; }
  not() { return this; }
  filter() { return this; }
  match(obj: Row) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderSpec = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(a: number, b: number) { this.rangeSpec = [a, b]; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantSingle = true; return this; }

  private resolve() {
    if (this.mutate) {
      const data = this.mutate.map((r, i) => ({ id: `mock-${Date.now()}-${i}`, ...r }));
      return { data: this.wantSingle ? data[0] ?? null : data, error: null, count: data.length };
    }
    if (this.updateVals) {
      const data = this.rows.filter((r) => this.filters.every((f) => f(r))).map((r) => ({ ...r, ...this.updateVals }));
      return { data: this.wantSingle ? data[0] ?? null : data, error: null, count: data.length };
    }
    if (this.del) {
      return { data: null, error: null, count: this.rows.filter((r) => this.filters.every((f) => f(r))).length };
    }
    let data = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderSpec) {
      const { col, asc } = this.orderSpec;
      data = [...data].sort((a, b) => {
        const av = a[col] as number | string;
        const bv = b[col] as number | string;
        return (av > bv ? 1 : av < bv ? -1 : 0) * (asc ? 1 : -1);
      });
    }
    const count = data.length;
    if (this.rangeSpec) data = data.slice(this.rangeSpec[0], this.rangeSpec[1] + 1);
    if (this.limitN != null) data = data.slice(0, this.limitN);
    if (this.headOnly) return { data: null, error: null, count };
    if (this.wantSingle) return { data: data[0] ?? null, error: null, count };
    return { data, error: null, count };
  }

  then<TResult1 = { data: unknown; error: null; count: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

export function createMockClient(): SupabaseClient {
  const auth = {
    getUser: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    getSession: async () => ({ data: { session: { user: PREVIEW_USER, access_token: 'preview' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    signUp: async () => ({ data: { user: PREVIEW_USER }, error: null }),
    signInWithOAuth: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    resend: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: PREVIEW_USER }, error: null }),
  };

  const client = {
    auth,
    from: (table: string) => new MockBuilder(table),
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel: () => {},
  };

  return client as unknown as SupabaseClient;
}
