import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryStorage } from './memoryStorage';

type Result = { data: unknown; error: unknown };

// program_preferences only: a read answers with the next queued result, and
// every upsert is recorded and answers with its own queue.
const backend = vi.hoisted(() => {
  const reads: Array<() => Promise<Result>> = [];
  const saves: Array<() => Promise<Result>> = [];
  const sent: unknown[] = [];
  const ok = () => Promise.resolve({ data: null, error: null });
  const from = (table: string) => {
    if (table !== 'program_preferences') throw new Error(`Unexpected table: ${table}`);
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) query[method] = () => query;
    query.maybeSingle = () => (reads.shift() ?? ok)();
    query.upsert = (row: unknown) => {
      sent.push(row);
      return (saves.shift() ?? ok)();
    };
    return query;
  };
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }));
  return { reads, saves, sent, client: { from, auth: { getSession } } };
});

vi.mock('@/lib/supabase', () => ({ supabase: backend.client }));

import { resetAppData, useAppStore } from '@/stores/appStore';

const signedIn = (id: string) => backend.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id } } }, error: null });
const cloudMode = (mode: 'split' | 'flexible') => backend.reads.push(() => Promise.resolve({ data: { workout_mode: mode }, error: null }));
const saveFails = () => backend.saves.push(() => Promise.resolve({ data: null, error: { message: 'offline' } }));
function holdRead() {
  let release!: (result: Result) => void;
  backend.reads.push(() => new Promise((resolve) => { release = resolve; }));
  return (mode: 'split' | 'flexible') => release({ data: { workout_mode: mode }, error: null });
}
function holdSave() {
  let release!: (result: Result) => void;
  backend.saves.push(() => new Promise((resolve) => { release = resolve; }));
  return () => release({ data: null, error: null });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mode = () => useAppStore.getState().workoutMode;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  signedIn('user-1');
  backend.reads.length = 0;
  backend.saves.length = 0;
  backend.sent.length = 0;
  resetAppData();
  useAppStore.setState({ workoutMode: 'split' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a workout mode switch whose cloud save failed', () => {
  it('is kept over the cloud mode on the next read, sent again, and then follows the cloud', async () => {
    saveFails();
    await expect(useAppStore.getState().setWorkoutMode('flexible')).resolves.toEqual({ ok: true });
    expect(mode()).toBe('flexible');

    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();
    expect(mode()).toBe('flexible');
    expect(backend.sent).toEqual([
      { user_id: 'user-1', workout_mode: 'flexible' },
      { user_id: 'user-1', workout_mode: 'flexible' },
    ]);

    // Sent: a later change made on another device is followed again.
    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();
    expect(mode()).toBe('split');
    expect(backend.sent).toHaveLength(2);
  });

  it('stays pending while the cloud keeps refusing it', async () => {
    saveFails();
    await useAppStore.getState().setWorkoutMode('flexible');

    saveFails();
    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();

    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();
    expect(mode()).toBe('flexible');
    expect(backend.sent).toHaveLength(3);
  });

  it('wins over a read that started before it', async () => {
    const releaseRead = holdRead();
    const read = useAppStore.getState().fetchWorkoutMode();
    await flush();

    saveFails();
    await useAppStore.getState().setWorkoutMode('flexible');
    releaseRead('split');
    await read;

    expect(mode()).toBe('flexible');
  });

  it('belongs to its own account', async () => {
    saveFails();
    await useAppStore.getState().setWorkoutMode('flexible');

    resetAppData();
    signedIn('user-2');
    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();

    expect(mode()).toBe('split');
    expect(backend.sent).toHaveLength(1);
  });
});

describe('workout mode saves', () => {
  it('land in the order the switches were made', async () => {
    const releaseFirst = holdSave();
    const first = useAppStore.getState().setWorkoutMode('flexible');
    await flush();
    const second = useAppStore.getState().setWorkoutMode('split');
    await flush();
    expect(backend.sent).toHaveLength(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(backend.sent).toEqual([
      { user_id: 'user-1', workout_mode: 'flexible' },
      { user_id: 'user-1', workout_mode: 'split' },
    ]);
    expect(mode()).toBe('split');

    // Both landed: nothing is left to send.
    cloudMode('split');
    await useAppStore.getState().fetchWorkoutMode();
    await flush();
    expect(backend.sent).toHaveLength(2);
  });
});
