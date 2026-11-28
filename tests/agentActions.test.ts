import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
  },
}));

import {
  agentActionTimeLabel,
  formatAgentActionDetail,
  formatAgentActionTitle,
  isMissingAgentActionsTableError,
  listAgentActions,
  normalizeAgentAction,
  undoAgentAction,
  type AgentAction,
} from '@/lib/agentActions';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function chain(result: unknown) {
  const api: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update', 'delete', 'insert', 'maybeSingle']) {
    api[method] = vi.fn(() => api);
  }
  api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return api;
}

describe('agentActions pure helpers', () => {
  it('normalizes valid rows and drops malformed ones', () => {
    const normalized = normalizeAgentAction({
      id: 'a1',
      user_id: USER_ID,
      created_at: '2026-11-23T18:15:00Z',
      client_id: 'client-claude',
      agent_name: null,
      tool_name: 'log_food',
      summary: 'Logged Scrambled Eggs',
      undo_payload: {
        kind: 'log_food',
        date: '2026-11-23',
        meal: 'breakfast',
        log_ids: ['log-1'],
        total_calories: 420,
        item_count: 1,
        first_food_name: 'Scrambled Eggs',
      },
      undone_at: null,
    });
    expect(normalized).toMatchObject({
      id: 'a1',
      client_id: 'client-claude',
      tool_name: 'log_food',
      summary: 'Logged Scrambled Eggs',
      undone_at: null,
    });

    expect(normalizeAgentAction(null)).toBeNull();
    expect(normalizeAgentAction({ id: 'a2', user_id: USER_ID, tool_name: 'unknown', summary: 'x', undo_payload: {} })).toBeNull();
    expect(normalizeAgentAction({
      id: 'a3',
      user_id: USER_ID,
      created_at: '2026-11-23T18:00:00Z',
      tool_name: 'log_food',
      summary: 'Logged',
      undo_payload: { kind: 'log_food', log_ids: [] },
    })).toBeNull();
  });

  it('detects missing table errors from PostgREST and Postgres', () => {
    expect(isMissingAgentActionsTableError({ code: 'PGRST205', message: 'Could not find table' })).toBe(true);
    expect(isMissingAgentActionsTableError({ code: '42P01', message: 'relation does not exist' })).toBe(true);
    expect(isMissingAgentActionsTableError({ message: "Could not find the table 'public.agent_actions' in the schema cache" })).toBe(true);
    expect(isMissingAgentActionsTableError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingAgentActionsTableError(new Error('network timeout'))).toBe(false);
  });

  it('formats titles in the preferred weight unit and details with actor, context and timestamp', () => {
    const today = new Date(2026, 10, 23, 15, 12);
    const earlier = new Date(2026, 10, 21, 8, 5);
    const lastYear = new Date(2025, 11, 12, 8, 0);

    expect(agentActionTimeLabel(today.toISOString(), '2026-11-23')).toBe('Today, 3:12 PM');
    expect(agentActionTimeLabel(earlier.toISOString(), '2026-11-23')).toBe('Nov 21, 8:05 AM');
    expect(agentActionTimeLabel(lastYear.toISOString(), '2026-11-23')).toBe('Dec 12, 2025, 8:00 AM');

    const names = new Map([['client-claude', 'Claude']]);

    const weightAction: AgentAction = {
      id: 'a-weight',
      user_id: USER_ID,
      created_at: today.toISOString(),
      client_id: 'client-claude',
      agent_name: null,
      tool_name: 'log_body_weight',
      summary: 'Logged body weight',
      undo_payload: { kind: 'log_body_weight', weight_id: 'w1', kilograms: 80, measured_at: today.toISOString() },
      undone_at: null,
    };
    expect(formatAgentActionTitle(weightAction, 'lb')).toBe('Logged 176.4 lb');
    expect(formatAgentActionTitle(weightAction, 'kg')).toBe('Logged 80.0 kg');
    expect(formatAgentActionDetail(weightAction, { todayKey: '2026-11-23', agentNamesByClientId: names })).toBe(
      'Claude · Today, 3:12 PM',
    );

    const foodAction: AgentAction = {
      id: 'a-food',
      user_id: USER_ID,
      created_at: today.toISOString(),
      client_id: 'client-claude',
      agent_name: null,
      tool_name: 'log_food',
      summary: 'Logged Whey Shake',
      undo_payload: {
        kind: 'log_food',
        date: '2026-11-23',
        meal: 'snack',
        log_ids: ['nl-1'],
        total_calories: 180,
        item_count: 1,
        first_food_name: 'Whey Shake',
      },
      undone_at: null,
    };
    expect(formatAgentActionTitle(foodAction, 'lb')).toBe('Logged Whey Shake');
    expect(formatAgentActionDetail(foodAction, { todayKey: '2026-11-23', agentNamesByClientId: names })).toBe(
      'Claude · 180 kcal · Snack · Today, 3:12 PM',
    );
    expect(
      formatAgentActionDetail({ ...foodAction, undone_at: today.toISOString() }, { todayKey: '2026-11-23', agentNamesByClientId: names }),
    ).toBe('Undone · Claude · 180 kcal · Snack · Today, 3:12 PM');

    const updateAction: AgentAction = {
      id: 'a-upd',
      user_id: USER_ID,
      created_at: earlier.toISOString(),
      client_id: null,
      agent_name: 'ChatGPT',
      tool_name: 'update_food_log',
      summary: 'Updated Banana',
      undo_payload: {
        kind: 'update_food_log',
        food_name: 'Banana',
        before: { id: 'nl-2', date: '2026-11-21', logged_at: null, servings: 1, meal_type: 'snack', group_id: null, sort_order: 0 },
        after: { date: '2026-11-21', logged_at: null, servings: 2, meal_type: 'snack' },
      },
      undone_at: null,
    };
    expect(formatAgentActionDetail(updateAction, { todayKey: '2026-11-23' })).toBe(
      'ChatGPT · 1 → 2 servings · Nov 21, 8:05 AM',
    );
  });
});

describe('listAgentActions and undoAgentAction', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('lists recent actions and quietly reports tableMissing on pre-migration backends', async () => {
    fromMock.mockReturnValueOnce(chain({
      data: [{
        id: 'a1',
        user_id: USER_ID,
        created_at: '2026-11-23T12:00:00Z',
        client_id: 'c1',
        agent_name: null,
        tool_name: 'log_body_weight',
        summary: 'Logged body weight',
        undo_payload: { kind: 'log_body_weight', weight_id: 'w1', kilograms: 80, measured_at: '2026-11-23T12:00:00Z' },
        undone_at: null,
      }],
      error: null,
    }));
    const listed = await listAgentActions(USER_ID);
    expect(listed.tableMissing).toBe(false);
    expect(listed.actions).toHaveLength(1);

    fromMock.mockReturnValueOnce(chain({ data: null, error: { code: 'PGRST205', message: 'not in schema cache' } }));
    await expect(listAgentActions(USER_ID)).resolves.toEqual({ actions: [], tableMissing: true });

    fromMock.mockReturnValueOnce(chain({ data: null, error: new Error('offline') }));
    await expect(listAgentActions(USER_ID)).rejects.toThrow('offline');
  });

  it('undoes log_food by deleting inserted nutrition_logs and marking undone_at', async () => {
    const deleteLogs = chain({ data: null, error: null });
    const markUndone = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => (table === 'nutrition_logs' ? deleteLogs : markUndone));

    const action: AgentAction = {
      id: 'a-log',
      user_id: USER_ID,
      created_at: '2026-11-23T12:00:00Z',
      client_id: 'c1',
      agent_name: null,
      tool_name: 'log_food',
      summary: 'Logged Oats',
      undo_payload: {
        kind: 'log_food',
        date: '2026-11-23',
        meal: 'breakfast',
        log_ids: ['nl-1', 'nl-2'],
        total_calories: 300,
        item_count: 2,
        first_food_name: 'Oats',
      },
      undone_at: null,
    };

    const now = new Date('2026-11-23T13:00:00Z');
    const result = await undoAgentAction(USER_ID, action, now);
    expect(result).toEqual({ undoneAt: '2026-11-23T13:00:00.000Z', affected: 'nutrition' });
    expect(deleteLogs.delete).toHaveBeenCalled();
    expect(deleteLogs.in).toHaveBeenCalledWith('id', ['nl-1', 'nl-2']);
    expect(markUndone.update).toHaveBeenCalledWith({ undone_at: '2026-11-23T13:00:00.000Z' });
  });

  it('undoes update_food_log, falling back to group_id null on FK error and reporting deleted entries', async () => {
    const action: AgentAction = {
      id: 'a-upd',
      user_id: USER_ID,
      created_at: '2026-11-23T12:00:00Z',
      client_id: null,
      agent_name: null,
      tool_name: 'update_food_log',
      summary: 'Updated Oats',
      undo_payload: {
        kind: 'update_food_log',
        food_name: 'Oats',
        before: {
          id: 'nl-1',
          date: '2026-11-23',
          logged_at: '2026-11-23T08:00:00Z',
          servings: 1,
          meal_type: 'breakfast',
          group_id: 'deleted-group',
          sort_order: 0,
        },
        after: { date: '2026-11-23', logged_at: '2026-11-23T08:00:00Z', servings: 2, meal_type: 'breakfast' },
      },
      undone_at: null,
    };

    const fkFail = chain({ data: null, error: { code: '23503', message: 'fk violation' } });
    const retryOk = chain({ data: { id: 'nl-1' }, error: null });
    const markOk = chain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(fkFail)
      .mockReturnValueOnce(retryOk)
      .mockReturnValueOnce(markOk);

    await expect(undoAgentAction(USER_ID, action, new Date('2026-11-23T13:00:00Z'))).resolves.toEqual({
      undoneAt: '2026-11-23T13:00:00.000Z',
      affected: 'nutrition',
    });
    expect(retryOk.update).toHaveBeenCalledWith(expect.objectContaining({ group_id: null, servings: 1 }));

    const missingRow = chain({ data: null, error: null });
    fromMock.mockReturnValueOnce(missingRow);
    await expect(undoAgentAction(USER_ID, action)).rejects.toThrow('This entry was already deleted.');
  });

  it('undoes delete_food_log by reinserting the snapshot (handling FK fallback and 23505 idempotency)', async () => {
    const action: AgentAction = {
      id: 'a-del',
      user_id: USER_ID,
      created_at: '2026-11-23T12:00:00Z',
      client_id: null,
      agent_name: null,
      tool_name: 'delete_food_log',
      summary: 'Removed Protein Bar',
      undo_payload: {
        kind: 'delete_food_log',
        food_name: 'Protein Bar',
        calories: 200,
        deleted_row: {
          id: 'nl-9',
          date: '2026-11-23',
          logged_at: '2026-11-23T11:00:00Z',
          food_id: 'f-1',
          servings: 1,
          meal_type: 'snack',
          group_id: 'old-group',
          sort_order: 2,
          source: 'manual',
        },
      },
      undone_at: null,
    };

    const fkFail = chain({ data: null, error: { code: '23503', message: 'fk' } });
    const duplicate = chain({ data: null, error: { code: '23505', message: 'already exists' } });
    const markOk = chain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(fkFail)
      .mockReturnValueOnce(duplicate)
      .mockReturnValueOnce(markOk);

    await expect(undoAgentAction(USER_ID, action, new Date('2026-11-23T13:00:00Z'))).resolves.toEqual({
      undoneAt: '2026-11-23T13:00:00.000Z',
      affected: 'nutrition',
    });
    expect(duplicate.insert).toHaveBeenCalledWith(expect.objectContaining({ id: 'nl-9', group_id: null }));
  });

  it('undoes log_body_weight by deleting the manual measurement and returns early if already undone', async () => {
    const delWeight = chain({ data: null, error: null });
    const markOk = chain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => (table === 'body_weight_measurements' ? delWeight : markOk));

    const action: AgentAction = {
      id: 'a-w',
      user_id: USER_ID,
      created_at: '2026-11-23T12:00:00Z',
      client_id: null,
      agent_name: null,
      tool_name: 'log_body_weight',
      summary: 'Logged body weight',
      undo_payload: { kind: 'log_body_weight', weight_id: 'w-9', kilograms: 81.5, measured_at: '2026-11-23T12:00:00Z' },
      undone_at: null,
    };

    const result = await undoAgentAction(USER_ID, action, new Date('2026-11-23T13:00:00Z'));
    expect(result).toEqual({ undoneAt: '2026-11-23T13:00:00.000Z', affected: 'weight' });
    expect(delWeight.eq).toHaveBeenCalledWith('source', 'manual');

    fromMock.mockClear();
    await expect(undoAgentAction(USER_ID, { ...action, undone_at: '2026-11-23T13:00:00.000Z' })).resolves.toEqual({
      undoneAt: '2026-11-23T13:00:00.000Z',
      affected: 'weight',
    });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
