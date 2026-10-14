import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import { useAuthStore } from '@/stores/authStore';

type AuthListener = (event: string, session: { user: { id: string } } | null) => Promise<void> | void;

interface QueryChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn<(column: string, value: string) => QueryChain>>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

function chain(result: { data: unknown; error: unknown }): QueryChain {
  const query: QueryChain = {
    select: vi.fn(() => query),
    eq: vi.fn<(column: string, value: string) => QueryChain>(() => query),
    single: vi.fn(async () => ({ data: null, error: null })),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

function mockApprovals(approvedIds: Set<string>) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === 'profiles') return chain({ data: null, error: null });
    if (table === 'approved_users') {
      const query = chain({ data: null, error: null });
      query.eq.mockImplementation((_column: string, value: string) => {
        query.maybeSingle.mockResolvedValue({ data: approvedIds.has(value) ? { user_id: value } : null, error: null });
        return query;
      });
      return query;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.onAuthStateChange.mockReset();
  supabaseMock.auth.signOut.mockReset();
  useAuthStore.setState({
    user: null, session: null, profile: null, loading: true, initialized: false, reconnecting: false,
    betaAccess: 'unknown', betaAccessUserId: null,
  });
});

describe('private beta approval in the auth store', () => {
  it('marks a restored account that is not on the list as not approved, per account', async () => {
    let listener: AuthListener | undefined;
    supabaseMock.auth.onAuthStateChange.mockImplementation((callback: AuthListener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'stranger' } } }, error: null });
    mockApprovals(new Set(['sinan']));

    await useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(useAuthStore.getState().betaAccess).toBe('not-approved'));
    expect(useAuthStore.getState().betaAccessUserId).toBe('stranger');

    await listener?.('SIGNED_IN', { user: { id: 'sinan' } });
    await vi.waitFor(() => expect(useAuthStore.getState()).toMatchObject({ betaAccess: 'approved', betaAccessUserId: 'sinan' }));

    await listener?.('SIGNED_OUT', null);
    expect(useAuthStore.getState()).toMatchObject({ betaAccess: 'unknown', betaAccessUserId: null });
  });

  it('clears the answer on sign out', async () => {
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
    useAuthStore.setState({ user: { id: 'stranger' } as never, betaAccess: 'not-approved', betaAccessUserId: 'stranger' });
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState()).toMatchObject({ user: null, betaAccess: 'unknown', betaAccessUserId: null });
  });
});
