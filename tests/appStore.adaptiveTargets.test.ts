import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MacroTarget } from '@/types';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import { useAppStore } from '@/stores/appStore';

type Chain = {
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function createChain(overrides: Partial<Chain> = {}): Chain {
  const chain = {
    update: vi.fn(),
    upsert: vi.fn(),
    insert: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  } as Chain;

  chain.update.mockImplementation(() => chain);
  chain.upsert.mockImplementation(() => chain);
  chain.insert.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.neq.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });

  Object.assign(chain, overrides);
  return chain;
}

const manualTarget: MacroTarget = {
  id: 'macro-1',
  user_id: 'user-1',
  calories: 2100,
  protein: 170,
  carbs: 200,
  fat: 70,
  source: 'manual',
  updated_at: '2026-09-01T10:00:00.000Z',
};

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

  useAppStore.setState({ macroTarget: null, nutritionProfile: null });
});

describe('fetchMacroTarget', () => {
  it('clears a leftover target when the read succeeds with no row', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    const chain = createChain();
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toBeNull();
  });

  it('keeps the shown target when the read fails', async () => {
    useAppStore.setState({ macroTarget: manualTarget });
    const chain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } }),
    });
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toBe(manualTarget);
  });

  it('stores the row when one exists', async () => {
    const chain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: manualTarget, error: null }),
    });
    supabaseMock.from.mockImplementation(() => chain);

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toEqual(manualTarget);
  });
});
