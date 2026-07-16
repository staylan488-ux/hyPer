import type { SupabaseClient } from '@supabase/supabase-js';
import { cronometerGroupDestination, sortNutritionGroups } from './nutritionGroups';
import type { NutritionGroup } from '@/types';

export interface CronometerRow {
  date: string;
  time: string | null;
  group: string;
  foodName: string;
  amount: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  rowNumber: number;
}

export interface CronometerImportSummary {
  rows: number;
  imported: number;
  skipped: number;
  invalid: number;
  alreadyImportedFile: boolean;
}

type CsvRecord = Record<string, string>;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/Âµ/g, 'µ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ''));
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function recordsFromCsv(text: string): CsvRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() || ''])
  ));
}

function first(record: CsvRecord, aliases: string[]): string {
  for (const alias of aliases) {
    const value = record[normalizeHeader(alias)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function numberValue(record: CsvRecord, aliases: string[]): number {
  const raw = first(record, aliases).replace(/[^0-9+\-.]/g, '');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateKey(raw: string): string | null {
  const value = raw.trim();
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
}

function parseAmountAndUnit(record: CsvRecord): { amount: number; unit: string } {
  const rawAmount = first(record, ['amount', 'serving amount']);
  const explicitUnit = first(record, ['unit', 'serving unit']);
  const amount = Number.parseFloat(rawAmount.replace(/[^0-9+\-.]/g, ''));
  const embeddedUnit = rawAmount.replace(/^[\s+\-0-9.,/]+/, '').trim();

  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
    unit: explicitUnit || embeddedUnit || 'serving',
  };
}

export function parseCronometerCsv(text: string): { rows: CronometerRow[]; invalid: number } {
  const records = recordsFromCsv(text);
  const rows: CronometerRow[] = [];
  let invalid = 0;

  records.forEach((record, index) => {
    const date = parseDateKey(first(record, ['day', 'date']));
    const foodName = first(record, ['food name', 'food', 'description']);
    if (!date || !foodName) {
      invalid += 1;
      return;
    }

    const { amount, unit } = parseAmountAndUnit(record);
    rows.push({
      date,
      time: first(record, ['time', 'timestamp']) || null,
      group: first(record, ['group', 'diary group']),
      foodName,
      amount,
      unit,
      calories: numberValue(record, ['energy (kcal)', 'calories', 'energy kcal']),
      protein: numberValue(record, ['protein (g)', 'protein']),
      carbs: numberValue(record, ['carbs (g)', 'carbohydrates (g)', 'net carbs (g)', 'carbs']),
      fat: numberValue(record, ['fat (g)', 'total fat (g)', 'fat']),
      rowNumber: index + 2,
    });
  });

  return { rows, invalid };
}

function normalizeTime(raw: string | null): { hours: number; minutes: number } {
  if (!raw) return { hours: 12, minutes: 0 };
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!match) return { hours: 12, minutes: 0 };

  let hours = Number(match[1]);
  const minutes = Math.min(59, Number(match[2]));
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return { hours: Math.min(23, hours), minutes };
}

export function cronometerLoggedAt(row: CronometerRow): string {
  const [year, month, day] = row.date.split('-').map(Number);
  const { hours, minutes } = normalizeTime(row.time);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function canonicalRow(row: CronometerRow): string {
  return [
    row.date,
    row.time || '',
    row.group.trim().toLowerCase(),
    row.foodName.trim().toLowerCase(),
    row.amount,
    row.unit.trim().toLowerCase(),
    row.calories,
    row.protein,
    row.carbs,
    row.fat,
  ].join('|');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildCronometerIdentities(rows: CronometerRow[]): Promise<Array<{ row: CronometerRow; rowId: string; foodId: string }>> {
  const occurrences = new Map<string, number>();
  return Promise.all(rows.map(async (row) => {
    const canonical = canonicalRow(row);
    const occurrence = (occurrences.get(canonical) || 0) + 1;
    occurrences.set(canonical, occurrence);
    return {
      row,
      rowId: await sha256(`${canonical}|occurrence:${occurrence}`),
      foodId: await sha256([
        row.foodName.trim().toLowerCase(), row.amount, row.unit.trim().toLowerCase(),
        row.calories, row.protein, row.carbs, row.fat,
      ].join('|')),
    };
  }));
}

async function chunks<T>(values: T[], size = 200): Promise<T[][]> {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function ensureGroups(
  client: SupabaseClient,
  userId: string,
  rows: CronometerRow[],
): Promise<NutritionGroup[]> {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (dates.length === 0) return [];

  const { data } = await client
    .from('nutrition_groups')
    .select('*')
    .eq('user_id', userId)
    .gte('date', dates[0])
    .lte('date', dates[dates.length - 1]);
  const groups = (data || []) as NutritionGroup[];

  for (const date of dates) {
    const destinations = rows
      .filter((row) => row.date === date)
      .map((row) => cronometerGroupDestination(row.group))
      .filter((destination) => destination !== null);

    for (const destination of destinations) {
      const currentForDate = sortNutritionGroups(groups.filter((group) => group.date === date));
      if (destination.label) {
        if (currentForDate.some((group) => group.label === destination.label)) continue;
        const { data: inserted } = await client.from('nutrition_groups').insert({
          user_id: userId,
          date,
          kind: destination.kind,
          label: destination.label,
          sort_order: currentForDate.length,
        }).select('*').single();
        if (inserted) groups.push(inserted as NutritionGroup);
        continue;
      }

      const requestedOrdinal = destination.ordinal || 1;
      let currentNumbered = currentForDate.filter((group) => group.kind === destination.kind && group.label === null);
      while (currentNumbered.length < requestedOrdinal) {
        const { data: inserted } = await client.from('nutrition_groups').insert({
          user_id: userId,
          date,
          kind: destination.kind,
          label: null,
          sort_order: groups.filter((group) => group.date === date).length,
        }).select('*').single();
        if (!inserted) break;
        groups.push(inserted as NutritionGroup);
        currentNumbered = sortNutritionGroups(groups.filter((group) => (
          group.date === date && group.kind === destination.kind && group.label === null
        )));
      }
    }
  }

  return groups;
}

function destinationGroup(row: CronometerRow, groups: NutritionGroup[]): NutritionGroup | null {
  const destination = cronometerGroupDestination(row.group);
  if (!destination) return null;
  const dateGroups = sortNutritionGroups(groups.filter((group) => group.date === row.date));
  if (destination.label) return dateGroups.find((group) => group.label === destination.label) || null;
  return dateGroups.filter((group) => group.kind === destination.kind && group.label === null)[(destination.ordinal || 1) - 1] || null;
}

export async function importCronometerCsv(
  client: SupabaseClient,
  userId: string,
  fileName: string,
  text: string,
): Promise<CronometerImportSummary> {
  const parsed = parseCronometerCsv(text);
  if (parsed.rows.length === 0) throw new Error('No valid Cronometer serving rows were found. Export the Servings CSV, not the daily summary.');

  const fileHash = await sha256(text);
  const { data: existingBatch } = await client
    .from('nutrition_import_batches')
    .select('*')
    .eq('user_id', userId)
    .eq('source', 'cronometer')
    .eq('file_hash', fileHash)
    .maybeSingle();

  if (existingBatch) {
    const batch = existingBatch as { row_count: number; imported_count: number; skipped_count: number };
    return {
      rows: batch.row_count,
      imported: 0,
      skipped: batch.row_count,
      invalid: parsed.invalid,
      alreadyImportedFile: true,
    };
  }

  const identities = await buildCronometerIdentities(parsed.rows);
  const existingLogIds = new Set<string>();
  for (const part of await chunks(identities.map((item) => item.rowId))) {
    const { data } = await client.from('nutrition_logs')
      .select('external_id')
      .eq('user_id', userId)
      .eq('source', 'cronometer_csv')
      .in('external_id', part);
    for (const row of (data || []) as Array<{ external_id: string | null }>) {
      if (row.external_id) existingLogIds.add(row.external_id);
    }
  }

  const pending = identities.filter((item) => !existingLogIds.has(item.rowId));
  const { data: batch, error: batchError } = await client.from('nutrition_import_batches').insert({
    user_id: userId,
    source: 'cronometer',
    file_name: fileName,
    file_hash: fileHash,
    row_count: parsed.rows.length,
    imported_count: 0,
    skipped_count: parsed.rows.length - pending.length,
  }).select('id').single();
  if (batchError || !batch) throw new Error('Could not create the Cronometer import record.');
  const batchId = (batch as { id: string }).id;

  try {
    const foodMap = new Map<string, string>();
    const uniqueFoodIds = [...new Set(pending.map((item) => item.foodId))];
    for (const part of await chunks(uniqueFoodIds)) {
      const { data } = await client.from('foods')
        .select('id, external_id')
        .eq('user_id', userId)
        .eq('external_source', 'cronometer')
        .in('external_id', part);
      for (const food of (data || []) as Array<{ id: string; external_id: string | null }>) {
        if (food.external_id) foodMap.set(food.external_id, food.id);
      }
    }

    const missingFoods = [...new Map(pending.filter((item) => !foodMap.has(item.foodId)).map((item) => [item.foodId, item])).values()];
    if (missingFoods.length > 0) {
      const { data, error } = await client.from('foods').insert(missingFoods.map(({ row, foodId }) => ({
        user_id: userId,
        name: row.foodName,
        calories: row.calories,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        serving_size: row.amount,
        serving_unit: row.unit,
        source: 'cronometer',
        external_source: 'cronometer',
        external_id: foodId,
      }))).select('id, external_id');
      if (error) throw new Error('Could not save foods from the Cronometer export.');
      for (const food of (data || []) as Array<{ id: string; external_id: string | null }>) {
        if (food.external_id) foodMap.set(food.external_id, food.id);
      }
    }

    const groups = await ensureGroups(client, userId, pending.map((item) => item.row));
    const logRows = pending.flatMap(({ row, rowId, foodId }, index) => {
      const resolvedFoodId = foodMap.get(foodId);
      if (!resolvedFoodId) return [];
      const group = destinationGroup(row, groups);
      return [{
        user_id: userId,
        date: row.date,
        logged_at: cronometerLoggedAt(row),
        food_id: resolvedFoodId,
        servings: 1,
        meal_type: group?.label || (group?.kind === 'snack' ? 'snack' : null),
        group_id: group?.id || null,
        sort_order: index,
        source: 'cronometer_csv',
        external_id: rowId,
        import_batch_id: batchId,
      }];
    });

    if (logRows.length > 0) {
      const { error } = await client.from('nutrition_logs').insert(logRows);
      if (error) throw new Error('Could not save Cronometer nutrition entries.');
    }

    await client.from('nutrition_import_batches').update({
      imported_count: logRows.length,
      skipped_count: parsed.rows.length - logRows.length,
    }).eq('id', batchId).eq('user_id', userId);

    return {
      rows: parsed.rows.length,
      imported: logRows.length,
      skipped: parsed.rows.length - logRows.length,
      invalid: parsed.invalid,
      alreadyImportedFile: false,
    };
  } catch (error) {
    // A failed batch must remain retryable. Foods/groups already created are safe to reuse.
    await client.from('nutrition_import_batches').delete().eq('id', batchId).eq('user_id', userId);
    throw error;
  }
}
