import { addDays } from 'date-fns';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitDay } from '@/types';

const backend = vi.hoisted(() => ({ updateUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: backend.updateUser } } }));

import { useAuthStore } from '@/stores/authStore';
import { isAdaptiveSplitSchedulingEnabled, saveAdaptiveSplitScheduling } from '@/lib/adaptiveSplitScheduling';
import { plannedDayForDate, type PlanSchedule, type ScheduleWorkout } from '@/lib/planSchedule';

const days: SplitDay[] = ['Upper A', 'Lower A', 'Upper B', 'Lower B'].map((day_name, index) => ({
  id: `day-${index}`, split_id: 'split', day_name, day_order: index, exercises: [],
}));
const fixed: PlanSchedule = {
  splitId: 'split', startDate: '2026-08-31', mode: 'fixed', weekdays: [1, 2, 4, 5], anchorDay: 1,
};
const flex: PlanSchedule = {
  ...fixed, mode: 'flex', weekdays: [], anchorDay: 0, flexAnchorIndex: 0,
  updatedAt: '2026-08-31T00:00:00Z',
};
function localDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function workout(date: string, index: number, overrides: Partial<ScheduleWorkout> = {}): ScheduleWorkout {
  return {
    id: `workout-${date}-${index}`, date, split_day_id: days[index]?.id ?? null, completed: true,
    created_at: `${date}T12:00:00Z`, completed_at: `${date}T13:00:00Z`, ...overrides,
  };
}
function projection(start: string, count: number, history: ScheduleWorkout[], enabled?: boolean, schedule = fixed, splitDays = days) {
  return Array.from({ length: count }, (_, offset) => plannedDayForDate(
    addDays(localDate(start), offset), splitDays, schedule, 0, history, enabled,
  )?.day_name ?? 'Rest');
}
function user(metadata: Record<string, unknown> = {}, id = 'user-a'): User {
  return { id, aud: 'authenticated', app_metadata: {}, user_metadata: metadata, created_at: '2026-08-01T00:00:00Z' };
}
function session(account: User): Session {
  return {
    user: account, access_token: 'test-only-access-token', refresh_token: 'test-only-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

beforeEach(() => {
  backend.updateUser.mockReset();
  const account = user({ display_name: 'Original', unrelated_preference: 'preserved' });
  useAuthStore.setState({ user: account, session: session(account) });
});

describe('adaptive scheduling opt-out preference', () => {
  it.each([undefined, null, true, 'false', 0, {}, []])('defaults on for missing or non-false metadata %j', (value) => {
    expect(isAdaptiveSplitSchedulingEnabled(user({ adaptive_split_scheduling: value }))).toBe(true);
  });

  it('defaults on before sign-in and for new or existing accounts with no setting', () => {
    expect(isAdaptiveSplitSchedulingEnabled(null)).toBe(true);
    expect(isAdaptiveSplitSchedulingEnabled(user())).toBe(true);
    expect(isAdaptiveSplitSchedulingEnabled(user({ photo_worker_settings: { provider: 'openai' } }))).toBe(true);
    expect(isAdaptiveSplitSchedulingEnabled(user({ adaptive_split_scheduling: false }))).toBe(false);
  });

  it('applies only confirmed saves to both reactive user and session while retaining unrelated metadata', async () => {
    let resolve!: (result: { data: { user: User }; error: null }) => void;
    backend.updateUser.mockReturnValue(new Promise((done) => { resolve = done; }));
    const saving = saveAdaptiveSplitScheduling(false);
    expect(isAdaptiveSplitSchedulingEnabled(useAuthStore.getState().user)).toBe(true);
    const newerUser = user({ display_name: 'Changed meanwhile', unrelated_preference: 'preserved' });
    useAuthStore.setState({ user: newerUser, session: session(newerUser) });
    resolve({ data: { user: user({ adaptive_split_scheduling: false, display_name: 'Stale response' }) }, error: null });
    await saving;
    expect(backend.updateUser).toHaveBeenCalledWith({ data: { adaptive_split_scheduling: false } });
    expect(useAuthStore.getState().user?.user_metadata).toEqual({
      display_name: 'Changed meanwhile', unrelated_preference: 'preserved', adaptive_split_scheduling: false,
    });
    expect(useAuthStore.getState().session?.user).toEqual(useAuthStore.getState().user);

    backend.updateUser.mockResolvedValue({ data: { user: user({ adaptive_split_scheduling: true }) }, error: null });
    await saveAdaptiveSplitScheduling(true);
    expect(isAdaptiveSplitSchedulingEnabled(useAuthStore.getState().user)).toBe(true);
    expect(useAuthStore.getState().user?.user_metadata.unrelated_preference).toBe('preserved');
  });

  it.each([
    ['server error', { data: { user: null }, error: new Error('Could not save') }],
    ['empty acknowledgement', { data: { user: null }, error: null }],
    ['missing acknowledged preference', { data: { user: user() }, error: null }],
    ['wrong acknowledged value', { data: { user: user({ adaptive_split_scheduling: true }) }, error: null }],
    ['wrong acknowledged account', { data: { user: user({ adaptive_split_scheduling: false }, 'user-b') }, error: null }],
  ])('retains the prior preference on %s', async (_label, response) => {
    const original = useAuthStore.getState();
    backend.updateUser.mockResolvedValue(response);
    await expect(saveAdaptiveSplitScheduling(false)).rejects.toBeInstanceOf(Error);
    expect(useAuthStore.getState().user).toBe(original.user);
    expect(useAuthStore.getState().session).toBe(original.session);
  });

  it('retains a disabled preference after a rejected re-enable request', async () => {
    const account = user({ adaptive_split_scheduling: false });
    useAuthStore.setState({ user: account, session: session(account) });
    backend.updateUser.mockRejectedValue(new Error('Network unavailable'));
    await expect(saveAdaptiveSplitScheduling(true)).rejects.toThrow('Network unavailable');
    expect(isAdaptiveSplitSchedulingEnabled(useAuthStore.getState().user)).toBe(false);
  });

  it.each(['other account', 'signed out'])('does not clobber %s after a delayed successful save', async (nextState) => {
    let resolve!: (result: { data: { user: User }; error: null }) => void;
    backend.updateUser.mockReturnValue(new Promise((done) => { resolve = done; }));
    const saving = saveAdaptiveSplitScheduling(false);
    const nextUser = nextState === 'other account' ? user({ adaptive_split_scheduling: true }, 'user-b') : null;
    const nextSession = nextUser ? session(nextUser) : null;
    useAuthStore.setState({ user: nextUser, session: nextSession });
    resolve({ data: { user: user({ adaptive_split_scheduling: false }) }, error: null });
    await saving;
    expect(useAuthStore.getState().user).toBe(nextUser);
    expect(useAuthStore.getState().session).toBe(nextSession);
  });

  it('requires an account before writing the preference', async () => {
    useAuthStore.setState({ user: null, session: null });
    await expect(saveAdaptiveSplitScheduling(false)).rejects.toThrow('Sign in');
    expect(backend.updateUser).not.toHaveBeenCalled();
  });
});

describe('schedule projection while toggling adaptation', () => {
  it('restores the saved calendar when disabled and the original manual anchor when re-enabled', () => {
    const history = [workout('2026-09-01', 2)];
    const original = JSON.stringify({ history, fixed, days });
    const adapted = ['Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A', 'Rest'];
    expect(projection('2026-09-01', 7, history)).toEqual(adapted);
    expect(projection('2026-09-01', 7, history, false)).toEqual([
      'Lower A', 'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A',
    ]);
    expect(projection('2026-09-01', 7, history, true)).toEqual(adapted);
    expect(JSON.stringify({ history, fixed, days })).toBe(original);
  });

  it('retains delayed-workout anchoring when enabled without adding a skip action', () => {
    const history = [workout('2026-09-02', 1)];
    expect(projection('2026-09-02', 7, history, true)).toEqual([
      'Lower A', 'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A',
    ]);
    expect(projection('2026-09-02', 7, history, false)).toEqual([
      'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A',
    ]);
    expect(projection('2026-09-02', 7, history, true)).toEqual(projection('2026-09-02', 7, history));
  });

  it('uses a non-weeklong saved rotation and rest rhythm unchanged while disabled', () => {
    const longDays = Array.from({ length: 5 }, (_, index) => ({ ...days[index % 4], id: `long-${index}`, day_name: `Day ${index + 1}` }));
    const schedule = { ...fixed, weekdays: [1, 4] };
    const history = [workout('2026-09-02', 2, { split_day_id: 'long-4' })];
    expect(projection('2026-08-31', 35, history, false, schedule, longDays)).toEqual(
      projection('2026-08-31', 35, [], true, schedule, longDays),
    );
    expect(projection('2026-08-31', 35, history, false, schedule, longDays).filter((value) => value !== 'Rest')).toEqual([
      'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5',
    ]);
  });

  it('keeps flexible completion-driven progression when disabled without jumping to manually performed day identity', () => {
    const history = [workout('2026-09-01', 2), workout('2026-09-03', 3)];
    expect(projection('2026-09-01', 5, history, false, flex)).toEqual(['Upper A', 'Lower A', 'Lower A', 'Upper B', 'Upper B']);
    expect(projection('2026-09-01', 5, history, true, flex)).toEqual(['Upper B', 'Lower B', 'Lower B', 'Upper A', 'Upper A']);
  });

  it('ignores unrelated, incomplete, future and pre-edit sessions when advancing explicit flexible schedules', () => {
    const schedule = { ...flex, flexAnchorIndex: 1, updatedAt: '2026-09-01T09:00:00Z' };
    const history = [
      workout('2026-08-31', 2),
      workout('2026-09-01', 3, { created_at: '2026-09-01T08:00:00Z' }),
      workout('2026-09-01', 3, { split_day_id: 'other-split-day' }),
      workout('2026-09-01', 3, { split_day_id: null }),
      workout('2026-09-01', 3, { completed: false }),
      workout('2026-09-01', 2),
      workout('2026-09-05', 3),
    ];
    expect(projection('2026-09-01', 4, history, false, schedule)).toEqual(['Lower A', 'Upper B', 'Upper B', 'Upper B']);
  });

  it('counts legacy flexible completions once when there is no saved edit timestamp', () => {
    const legacy: PlanSchedule = { ...fixed, mode: 'flex', weekdays: [], anchorDay: 0 };
    expect(projection('2026-09-01', 3, [workout('2026-09-01', 2)], false, legacy)).toEqual(['Upper A', 'Lower A', 'Lower A']);
  });

  it('preserves a compensated legacy flexible anchor while counting subsequent completions once', () => {
    const legacy: PlanSchedule = { ...fixed, mode: 'flex', weekdays: [], anchorDay: 3, updatedAt: '2026-09-02T09:00:00Z' };
    const history = [workout('2026-09-01', 2), workout('2026-09-03', 2)];
    expect(projection('2026-09-02', 4, history, false, legacy)).toEqual(['Upper A', 'Upper A', 'Lower A', 'Lower A']);
  });
});

it('persists disabled and re-enabled settings across actual SDK session restoration', async () => {
  const storageKey = 'adaptive-scheduling-toggle-test';
  const originalUser = user({ display_name: 'Persisted account', other_setting: 'unchanged' });
  const persisted = new Map([[storageKey, JSON.stringify(session(originalUser))]]);
  const storage = {
    getItem: async (key: string) => persisted.get(key) ?? null,
    setItem: async (key: string, value: string) => { persisted.set(key, value); },
    removeItem: async (key: string) => { persisted.delete(key); },
  };
  const authFetch = vi.fn<typeof fetch>(async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { data: Record<string, unknown> };
    return Response.json({ ...originalUser, user_metadata: { ...originalUser.user_metadata, ...payload.data } });
  });
  const client = () => createClient('https://adaptive-scheduling.test', 'test-only-public-key', {
    auth: { storageKey, storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: authFetch },
  });
  const writer = client();
  const restoredBefore = (await writer.auth.getSession()).data.session!;
  useAuthStore.setState({ user: restoredBefore.user, session: restoredBefore });
  backend.updateUser.mockImplementation((attributes) => writer.auth.updateUser(attributes));

  const history = [workout('2026-09-01', 2)];
  for (const enabled of [false, true]) {
    await saveAdaptiveSplitScheduling(enabled);
    const snapshot = JSON.parse(persisted.get(storageKey)!) as Session;
    expect(snapshot.user.user_metadata).toMatchObject({
      adaptive_split_scheduling: enabled, display_name: 'Persisted account', other_setting: 'unchanged',
    });
    // A fresh SDK client reconstructs its state using only the persisted session.
    const reader = client();
    const restored = (await reader.auth.getSession()).data.session!;
    useAuthStore.setState({ user: restored.user, session: restored });
    expect(isAdaptiveSplitSchedulingEnabled(restored.user)).toBe(enabled);
    expect(projection('2026-09-02', 3, history, isAdaptiveSplitSchedulingEnabled(restored.user))).toEqual(
      enabled ? ['Lower B', 'Rest', 'Rest'] : ['Rest', 'Upper B', 'Lower B'],
    );
    await reader.auth.stopAutoRefresh();
  }
  expect(authFetch).toHaveBeenCalledTimes(2);
  await writer.auth.stopAutoRefresh();
});
