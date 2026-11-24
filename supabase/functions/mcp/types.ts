// Pure TypeScript types for hyPer's Remote MCP Server. Kept free of Deno and
// network imports so Vitest can type-check and exercise the server directly.

export type MealName = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type NamedMealLabel = 'breakfast' | 'lunch' | 'dinner';
export type WeightUnit = 'lb' | 'kg';

export interface FoodRow {
  id: string;
  user_id: string | null;
  name: string;
  calories: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
  serving_size: number | string | null;
  serving_unit: string | null;
  source: string | null;
  fdc_id?: string | null;
  external_source?: string | null;
  external_id?: string | null;
  description?: string | null;
  created_at?: string | null;
}

export interface NutritionGroupRow {
  id: string;
  user_id: string;
  date: string;
  kind: 'meal' | 'snack';
  label: NamedMealLabel | null;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NutritionLogRow {
  id: string;
  user_id: string;
  date: string;
  logged_at: string | null;
  food_id: string;
  servings: number | string;
  meal_type: MealName | null;
  group_id: string | null;
  sort_order: number;
  source: string;
  created_at?: string | null;
}

export interface MacroTargetRow {
  id?: string;
  user_id: string;
  calories: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
  source?: string | null;
}

export interface NutritionProfileRow {
  user_id: string;
  unit_system: 'metric' | 'imperial';
  goal: 'cut' | 'maintain' | 'lean_bulk' | 'bulk';
  adaptive_enabled: boolean;
}

export interface BodyWeightRow {
  id: string;
  user_id: string;
  source: 'apple_health' | 'manual';
  external_id: string;
  measured_at: string;
  kilograms: number | string;
  source_bundle: string;
  source_name: string;
  created_at?: string | null;
}

export interface NewFoodInsert {
  user_id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: number;
  serving_unit: string;
  source: 'manual_entry';
  description?: string | null;
}

export interface NewNutritionGroupInsert {
  user_id: string;
  date: string;
  kind: 'meal' | 'snack';
  label: NamedMealLabel | null;
  sort_order: number;
}

export interface NewNutritionLogInsert {
  user_id: string;
  date: string;
  logged_at: string;
  food_id: string;
  servings: number;
  meal_type: MealName | null;
  group_id: string | null;
  sort_order: number;
  source: string;
}

export interface NutritionLogPatch {
  servings?: number;
  date?: string;
  logged_at?: string;
  meal_type?: MealName | null;
  group_id?: string | null;
  sort_order?: number;
}

export interface NewBodyWeightInsert {
  id: string;
  user_id: string;
  source: 'manual';
  external_id: string;
  measured_at: string;
  kilograms: number;
  source_bundle: string;
  source_name: string;
}

export type AgentActionToolName =
  | 'log_food'
  | 'update_food_log'
  | 'delete_food_log'
  | 'log_body_weight';

export type AgentUndoPayload =
  | {
      kind: 'log_food';
      date: string;
      meal: MealName;
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
        meal_type: MealName | null;
        group_id: string | null;
        sort_order: number;
      };
      after: {
        date: string;
        logged_at: string | null;
        servings: number;
        meal_type: MealName | null;
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
        meal_type: MealName | null;
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

export interface NewAgentActionInsert {
  user_id: string;
  client_id?: string | null;
  agent_name?: string | null;
  tool_name: AgentActionToolName;
  summary: string;
  undo_payload: AgentUndoPayload;
}

export interface AgentActionRow extends NewAgentActionInsert {
  id: string;
  created_at: string;
  undone_at: string | null;
}

/** User-scoped data access backed by Postgres RLS in production. */
export interface McpRepository {
  getMacroTargets(userId: string): Promise<MacroTargetRow | null>;
  getNutritionProfile(userId: string): Promise<NutritionProfileRow | null>;
  getNutritionGroupsForDate(userId: string, date: string): Promise<NutritionGroupRow[]>;
  getNutritionLogsForDate(userId: string, date: string): Promise<NutritionLogRow[]>;
  getNutritionLogById(userId: string, logId: string): Promise<NutritionLogRow | null>;
  getFoodsByIds(ids: string[]): Promise<FoodRow[]>;
  getFoodById(foodId: string): Promise<FoodRow | null>;
  searchUserFoods(userId: string, query: string | null, limit: number): Promise<FoodRow[]>;
  insertFood(food: NewFoodInsert): Promise<FoodRow>;
  insertNutritionGroup(group: NewNutritionGroupInsert): Promise<NutritionGroupRow>;
  updateNutritionGroupSortOrder(userId: string, groupId: string, sortOrder: number): Promise<void>;
  insertNutritionLogs(logs: NewNutritionLogInsert[]): Promise<NutritionLogRow[]>;
  updateNutritionLog(userId: string, logId: string, patch: NutritionLogPatch): Promise<NutritionLogRow | null>;
  deleteNutritionLog(userId: string, logId: string): Promise<boolean>;
  getRecentBodyWeights(userId: string, limit: number): Promise<BodyWeightRow[]>;
  insertBodyWeight(row: NewBodyWeightInsert): Promise<BodyWeightRow>;
  /** Records an undoable audit entry in public.agent_actions. Optional for partial test fakes. */
  insertAgentAction?(action: NewAgentActionInsert): Promise<AgentActionRow | null>;
}

export interface ApprovalRefusal {
  status: 403 | 503;
  body: Record<string, string>;
}

export type AuthenticatedCaller =
  | string
  | {
      userId: string;
      clientId?: string | null;
    };

export interface McpServices {
  /** Canonical URL of this protected MCP resource (RFC 9728 `resource`). */
  resourceUrl: string;
  /** Authorization server issuer URL (RFC 9728 `authorization_servers[0]`). */
  authIssuer: string;
  /** Returns the caller identity for a valid Bearer token, or null if invalid/expired. Throw on transient auth outage. */
  authenticate(token: string): Promise<AuthenticatedCaller | null>;
  /** Returns null when approved, or a 403/503 refusal (fail closed). */
  checkApproval(userId: string): Promise<ApprovalRefusal | null>;
  /** Returns a user-scoped repository whose queries run under Postgres RLS for that token. */
  repositoryFor(userId: string, token: string): McpRepository;
  /** Optional clock for tests. */
  now?: () => Date;
  /** Optional UUID generator for tests. */
  generateId?: () => string;
  /** Optional error logger. */
  log?: (message: string, error?: unknown) => void;
}

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}
