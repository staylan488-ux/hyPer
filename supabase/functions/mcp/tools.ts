// hyPer MCP v1 tools: nutrition summary, food search, food logging/editing/deleting,
// and body-weight logging. Pure TypeScript with strict input validation and zero
// Deno or network globals.

import type {
  BodyWeightRow,
  FoodRow,
  McpRepository,
  McpToolCallResult,
  McpToolDefinition,
  MealName,
  NamedMealLabel,
  NewNutritionLogInsert,
  NutritionGroupRow,
  NutritionLogPatch,
  NutritionLogRow,
  WeightUnit,
} from './types.ts';

export const KG_PER_LB = 0.45359237;
export const DEVICE_ONLY_FOOD_NAME = 'Brand food';
export const DEFAULT_MACRO_TARGETS = {
  calories: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
} as const;

const MEAL_NAMES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const NAMED_MEAL_ORDER: Record<NamedMealLabel, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i;
const MAX_LOG_ITEMS = 25;
const MAX_SERVINGS = 1000;
const MAX_CALORIES = 50_000;
const MAX_MACRO_GRAMS = 5_000;
const MAX_SERVING_SIZE = 100_000;
const MAX_FOOD_NAME_LEN = 300;
const MAX_SERVING_UNIT_LEN = 60;
const MAX_DESCRIPTION_LEN = 4000;
const MAX_SEARCH_QUERY_LEN = 120;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const RECENT_WEIGH_IN_LIMIT = 7;

export interface ToolContext {
  userId: string;
  repo: McpRepository;
  now: () => Date;
  generateId: () => string;
}

class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

/* ── Numeric, date & food helpers ──────────────────────────────────────── */

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function lbToKg(pounds: number): number {
  return roundTo(pounds * KG_PER_LB, 3);
}

export function kgToLb(kilograms: number): number {
  return roundTo(kilograms / KG_PER_LB, 2);
}

function asRecord(value: unknown, label = 'arguments'): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolValidationError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function todayUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parseDateArg(value: unknown, field: string, defaultDate: string): string {
  if (value === undefined) return defaultDate;
  if (typeof value !== 'string') {
    throw new ToolValidationError(`${field} must be a YYYY-MM-DD date string.`);
  }
  const trimmed = value.trim();
  const match = ISO_DATE_PATTERN.exec(trimmed);
  if (!match) {
    throw new ToolValidationError(`${field} must be formatted as YYYY-MM-DD.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDate(year, month, day)) {
    throw new ToolValidationError(`${field} is not a valid calendar date.`);
  }
  return trimmed;
}

function parseIsoTimestampArg(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolValidationError(`${field} must be an ISO 8601 timestamp string (e.g. 2026-11-22T12:30:00Z).`);
  }
  const trimmed = value.trim();
  const match = ISO_TIMESTAMP_PATTERN.exec(trimmed);
  if (!match) {
    throw new ToolValidationError(`${field} must be a valid ISO 8601 timestamp with timezone offset or Z.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    throw new ToolValidationError(`${field} is not a valid ISO 8601 timestamp.`);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new ToolValidationError(`${field} is not a valid ISO 8601 timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function parseUuidArg(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ToolValidationError(`${field} must be a valid UUID.`);
  }
  return value.trim();
}

function parseMealArg(value: unknown, field = 'meal'): MealName {
  if (typeof value !== 'string' || !(MEAL_NAMES as readonly string[]).includes(value)) {
    throw new ToolValidationError(`${field} must be one of: breakfast, lunch, dinner, snack.`);
  }
  return value as MealName;
}

function parsePositiveNumber(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ToolValidationError(`${field} must be a positive finite number.`);
  }
  if (value > max) {
    throw new ToolValidationError(`${field} must be at most ${max}.`);
  }
  return value;
}

function parseNonNegativeNumber(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ToolValidationError(`${field} must be a non-negative finite number.`);
  }
  if (value > max) {
    throw new ToolValidationError(`${field} must be at most ${max}.`);
  }
  return value;
}

function parseNonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ToolValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolValidationError(`${field} must not be empty.`);
  }
  if (trimmed.length > maxLength) {
    throw new ToolValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function num(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFoodName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Mirrors src/lib/deviceFoods.ts: FatSecret rows stored on the server carry
 * only their IDs, placeholder name "Brand food", and zero macros because
 * FatSecret's terms forbid storing their nutrition values server-side.
 */
export function isDeviceOnlyFoodStub(
  food: Pick<FoodRow, 'name' | 'source' | 'external_source' | 'external_id'>,
): boolean {
  const provider = food.external_source ?? food.source;
  return provider === 'fatsecret' && food.name === DEVICE_ONLY_FOOD_NAME;
}

function sortGroups(groups: readonly NutritionGroupRow[]): NutritionGroupRow[] {
  return [...groups].sort(
    (a, b) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
}

function groupTitle(group: NutritionGroupRow, allGroups: readonly NutritionGroupRow[]): string {
  if (group.label) {
    return group.label.charAt(0).toUpperCase() + group.label.slice(1);
  }
  const orderedSameKind = sortGroups(allGroups).filter((candidate) => candidate.kind === group.kind);
  const unnamedSameKind = orderedSameKind.filter((candidate) => !candidate.label);
  const ordinal = Math.max(1, orderedSameKind.findIndex((candidate) => candidate.id === group.id) + 1);
  const base = group.kind === 'snack' ? 'Snack' : 'Meal';
  return unnamedSameKind.length === 1 && ordinal === 1 ? base : `${base} ${ordinal}`;
}

function legacyMealTypeForGroup(group: NutritionGroupRow | null): MealName | null {
  if (!group) return null;
  if (group.label) return group.label;
  return group.kind === 'snack' ? 'snack' : null;
}

function normalizeGroupOrder(groups: readonly NutritionGroupRow[]): NutritionGroupRow[] {
  const ordered = sortGroups(groups);
  const namedMeals = ordered
    .filter((group): group is NutritionGroupRow & { label: NamedMealLabel } => group.label !== null)
    .sort((a, b) => NAMED_MEAL_ORDER[a.label] - NAMED_MEAL_ORDER[b.label]);
  let namedIndex = 0;

  return ordered.map((group, sortOrder) => ({
    ...(group.label ? namedMeals[namedIndex++] : group),
    sort_order: sortOrder,
  }));
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505';
}

function isNamedMeal(meal: MealName): meal is NamedMealLabel {
  return meal === 'breakfast' || meal === 'lunch' || meal === 'dinner';
}

/**
 * Finds or creates the day's nutrition_groups row for a meal, preserving
 * Breakfast < Lunch < Dinner ordering and schema constraints (snack groups use
 * kind = 'snack' and label = null).
 */
async function resolveOrCreateGroup(
  repo: McpRepository,
  userId: string,
  date: string,
  meal: MealName,
): Promise<{ group: NutritionGroupRow; allGroups: NutritionGroupRow[] }> {
  const existingGroups = sortGroups(await repo.getNutritionGroupsForDate(userId, date));

  if (isNamedMeal(meal)) {
    const existing = existingGroups.find((group) => group.label === meal);
    if (existing) return { group: existing, allGroups: existingGroups };

    let created: NutritionGroupRow;
    try {
      created = await repo.insertNutritionGroup({
        user_id: userId,
        date,
        kind: 'meal',
        label: meal,
        sort_order: existingGroups.length,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const refreshed = sortGroups(await repo.getNutritionGroupsForDate(userId, date));
        const raced = refreshed.find((group) => group.label === meal);
        if (raced) return { group: raced, allGroups: refreshed };
      }
      throw error;
    }

    const combined = [...existingGroups, created];
    const normalized = normalizeGroupOrder(combined);
    const previousOrder = new Map(combined.map((group) => [group.id, group.sort_order]));
    const changed = normalized.filter((group) => previousOrder.get(group.id) !== group.sort_order);
    await Promise.all(
      changed.map((group) => repo.updateNutritionGroupSortOrder(userId, group.id, group.sort_order)),
    );
    const resolved = normalized.find((group) => group.id === created.id) ?? created;
    return { group: resolved, allGroups: normalized };
  }

  // Snack group: label MUST be null per schema CHECK constraint.
  const existingSnack = existingGroups.find((group) => group.kind === 'snack' && group.label === null);
  if (existingSnack) return { group: existingSnack, allGroups: existingGroups };

  const created = await repo.insertNutritionGroup({
    user_id: userId,
    date,
    kind: 'snack',
    label: null,
    sort_order: existingGroups.length,
  });
  return { group: created, allGroups: [...existingGroups, created] };
}

function logTimestampMs(log: Pick<NutritionLogRow, 'logged_at' | 'created_at' | 'date'>): number {
  if (log.logged_at) {
    const parsed = Date.parse(log.logged_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (log.created_at) {
    const parsed = Date.parse(log.created_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.parse(`${log.date}T12:00:00.000Z`);
}

function formatEntryOutput(log: NutritionLogRow, food: FoodRow | null) {
  const servings = roundTo(num(log.servings, 0), 2);
  const stub = food ? isDeviceOnlyFoodStub(food) : false;
  const calories = food && !stub ? roundTo(num(food.calories) * servings, 1) : 0;
  const protein = food && !stub ? roundTo(num(food.protein) * servings, 1) : 0;
  const carbs = food && !stub ? roundTo(num(food.carbs) * servings, 1) : 0;
  const fat = food && !stub ? roundTo(num(food.fat) * servings, 1) : 0;

  return {
    id: log.id,
    date: log.date,
    food_id: log.food_id,
    food_name: food?.name ?? 'Unknown food',
    servings,
    serving_size: food ? num(food.serving_size, 1) : 1,
    serving_unit: food?.serving_unit?.trim() || 'serving',
    calories,
    protein,
    carbs,
    fat,
    meal_type: log.meal_type ?? null,
    group_id: log.group_id ?? null,
    logged_at: log.logged_at ?? null,
    ...(stub ? { device_only_stub: true } : {}),
  };
}

function formatWeighInOutput(row: BodyWeightRow) {
  const kilograms = roundTo(num(row.kilograms), 3);
  return {
    id: row.id,
    measured_at: row.measured_at,
    kilograms,
    pounds: kgToLb(kilograms),
    source: row.source,
    source_name: row.source_name,
  };
}

function okResult(summary: string, data: Record<string, unknown>): McpToolCallResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

function errorResult(message: string): McpToolCallResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/* ── Tool definitions (MCP tools/list) ─────────────────────────────────── */

const LOG_ITEM_PROPERTIES: Record<string, unknown> = {
  food_id: {
    type: 'string',
    format: 'uuid',
    description: 'UUID of an existing food returned by search_foods or get_day_summary. Omit inline macro fields when using food_id.',
  },
  servings: {
    type: 'number',
    exclusiveMinimum: 0,
    maximum: MAX_SERVINGS,
    description: 'Number of servings logged (positive number, default 1).',
  },
  name: {
    type: 'string',
    minLength: 1,
    maxLength: MAX_FOOD_NAME_LEN,
    description: 'Food name for an inline custom/estimated food (required when food_id is omitted).',
  },
  calories: {
    type: 'number',
    minimum: 0,
    maximum: MAX_CALORIES,
    description: 'Calories (kcal) per single serving for an inline food.',
  },
  protein: {
    type: 'number',
    minimum: 0,
    maximum: MAX_MACRO_GRAMS,
    description: 'Protein in grams per single serving for an inline food.',
  },
  carbs: {
    type: 'number',
    minimum: 0,
    maximum: MAX_MACRO_GRAMS,
    description: 'Carbohydrates in grams per single serving for an inline food.',
  },
  fat: {
    type: 'number',
    minimum: 0,
    maximum: MAX_MACRO_GRAMS,
    description: 'Fat in grams per single serving for an inline food.',
  },
  serving_size: {
    type: 'number',
    exclusiveMinimum: 0,
    maximum: MAX_SERVING_SIZE,
    description: 'Serving size amount for an inline food (default 1).',
  },
  serving_unit: {
    type: 'string',
    minLength: 1,
    maxLength: MAX_SERVING_UNIT_LEN,
    description: 'Serving unit for an inline food, e.g. "serving", "g", "oz", "cup" (default "serving").',
  },
  description: {
    type: 'string',
    maxLength: MAX_DESCRIPTION_LEN,
    description: 'Optional notes or plate description for an inline food.',
  },
};

const LOG_ITEM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: 'Either reference an existing food via food_id, or provide inline food details (name, calories, protein, carbs, fat).',
  properties: LOG_ITEM_PROPERTIES,
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: 'get_day_summary',
    title: 'Get Day Nutrition & Weight Summary',
    description:
      'Returns the user\'s nutrition summary for a given date (defaults to today UTC): daily macro targets, logged totals, remaining macros, nutrition profile preferences, meal groups, logged food entries with calculated macros, and the 7 most recent body-weight weigh-ins in both kg and lb.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Calendar date in YYYY-MM-DD format. Defaults to today (UTC).',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'search_foods',
    title: 'Search User Foods',
    description:
      'Searches the user\'s own saved meals, custom foods, and previously logged foods by name, or returns the most recently used foods when query is omitted. Use this before log_food to reuse existing food_id values when available.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: MAX_SEARCH_QUERY_LEN,
          description: 'Optional case-insensitive food name search text. Omit to list recent foods.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          default: DEFAULT_SEARCH_LIMIT,
          description: 'Maximum number of foods to return (1-50, default 20).',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'log_food',
    title: 'Log Food Entry',
    description:
      'Logs one or more food items to a meal on the specified date (defaults to today UTC and meal "snack"). Pass either an `items` array for multi-item logging, or top-level single-item fields. Each item can reference an existing `food_id` or create an inline custom/estimated food with name and per-serving macros.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Date to log the food under (YYYY-MM-DD). Defaults to today (UTC).',
        },
        meal: {
          type: 'string',
          enum: [...MEAL_NAMES],
          default: 'snack',
          description: 'Meal bucket for the logged items: breakfast, lunch, dinner, or snack (default "snack").',
        },
        logged_at: {
          type: 'string',
          format: 'date-time',
          description: 'Optional ISO 8601 timestamp with timezone for when the meal was eaten.',
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_LOG_ITEMS,
          items: LOG_ITEM_SCHEMA,
          description: 'One or more food items to log together. Omit top-level single-item fields when passing items.',
        },
        ...LOG_ITEM_PROPERTIES,
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'update_food_log',
    title: 'Update Food Log Entry',
    description:
      'Updates an existing food log entry owned by the user (servings, date, logged_at, and/or meal). Automatically moves the entry to the matching meal group when meal or date changes.',
    inputSchema: {
      type: 'object',
      required: ['log_id'],
      properties: {
        log_id: {
          type: 'string',
          format: 'uuid',
          description: 'UUID of the nutrition_logs entry to update.',
        },
        servings: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: MAX_SERVINGS,
          description: 'Updated number of servings (positive finite number).',
        },
        date: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Updated date in YYYY-MM-DD format.',
        },
        logged_at: {
          type: 'string',
          format: 'date-time',
          description: 'Updated ISO 8601 timestamp with timezone.',
        },
        meal: {
          type: 'string',
          enum: [...MEAL_NAMES],
          description: 'Updated meal bucket: breakfast, lunch, dinner, or snack.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'delete_food_log',
    title: 'Delete Food Log Entry',
    description:
      'Permanently deletes an existing food log entry by log_id and returns a summary of the removed entry so the deletion can be confirmed.',
    inputSchema: {
      type: 'object',
      required: ['log_id'],
      properties: {
        log_id: {
          type: 'string',
          format: 'uuid',
          description: 'UUID of the nutrition_logs entry to delete.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'log_body_weight',
    title: 'Log Body Weight',
    description:
      'Records a body-weight measurement in lb or kg (stored accurately in kilograms) and returns the saved weigh-in in both kg and lb.',
    inputSchema: {
      type: 'object',
      required: ['weight', 'unit'],
      properties: {
        weight: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Body weight value as a positive number (must convert to between 0 and 500 kg).',
        },
        unit: {
          type: 'string',
          enum: ['lb', 'kg'],
          description: 'Unit of the provided weight: "lb" or "kg".',
        },
        measured_at: {
          type: 'string',
          format: 'date-time',
          description: 'Optional ISO 8601 timestamp with timezone when weighed. Defaults to now.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

/* ── Tool implementations ──────────────────────────────────────────────── */

async function runGetDaySummary(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);
  const date = parseDateArg(args.date, 'date', todayUtcDate(ctx.now()));

  const [logs, rawGroups, targetRow, profileRow, recentWeights] = await Promise.all([
    ctx.repo.getNutritionLogsForDate(ctx.userId, date),
    ctx.repo.getNutritionGroupsForDate(ctx.userId, date),
    ctx.repo.getMacroTargets(ctx.userId),
    ctx.repo.getNutritionProfile(ctx.userId),
    ctx.repo.getRecentBodyWeights(ctx.userId, RECENT_WEIGH_IN_LIMIT),
  ]);

  const foodIds = [...new Set(logs.map((log) => log.food_id).filter(Boolean))];
  const foods = foodIds.length > 0 ? await ctx.repo.getFoodsByIds(foodIds) : [];
  const foodById = new Map(foods.map((food) => [food.id, food]));

  const sortedGroups = sortGroups(rawGroups);
  const groupOrderById = new Map(sortedGroups.map((group, index) => [group.id, index]));

  const sortedLogs = [...logs].sort((a, b) => {
    const groupA = a.group_id ? (groupOrderById.get(a.group_id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const groupB = b.group_id ? (groupOrderById.get(b.group_id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    return groupA - groupB || (a.sort_order ?? 0) - (b.sort_order ?? 0) || logTimestampMs(a) - logTimestampMs(b);
  });

  let rawCalories = 0;
  let rawProtein = 0;
  let rawCarbs = 0;
  let rawFat = 0;
  let hasDeviceStub = false;

  const entries = sortedLogs.map((log) => {
    const food = foodById.get(log.food_id) ?? null;
    const servings = num(log.servings, 0);
    if (food && isDeviceOnlyFoodStub(food)) {
      hasDeviceStub = true;
    } else if (food) {
      rawCalories += num(food.calories) * servings;
      rawProtein += num(food.protein) * servings;
      rawCarbs += num(food.carbs) * servings;
      rawFat += num(food.fat) * servings;
    }
    return formatEntryOutput(log, food);
  });

  const macroTargets = targetRow
    ? {
        calories: num(targetRow.calories, DEFAULT_MACRO_TARGETS.calories),
        protein: num(targetRow.protein, DEFAULT_MACRO_TARGETS.protein),
        carbs: num(targetRow.carbs, DEFAULT_MACRO_TARGETS.carbs),
        fat: num(targetRow.fat, DEFAULT_MACRO_TARGETS.fat),
        source: targetRow.source || 'manual',
        is_default: false,
      }
    : {
        ...DEFAULT_MACRO_TARGETS,
        source: 'default',
        is_default: true,
      };

  const totals = {
    calories: roundTo(rawCalories, 1),
    protein: roundTo(rawProtein, 1),
    carbs: roundTo(rawCarbs, 1),
    fat: roundTo(rawFat, 1),
  };

  const remaining = {
    calories: roundTo(macroTargets.calories - totals.calories, 1),
    protein: roundTo(macroTargets.protein - totals.protein, 1),
    carbs: roundTo(macroTargets.carbs - totals.carbs, 1),
    fat: roundTo(macroTargets.fat - totals.fat, 1),
  };

  const nutritionProfile = profileRow
    ? {
        unit_system: profileRow.unit_system,
        goal: profileRow.goal,
        adaptive_enabled: Boolean(profileRow.adaptive_enabled),
      }
    : null;

  const groups = sortedGroups.map((group) => ({
    id: group.id,
    kind: group.kind,
    label: group.label,
    title: groupTitle(group, sortedGroups),
    sort_order: group.sort_order,
  }));

  const recentWeighIns = recentWeights.map(formatWeighInOutput);

  const payload: Record<string, unknown> = {
    date,
    macro_targets: macroTargets,
    totals,
    remaining,
    nutrition_profile: nutritionProfile,
    groups,
    entries,
    recent_weigh_ins: recentWeighIns,
    ...(hasDeviceStub ? { incomplete: true } : {}),
  };

  const summary =
    `Summary for ${date}: ${totals.calories}/${macroTargets.calories} kcal, `
    + `${totals.protein}/${macroTargets.protein}g P, ${totals.carbs}/${macroTargets.carbs}g C, `
    + `${totals.fat}/${macroTargets.fat}g F (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, `
    + `${recentWeighIns.length} recent weigh-in${recentWeighIns.length === 1 ? '' : 's'}).`;

  return okResult(summary, payload);
}

function foodSignature(food: FoodRow): string {
  return [
    normalizeFoodName(food.name),
    roundTo(num(food.calories), 1),
    roundTo(num(food.protein), 1),
    roundTo(num(food.carbs), 1),
    roundTo(num(food.fat), 1),
    roundTo(num(food.serving_size, 1), 2),
    (food.serving_unit || 'serving').trim().toLowerCase(),
  ].join('|');
}

function foodSourcePriority(source: string | null | undefined): number {
  if (source === 'saved_meal' || source === 'custom') return 0;
  return 1;
}

async function runSearchFoods(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);

  let query: string | null = null;
  if (args.query !== undefined) {
    if (typeof args.query !== 'string') {
      throw new ToolValidationError('query must be a string.');
    }
    const trimmed = args.query.trim();
    if (trimmed.length > MAX_SEARCH_QUERY_LEN) {
      throw new ToolValidationError(`query must be at most ${MAX_SEARCH_QUERY_LEN} characters.`);
    }
    query = trimmed.length > 0 ? trimmed : null;
  }

  let limit = DEFAULT_SEARCH_LIMIT;
  if (args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_SEARCH_LIMIT) {
      throw new ToolValidationError(`limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}.`);
    }
    limit = args.limit;
  }

  // Over-fetch slightly so filtering device-only stubs and collapsing duplicate rows
  // still fills up to `limit` results.
  const fetchLimit = Math.min(limit * 3, 150);
  const rawRows = await ctx.repo.searchUserFoods(ctx.userId, query, fetchLimit);

  const visible = rawRows.filter((row) => !isDeviceOnlyFoodStub(row) && row.name.trim().length > 0);

  // Deduplicate identical name + macros + serving basis, preferring saved_meal/custom rows.
  const bySignature = new Map<string, FoodRow>();
  for (const row of visible) {
    const key = foodSignature(row);
    const existing = bySignature.get(key);
    if (!existing) {
      bySignature.set(key, row);
    } else if (foodSourcePriority(row.source) < foodSourcePriority(existing.source)) {
      bySignature.set(key, row);
    }
  }

  const normalizedQuery = query ? normalizeFoodName(query) : null;
  const deduped = [...bySignature.values()];
  if (normalizedQuery) {
    deduped.sort((a, b) => {
      const aStarts = normalizeFoodName(a.name).startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = normalizeFoodName(b.name).startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      const aPrio = foodSourcePriority(a.source);
      const bPrio = foodSourcePriority(b.source);
      if (aPrio !== bPrio) return aPrio - bPrio;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });
  }

  const foods = deduped.slice(0, limit).map((row) => ({
    id: row.id,
    name: row.name,
    calories: roundTo(num(row.calories), 1),
    protein: roundTo(num(row.protein), 1),
    carbs: roundTo(num(row.carbs), 1),
    fat: roundTo(num(row.fat), 1),
    serving_size: roundTo(num(row.serving_size, 1), 2),
    serving_unit: row.serving_unit?.trim() || 'serving',
    source: row.source || 'custom',
    description: row.description ?? null,
  }));

  const payload: Record<string, unknown> = {
    query,
    count: foods.length,
    foods,
  };

  const summary = query
    ? `Found ${foods.length} food${foods.length === 1 ? '' : 's'} matching "${query}".`
    : `Returned ${foods.length} recent food${foods.length === 1 ? '' : 's'}.`;

  return okResult(summary, payload);
}

type ParsedLogItem =
  | { kind: 'existing'; foodId: string; servings: number }
  | {
      kind: 'inline';
      name: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      servings: number;
      servingSize: number;
      servingUnit: string;
      description: string | null;
    };

const SINGLE_ITEM_FIELDS = [
  'food_id',
  'servings',
  'name',
  'calories',
  'protein',
  'carbs',
  'fat',
  'serving_size',
  'serving_unit',
  'description',
] as const;

const INLINE_ONLY_FIELDS = [
  'name',
  'calories',
  'protein',
  'carbs',
  'fat',
  'serving_size',
  'serving_unit',
  'description',
] as const;

function parseLogItem(raw: unknown, prefix: string): ParsedLogItem {
  const item = asRecord(raw, prefix);
  const hasFoodId = item.food_id !== undefined;
  const hasInlineField = INLINE_ONLY_FIELDS.some((key) => item[key] !== undefined);

  if (hasFoodId && hasInlineField) {
    throw new ToolValidationError(`${prefix} cannot specify both food_id and inline food fields.`);
  }

  if (hasFoodId) {
    const foodId = parseUuidArg(item.food_id, `${prefix}.food_id`);
    const servings = item.servings === undefined
      ? 1
      : roundTo(parsePositiveNumber(item.servings, `${prefix}.servings`, MAX_SERVINGS), 2);
    if (servings <= 0) {
      throw new ToolValidationError(`${prefix}.servings must be greater than 0.`);
    }
    return { kind: 'existing', foodId, servings };
  }

  if (!hasInlineField) {
    throw new ToolValidationError(
      `${prefix} must provide either food_id or inline food details (name, calories, protein, carbs, fat).`,
    );
  }

  const name = parseNonEmptyString(item.name, `${prefix}.name`, MAX_FOOD_NAME_LEN);
  const calories = roundTo(parseNonNegativeNumber(item.calories, `${prefix}.calories`, MAX_CALORIES), 1);
  const protein = roundTo(parseNonNegativeNumber(item.protein, `${prefix}.protein`, MAX_MACRO_GRAMS), 1);
  const carbs = roundTo(parseNonNegativeNumber(item.carbs, `${prefix}.carbs`, MAX_MACRO_GRAMS), 1);
  const fat = roundTo(parseNonNegativeNumber(item.fat, `${prefix}.fat`, MAX_MACRO_GRAMS), 1);
  const servings = item.servings === undefined
    ? 1
    : roundTo(parsePositiveNumber(item.servings, `${prefix}.servings`, MAX_SERVINGS), 2);
  if (servings <= 0) {
    throw new ToolValidationError(`${prefix}.servings must be greater than 0.`);
  }
  const servingSize = item.serving_size === undefined
    ? 1
    : roundTo(parsePositiveNumber(item.serving_size, `${prefix}.serving_size`, MAX_SERVING_SIZE), 2);
  if (servingSize <= 0) {
    throw new ToolValidationError(`${prefix}.serving_size must be greater than 0.`);
  }
  const servingUnit = item.serving_unit === undefined
    ? 'serving'
    : parseNonEmptyString(item.serving_unit, `${prefix}.serving_unit`, MAX_SERVING_UNIT_LEN);

  let description: string | null = null;
  if (item.description !== undefined && item.description !== null) {
    if (typeof item.description !== 'string') {
      throw new ToolValidationError(`${prefix}.description must be a string.`);
    }
    const trimmed = item.description.trim();
    if (trimmed.length > MAX_DESCRIPTION_LEN) {
      throw new ToolValidationError(`${prefix}.description must be at most ${MAX_DESCRIPTION_LEN} characters.`);
    }
    description = trimmed.length > 0 ? trimmed : null;
  }

  return {
    kind: 'inline',
    name,
    calories,
    protein,
    carbs,
    fat,
    servings,
    servingSize,
    servingUnit,
    description,
  };
}

async function runLogFood(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);
  const now = ctx.now();
  const todayUtc = todayUtcDate(now);
  const date = parseDateArg(args.date, 'date', todayUtc);
  const meal: MealName = args.meal === undefined ? 'snack' : parseMealArg(args.meal, 'meal');
  const loggedAt = args.logged_at === undefined
    ? (date === todayUtc ? now.toISOString() : `${date}T12:00:00.000Z`)
    : parseIsoTimestampArg(args.logged_at, 'logged_at');

  const hasItemsArray = args.items !== undefined;
  const hasSingleFields = SINGLE_ITEM_FIELDS.some((key) => args[key] !== undefined);

  if (hasItemsArray && hasSingleFields) {
    throw new ToolValidationError('Provide either an items array or top-level single-item fields, not both.');
  }

  let parsedItems: ParsedLogItem[];
  if (hasItemsArray) {
    if (!Array.isArray(args.items) || args.items.length === 0) {
      throw new ToolValidationError('items must be a non-empty array of food items.');
    }
    if (args.items.length > MAX_LOG_ITEMS) {
      throw new ToolValidationError(`At most ${MAX_LOG_ITEMS} items can be logged in one call.`);
    }
    parsedItems = args.items.map((item, index) => parseLogItem(item, `items[${index}]`));
  } else if (hasSingleFields) {
    const single: Record<string, unknown> = {};
    for (const key of SINGLE_ITEM_FIELDS) {
      if (args[key] !== undefined) single[key] = args[key];
    }
    parsedItems = [parseLogItem(single, 'item')];
  } else {
    throw new ToolValidationError('Provide items or single-item fields (food_id or name/calories/protein/carbs/fat).');
  }

  // Verify every referenced food_id exists and is accessible BEFORE inserting anything.
  const existingFoodMap = new Map<string, FoodRow>();
  for (const item of parsedItems) {
    if (item.kind !== 'existing' || existingFoodMap.has(item.foodId)) continue;
    const food = await ctx.repo.getFoodById(item.foodId);
    if (!food) {
      throw new ToolValidationError(`Food not found or not accessible: ${item.foodId}`);
    }
    if (isDeviceOnlyFoodStub(food)) {
      throw new ToolValidationError(
        `Food ${item.foodId} is a device-only brand food whose details are stored only on the user's phone; provide inline macros instead.`,
      );
    }
    existingFoodMap.set(item.foodId, food);
  }

  // Resolve or create the matching nutrition_groups row and compute next sort_order.
  const [{ group, allGroups }, existingLogs] = await Promise.all([
    resolveOrCreateGroup(ctx.repo, ctx.userId, date, meal),
    ctx.repo.getNutritionLogsForDate(ctx.userId, date),
  ]);
  const baseSortOrder = existingLogs.filter((log) => log.group_id === group.id).length;
  const mealType = legacyMealTypeForGroup(group);

  // Create inline foods rows where needed, then insert all nutrition_logs rows.
  const resolvedFoods: Array<{ food: FoodRow; servings: number; createdFood: boolean }> = [];
  for (const item of parsedItems) {
    if (item.kind === 'existing') {
      resolvedFoods.push({
        food: existingFoodMap.get(item.foodId) as FoodRow,
        servings: item.servings,
        createdFood: false,
      });
    } else {
      const inserted = await ctx.repo.insertFood({
        user_id: ctx.userId,
        name: item.name,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        serving_size: item.servingSize,
        serving_unit: item.servingUnit,
        source: 'manual_entry',
        ...(item.description ? { description: item.description } : {}),
      });
      resolvedFoods.push({ food: inserted, servings: item.servings, createdFood: true });
    }
  }

  const logInserts: NewNutritionLogInsert[] = resolvedFoods.map(({ food, servings }, index) => ({
    user_id: ctx.userId,
    date,
    logged_at: loggedAt,
    food_id: food.id,
    servings,
    meal_type: mealType,
    group_id: group.id,
    sort_order: baseSortOrder + index,
    // Matches saveNutritionEntry.ts (`chosenFoodLogSource`): USDA foods keep 'usda', others use 'manual'.
    source: food.source === 'usda' ? 'usda' : 'manual',
  }));

  const insertedLogs = await ctx.repo.insertNutritionLogs(logInserts);

  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  const entries = insertedLogs.map((log, index) => {
    const resolved = resolvedFoods[index];
    const food = resolved?.food ?? existingFoodMap.get(log.food_id) ?? null;
    const servings = num(log.servings, 0);
    if (food) {
      totalCalories += num(food.calories) * servings;
      totalProtein += num(food.protein) * servings;
      totalCarbs += num(food.carbs) * servings;
      totalFat += num(food.fat) * servings;
    }
    return {
      ...formatEntryOutput(log, food),
      created_food: resolved?.createdFood ?? false,
    };
  });

  const loggedTotals = {
    calories: roundTo(totalCalories, 1),
    protein: roundTo(totalProtein, 1),
    carbs: roundTo(totalCarbs, 1),
    fat: roundTo(totalFat, 1),
  };

  const payload: Record<string, unknown> = {
    date,
    meal,
    group: {
      id: group.id,
      kind: group.kind,
      label: group.label,
      title: groupTitle(group, allGroups),
    },
    logged_totals: loggedTotals,
    entries,
  };

  const summary =
    `Logged ${entries.length} item${entries.length === 1 ? '' : 's'} to ${groupTitle(group, allGroups)} on ${date} `
    + `(${loggedTotals.calories} kcal, ${loggedTotals.protein}g P, ${loggedTotals.carbs}g C, ${loggedTotals.fat}g F).`;

  return okResult(summary, payload);
}

async function runUpdateFoodLog(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);
  const logId = parseUuidArg(args.log_id, 'log_id');

  const hasServings = args.servings !== undefined;
  const hasDate = args.date !== undefined;
  const hasLoggedAt = args.logged_at !== undefined;
  const hasMeal = args.meal !== undefined;

  if (!hasServings && !hasDate && !hasLoggedAt && !hasMeal) {
    throw new ToolValidationError('Provide at least one field to update: servings, date, logged_at, or meal.');
  }

  const nextServings = hasServings
    ? roundTo(parsePositiveNumber(args.servings, 'servings', MAX_SERVINGS), 2)
    : undefined;
  if (nextServings !== undefined && nextServings <= 0) {
    throw new ToolValidationError('servings must be greater than 0.');
  }
  const nextDateInput = hasDate ? parseDateArg(args.date, 'date', '') : undefined;
  const nextLoggedAt = hasLoggedAt ? parseIsoTimestampArg(args.logged_at, 'logged_at') : undefined;
  const nextMeal = hasMeal ? parseMealArg(args.meal, 'meal') : undefined;

  const existing = await ctx.repo.getNutritionLogById(ctx.userId, logId);
  if (!existing || existing.user_id !== ctx.userId) {
    throw new ToolValidationError('Food log entry not found.');
  }

  const patch: NutritionLogPatch = {};
  if (nextServings !== undefined) patch.servings = nextServings;
  if (nextLoggedAt !== undefined) patch.logged_at = nextLoggedAt;

  const targetDate = nextDateInput ?? existing.date;
  const dateChanged = targetDate !== existing.date;
  if (nextDateInput !== undefined) patch.date = targetDate;

  if (nextMeal !== undefined || dateChanged) {
    const resolvedMeal: MealName | null = nextMeal ?? existing.meal_type ?? null;
    if (resolvedMeal) {
      const [{ group }, targetDayLogs] = await Promise.all([
        resolveOrCreateGroup(ctx.repo, ctx.userId, targetDate, resolvedMeal),
        ctx.repo.getNutritionLogsForDate(ctx.userId, targetDate),
      ]);
      patch.group_id = group.id;
      patch.meal_type = legacyMealTypeForGroup(group);
      if (group.id !== existing.group_id) {
        patch.sort_order = targetDayLogs.filter((log) => log.id !== existing.id && log.group_id === group.id).length;
      }
    } else if (dateChanged) {
      patch.group_id = null;
      patch.meal_type = null;
    }
  }

  const updated = await ctx.repo.updateNutritionLog(ctx.userId, logId, patch);
  if (!updated) {
    throw new ToolValidationError('Food log entry not found.');
  }

  const food = await ctx.repo.getFoodById(updated.food_id);
  const entry = formatEntryOutput(updated, food);

  const payload: Record<string, unknown> = {
    updated: true,
    entry,
  };

  const summary =
    `Updated "${entry.food_name}" (${entry.servings} serving${entry.servings === 1 ? '' : 's'}, `
    + `${entry.calories} kcal) on ${entry.date}.`;

  return okResult(summary, payload);
}

async function runDeleteFoodLog(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);
  const logId = parseUuidArg(args.log_id, 'log_id');

  const existing = await ctx.repo.getNutritionLogById(ctx.userId, logId);
  if (!existing || existing.user_id !== ctx.userId) {
    throw new ToolValidationError('Food log entry not found.');
  }

  const food = await ctx.repo.getFoodById(existing.food_id);
  const entry = formatEntryOutput(existing, food);

  const deleted = await ctx.repo.deleteNutritionLog(ctx.userId, logId);
  if (!deleted) {
    throw new ToolValidationError('Food log entry not found.');
  }

  const payload: Record<string, unknown> = {
    deleted: true,
    entry,
  };

  const summary = `Deleted "${entry.food_name}" (${entry.calories} kcal) from ${entry.date}.`;
  return okResult(summary, payload);
}

async function runLogBodyWeight(rawArgs: unknown, ctx: ToolContext): Promise<McpToolCallResult> {
  const args = asRecord(rawArgs);

  if (typeof args.weight !== 'number' || !Number.isFinite(args.weight) || args.weight <= 0) {
    throw new ToolValidationError('weight must be a positive finite number.');
  }
  if (args.unit !== 'lb' && args.unit !== 'kg') {
    throw new ToolValidationError('unit must be "lb" or "kg".');
  }

  const weight = args.weight;
  const unit: WeightUnit = args.unit;
  const measuredAt = args.measured_at === undefined
    ? ctx.now().toISOString()
    : parseIsoTimestampArg(args.measured_at, 'measured_at');

  const kilograms = unit === 'lb' ? lbToKg(weight) : roundTo(weight, 3);
  if (!Number.isFinite(kilograms) || kilograms <= 0 || kilograms >= 500) {
    throw new ToolValidationError('weight must convert to greater than 0 kg and less than 500 kg.');
  }

  const id = ctx.generateId();
  const saved = await ctx.repo.insertBodyWeight({
    id,
    user_id: ctx.userId,
    source: 'manual',
    external_id: `agent:${id}`,
    measured_at: measuredAt,
    kilograms,
    source_bundle: 'agent',
    source_name: 'Agent',
  });

  const savedKg = roundTo(num(saved.kilograms), 3);
  const savedLb = kgToLb(savedKg);

  const payload: Record<string, unknown> = {
    id: saved.id,
    measured_at: saved.measured_at,
    kilograms: savedKg,
    pounds: savedLb,
    source: saved.source,
    external_id: saved.external_id,
    source_bundle: saved.source_bundle,
    source_name: saved.source_name,
  };

  const summary = `Logged body weight: ${savedLb} lb (${savedKg} kg) at ${saved.measured_at}.`;
  return okResult(summary, payload);
}

const TOOL_HANDLERS: Record<string, (rawArgs: unknown, ctx: ToolContext) => Promise<McpToolCallResult>> = {
  get_day_summary: runGetDaySummary,
  search_foods: runSearchFoods,
  log_food: runLogFood,
  update_food_log: runUpdateFoodLog,
  delete_food_log: runDeleteFoodLog,
  log_body_weight: runLogBodyWeight,
};

export function hasTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name);
}

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
  log: (message: string, error?: unknown) => void,
): Promise<McpToolCallResult> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return errorResult(`Unknown tool: ${name}`);
  }
  try {
    return await handler(rawArgs, ctx);
  } catch (error) {
    if (error instanceof ToolValidationError) {
      return errorResult(error.message);
    }
    log(`mcp: tool ${name} failed`, error);
    return errorResult(`Failed to run ${name}. Try again.`);
  }
}
