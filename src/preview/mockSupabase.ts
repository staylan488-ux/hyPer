// DEV-ONLY in-memory Supabase stand-in. Serves the canned previewTables rows
// through a chainable query builder that honours the common filters (eq/in/
// gte/lte/order/limit/single/count). Mutations PERSIST into previewTables for
// the lifetime of the tab so preview flows (add -> navigate -> re-fetch) behave
// like the real database; a full page reload re-seeds from scratch.
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

let mockIdCounter = 0;

function stampRow(row: Row): Row {
  const now = new Date().toISOString();
  return { id: `mock-${Date.now()}-${++mockIdCounter}`, created_at: now, updated_at: now, ...row };
}

class MockBuilder implements PromiseLike<{ data: unknown; error: null; count: number }> {
  // live reference into previewTables so mutations persist across builders
  private live: Row[];
  private filters: Predicate[] = [];
  private orderSpec: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeSpec: [number, number] | null = null;
  private wantSingle = false;
  private headOnly = false;
  private insertVals: Row[] | null = null;
  private upsertVals: Row[] | null = null;
  private onConflictCols: string[] = ['id'];
  private updateVals: Row | null = null;
  private del = false;

  constructor(table: string) {
    if (!previewTables[table]) previewTables[table] = [];
    this.live = previewTables[table];
  }

  select(_cols?: string, opts?: { head?: boolean; count?: string }) {
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(values: Row | Row[]) { this.insertVals = Array.isArray(values) ? values : [values]; return this; }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.upsertVals = Array.isArray(values) ? values : [values];
    if (opts?.onConflict) this.onConflictCols = opts.onConflict.split(',').map((c) => c.trim());
    return this;
  }
  update(values: Row) { this.updateVals = values; return this; }
  delete() { this.del = true; return this; }

  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  in(col: string, arr: unknown[]) { this.filters.push((r) => arr.includes(r[col])); return this; }
  // normalise undefined to null so `.is('col', null)` matches seeded rows that omit the key
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
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

  private matching(): Row[] {
    return this.live.filter((r) => this.filters.every((f) => f(r)));
  }

  private resolve() {
    if (this.insertVals) {
      const data = this.insertVals.map((r) => stampRow(r));
      this.live.push(...data);
      const copies = data.map((r) => ({ ...r }));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.upsertVals) {
      const results: Row[] = [];
      for (const value of this.upsertVals) {
        const existing = this.live.find((r) => this.onConflictCols.every((c) => r[c] === value[c]));
        if (existing) {
          Object.assign(existing, value, { updated_at: new Date().toISOString() });
          results.push(existing);
        } else {
          const stamped = stampRow(value);
          this.live.push(stamped);
          results.push(stamped);
        }
      }
      const copies = results.map((r) => ({ ...r }));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.updateVals) {
      const targets = this.matching();
      targets.forEach((r) => Object.assign(r, this.updateVals));
      const copies = targets.map((r) => ({ ...r }));
      return { data: this.wantSingle ? copies[0] ?? null : copies, error: null, count: copies.length };
    }
    if (this.del) {
      const targets = new Set(this.matching());
      const count = targets.size;
      for (let i = this.live.length - 1; i >= 0; i--) {
        if (targets.has(this.live[i])) this.live.splice(i, 1);
      }
      return { data: null, error: null, count };
    }
    let data = this.matching().map((r) => ({ ...r }));
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
