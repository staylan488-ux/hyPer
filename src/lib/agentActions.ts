// Recent AI agent actions (public.agent_actions): read, format, and 1-tap Undo.
//
// Like macro_target_changes, the table is optional on pre-migration backends:
// when agent_actions does not exist yet (PGRST205 / 42P01), reads return an
// empty list quietly instead of surfacing an error.
import { format } from 'date-fns';

import { supabase } from '@/lib/supabase';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';

export type AgentActionToolName =
  | 'log_food'
  | 'update_food_log'
  | 'delete_food_log'
  | 'log_body_weight';

export type AgentMealName = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type AgentUndoPayload =
  | {
      kind: 'log_food';
      date: string;
      meal: AgentMealName;
      log_ids: string[];
      total_calories: number;
      item_count: number;
      first_food_name: string;
    }
  | {
      kind: 'update_food_log';
      food_name: string;
      before: {
        id: string;
        date: string;
        logged_at: string | null;
        servings: number;
        meal_type: AgentMealName | null;
        group_id: string | null;
        sort_order: number;
      };
      after: {
        date: string;
        logged_at: string | null;
        servings: number;
        meal_type: AgentMealName | null;
      };
    }
  | {
      kind: 'delete_food_log';
      food_name: string;
      calories: number;
      deleted_row: {
        id: string;
        date: string;
        logged_at: string | null;
        food_id: string;
        servings: number;
        meal_type: AgentMealName | null;
        group_id: string | null;
        sort_order: number;
        source: string;
      };
    }
  | {
      kind: 'log_body_weight';
      weight_id: string;
      kilograms: number;
      measured_at: string;
    };

export interface AgentAction {
  id: string;
  user_id: string;
  created_at: string;
  client_id: string | null;
  agent_name: string | null;
  tool_name: AgentActionToolName;
  summary: string;
  undo_payload: AgentUndoPayload;
  undone_at: string | null;
}

export const MAX_RECENT_AGENT_ACTIONS = 20;

const TABLE = 'agent_actions';
const VALID_TOOLS = new Set<AgentActionToolName>([
  'log_food',
  'update_food_log',
  'delete_food_log',
  'log_body_weight',
]);
const VALID_MEALS = new Set<AgentMealName>(['breakfast', 'lunch', 'dinner', 'snack']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asMeal(value: unknown): AgentMealName | null {
  return typeof value === 'string' && VALID_MEALS.has(value as AgentMealName) ? (value as AgentMealName) : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeUndoPayload(raw: unknown): AgentUndoPayload | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null;

  if (raw.kind === 'log_food') {
    const logIds = Array.isArray(raw.log_ids)
      ? raw.log_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const meal = asMeal(raw.meal) ?? 'snack';
    const date = typeof raw.date === 'string' ? raw.date : '';
    const totalCalories = asFiniteNumber(raw.total_calories) ?? 0;
    const itemCount = Math.max(logIds.length, Math.round(asFiniteNumber(raw.item_count) ?? logIds.length));
    const firstFoodName = typeof raw.first_food_name === 'string' ? raw.first_food_name : '';
    if (logIds.length === 0) return null;
    return {
      kind: 'log_food',
      date,
      meal,
      log_ids: logIds,
      total_calories: totalCalories,
      item_count: itemCount,
      first_food_name: firstFoodName,
    };
  }

  if (raw.kind === 'update_food_log') {
    if (!isRecord(raw.before) || !isRecord(raw.after)) return null;
    const id = typeof raw.before.id === 'string' ? raw.before.id.trim() : '';
    const date = typeof raw.before.date === 'string' ? raw.before.date : '';
    const servings = asFiniteNumber(raw.before.servings);
    const afterServings = asFiniteNumber(raw.after.servings);
    if (!id || !date || servings === null || afterServings === null) return null;
    return {
      kind: 'update_food_log',
      food_name: typeof raw.food_name === 'string' && raw.food_name.trim() ? raw.food_name.trim() : 'Food entry',
      before: {
        id,
        date,
        logged_at: typeof raw.before.logged_at === 'string' ? raw.before.logged_at : null,
        servings,
        meal_type: asMeal(raw.before.meal_type),
        group_id: typeof raw.before.group_id === 'string' ? raw.before.group_id : null,
        sort_order: Math.round(asFiniteNumber(raw.before.sort_order) ?? 0),
      },
      after: {
        date: typeof raw.after.date === 'string' ? raw.after.date : date,
        logged_at: typeof raw.after.logged_at === 'string' ? raw.after.logged_at : null,
        servings: afterServings,
        meal_type: asMeal(raw.after.meal_type),
      },
    };
  }

  if (raw.kind === 'delete_food_log') {
    if (!isRecord(raw.deleted_row)) return null;
    const row = raw.deleted_row;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const date = typeof row.date === 'string' ? row.date : '';
    const foodId = typeof row.food_id === 'string' ? row.food_id.trim() : '';
    const servings = asFiniteNumber(row.servings);
    if (!id || !date || !foodId || servings === null) return null;
    return {
      kind: 'delete_food_log',
      food_name: typeof raw.food_name === 'string' && raw.food_name.trim() ? raw.food_name.trim() : 'Food entry',
      calories: asFiniteNumber(raw.calories) ?? 0,
      deleted_row: {
        id,
        date,
        logged_at: typeof row.logged_at === 'string' ? row.logged_at : null,
        food_id: foodId,
        servings,
        meal_type: asMeal(row.meal_type),
        group_id: typeof row.group_id === 'string' ? row.group_id : null,
        sort_order: Math.round(asFiniteNumber(row.sort_order) ?? 0),
        source: typeof row.source === 'string' && row.source.trim() ? row.source.trim() : 'manual',
      },
    };
  }

  if (raw.kind === 'log_body_weight') {
    const weightId = typeof raw.weight_id === 'string' ? raw.weight_id.trim() : '';
    const kilograms = asFiniteNumber(raw.kilograms);
    const measuredAt = typeof raw.measured_at === 'string' ? raw.measured_at : '';
    if (!weightId || kilograms === null || kilograms <= 0) return null;
    return {
      kind: 'log_body_weight',
      weight_id: weightId,
      kilograms,
      measured_at: measuredAt,
    };
  }

  return null;
}

/** Normalizes a PostgREST row into a strongly typed AgentAction, or null if malformed. */
export function normalizeAgentAction(row: unknown): AgentAction | null {
  if (!isRecord(row)) return null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const userId = typeof row.user_id === 'string' ? row.user_id.trim() : '';
  const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
  const toolName = typeof row.tool_name === 'string' && VALID_TOOLS.has(row.tool_name as AgentActionToolName)
    ? (row.tool_name as AgentActionToolName)
    : null;
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  const undoPayload = normalizeUndoPayload(row.undo_payload);
  if (!id || !userId || !createdAt || !toolName || !summary || !undoPayload) return null;

  return {
    id,
    user_id: userId,
    created_at: createdAt,
    client_id: typeof row.client_id === 'string' && row.client_id.trim() ? row.client_id.trim() : null,
    agent_name: typeof row.agent_name === 'string' && row.agent_name.trim() ? row.agent_name.trim() : null,
    tool_name: toolName,
    summary,
    undo_payload: undoPayload,
    undone_at: typeof row.undone_at === 'string' && row.undone_at.trim() ? row.undone_at : null,
  };
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  return typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
}

/** True when PostgREST / Postgres reports that public.agent_actions does not exist yet. */
export function isMissingAgentActionsTableError(error: unknown): boolean {
  const code = errorCode(error);
  if (code === 'PGRST205' || code === '42P01') return true;
  const message = errorMessage(error).toLowerCase();
  return message.includes('agent_actions') && (message.includes('schema cache') || message.includes('does not exist'));
}

// ── Reads & 1-tap Undo ───────────────────────────────────────────────────

/** Lists recent agent actions, newest first. Returns tableMissing=true on pre-migration backends. */
export async function listAgentActions(
  userId: string,
  limit = MAX_RECENT_AGENT_ACTIONS,
): Promise<{ actions: AgentAction[]; tableMissing: boolean }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingAgentActionsTableError(error)) {
      return { actions: [], tableMissing: true };
    }
    throw error;
  }

  const actions = (data ?? [])
    .map((row) => normalizeAgentAction(row))
    .filter((row): row is AgentAction => row !== null);

  return { actions, tableMissing: false };
}

/**
 * Reverses a single agent action using its stored before/after snapshot and
 * marks `undone_at`. Safe to retry if a prior attempt partially succeeded.
 */
export async function undoAgentAction(
  userId: string,
  action: AgentAction,
  now: Date = new Date(),
): Promise<{ undoneAt: string; affected: 'nutrition' | 'weight' }> {
  const payload = action.undo_payload;
  const affected: 'nutrition' | 'weight' = payload.kind === 'log_body_weight' ? 'weight' : 'nutrition';

  if (action.undone_at) {
    return { undoneAt: action.undone_at, affected };
  }

  if (payload.kind === 'log_food') {
    const { error } = await supabase
      .from('nutrition_logs')
      .delete()
      .eq('user_id', userId)
      .in('id', payload.log_ids);
    if (error) throw error;
  } else if (payload.kind === 'update_food_log') {
    const restorePatch = {
      date: payload.before.date,
      logged_at: payload.before.logged_at,
      servings: payload.before.servings,
      meal_type: payload.before.meal_type,
      group_id: payload.before.group_id,
      sort_order: payload.before.sort_order,
    };
    let result = await supabase
      .from('nutrition_logs')
      .update(restorePatch)
      .eq('id', payload.before.id)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    // If the original meal group was deleted later, still restore servings/date/time without it.
    if (result.error && errorCode(result.error) === '23503' && payload.before.group_id !== null) {
      result = await supabase
        .from('nutrition_logs')
        .update({ ...restorePatch, group_id: null })
        .eq('id', payload.before.id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
    }
    if (result.error) throw result.error;
    if (!result.data) {
      throw new Error('This entry was already deleted.');
    }
  } else if (payload.kind === 'delete_food_log') {
    const restoreRow = {
      id: payload.deleted_row.id,
      user_id: userId,
      date: payload.deleted_row.date,
      logged_at: payload.deleted_row.logged_at,
      food_id: payload.deleted_row.food_id,
      servings: payload.deleted_row.servings,
      meal_type: payload.deleted_row.meal_type,
      group_id: payload.deleted_row.group_id,
      sort_order: payload.deleted_row.sort_order,
      source: payload.deleted_row.source,
    };
    let result = await supabase.from('nutrition_logs').insert(restoreRow);
    if (result.error && errorCode(result.error) === '23503' && payload.deleted_row.group_id !== null) {
      result = await supabase.from('nutrition_logs').insert({ ...restoreRow, group_id: null });
    }
    if (result.error && errorCode(result.error) !== '23505') {
      throw result.error;
    }
  } else if (payload.kind === 'log_body_weight') {
    const { error } = await supabase
      .from('body_weight_measurements')
      .delete()
      .eq('id', payload.weight_id)
      .eq('user_id', userId)
      .eq('source', 'manual');
    if (error) throw error;
  }

  const undoneAt = now.toISOString();
  const { error: markError } = await supabase
    .from(TABLE)
    .update({ undone_at: undoneAt })
    .eq('id', action.id)
    .eq('user_id', userId);
  if (markError) throw markError;

  return { undoneAt, affected };
}

// ── Blanc presentation helpers ───────────────────────────────────────────

function formatWholeCalories(calories: number): string {
  return `${Math.round(calories).toLocaleString('en-US')} kcal`;
}

function formatServings(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'serving' : 'servings'}`;
}

function mealWord(meal: AgentMealName): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1);
}

/**
 * Midnight-safe time label matching WeighInRows: "Today, 3:12 PM",
 * "Nov 22, 8:00 AM", or "Dec 12, 2025, 8:00 AM".
 */
export function agentActionTimeLabel(isoTimestamp: string, todayKey: string): string {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const key = format(date, 'yyyy-MM-dd');
  const day = key === todayKey
    ? 'Today'
    : format(date, key.slice(0, 4) === todayKey.slice(0, 4) ? 'MMM d' : 'MMM d, yyyy');
  return `${day}, ${format(date, 'h:mm a')}`;
}

/** Primary one-line title for a Recent activity row (respects preferred weight unit). */
export function formatAgentActionTitle(action: AgentAction, unit: WeightUnit): string {
  if (action.undo_payload.kind === 'log_body_weight') {
    return `Logged ${formatWeight(action.undo_payload.kilograms, unit)} ${unit}`;
  }
  return action.summary;
}

/** Quiet subtitle for a Recent activity row: actor, concise context, and timestamp. */
export function formatAgentActionDetail(
  action: AgentAction,
  options: {
    todayKey: string;
    agentNamesByClientId?: ReadonlyMap<string, string>;
  },
): string {
  const parts: string[] = [];
  if (action.undone_at) parts.push('Undone');

  const actor = (action.client_id ? options.agentNamesByClientId?.get(action.client_id) : undefined)
    ?? action.agent_name
    ?? 'Agent';
  parts.push(actor);

  const payload = action.undo_payload;
  if (payload.kind === 'log_food') {
    if (payload.total_calories > 0) parts.push(formatWholeCalories(payload.total_calories));
    parts.push(mealWord(payload.meal));
  } else if (payload.kind === 'update_food_log') {
    if (payload.before.servings !== payload.after.servings) {
      parts.push(`${payload.before.servings} → ${formatServings(payload.after.servings)}`);
    } else if (payload.before.meal_type !== payload.after.meal_type && payload.after.meal_type) {
      parts.push(mealWord(payload.after.meal_type));
    } else if (payload.before.date !== payload.after.date) {
      parts.push(payload.after.date);
    }
  } else if (payload.kind === 'delete_food_log') {
    if (payload.calories > 0) parts.push(formatWholeCalories(payload.calories));
  }

  const when = agentActionTimeLabel(action.created_at, options.todayKey);
  if (when) parts.push(when);

  return parts.join(' · ');
}
