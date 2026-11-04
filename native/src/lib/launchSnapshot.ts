// The rules a saved part of the launch copy (launchCache.ts) must pass before a
// cold start may draw it. Pure: no React Native, no stores.
import { format } from 'date-fns';

import { sumMacros, type MacroTotals } from '@/lib/nutritionMacros';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import type { PlanSchedule } from '@/lib/planSchedule';
import type { HeroState } from '@/lib/todayModel';
import { todayKey } from '@/lib/todayRefresh';
import { trainingWeekRange } from '@/lib/weeklyVolume';
import { canResumeWorkout } from '@/lib/workoutSessions';
import type { FlexDayTemplate, MacroTarget, MuscleVolume, NutritionGroup, Split, VolumeLandmark, WorkoutMode } from '@/types';

import type { FoodLog } from './fuel';

/** Bump when a kept shape changes in a way a screen reads (blanc-native skill). Each new build also drops the copy. */
export const LAUNCH_SNAPSHOT_VERSION = 1;
export const PARTS = ['program', 'templates', 'volume', 'target', 'profile', 'today', 'month', 'training'] as const;
export type Part = (typeof PARTS)[number];
export const partKey = (part: Part) => `hyper-launch:${part}`;
/** The longest saved envelope per part, in characters; a bigger one is removed instead of saved. */
export const PART_LIMIT: Record<Part, number> = {
  program: 1_000_000,
  month: 1_000_000,
  templates: 200_000,
  volume: 200_000,
  target: 20_000,
  profile: 20_000,
  today: 2_000,
  training: 20_000,
};
export const MAX_AGE_MS = 30 * 86_400_000;
export const CLOCK_SLACK_MS = 5 * 60_000;
/** A volume read lands at most this long after it chose its week (token refresh plus one request deadline). */
export const VOLUME_WEEK_MARGIN_MS = 60_000;

export type Stamp = { v: number; part: Part; userId: string; backend: string; build: string; savedAt: number };
export type Envelope<T = unknown> = { stamp: Stamp; body: T };
export type ProgramBody = { splits: Split[]; workoutMode: WorkoutMode };
export type TemplatesBody = { templates: FlexDayTemplate[] };
export type VolumeBody = { weekStart: string; weeklyVolume: MuscleVolume[]; volumeLandmarks: VolumeLandmark[] };
export type TargetBody = { value: MacroTarget | null };
export type ProfileBody = { value: NutritionProfile | null };
export type TodayBody = { dayKey: string; totals: MacroTotals };
/** `dayKey`: the today part's day when this month was saved beside it. */
export type MonthBody = { month: string; dayKey: string; logs: FoodLog[]; groups: NutritionGroup[] };
export type SeedHero =
  | { kind: 'planned'; dayId: string }
  | { kind: 'done'; title: string }
  | { kind: 'rest' | 'no-schedule' | 'flexible' | 'first-run' };
export type TodaySeed = {
  dayKey: string;
  splitId: string | null;
  mode: WorkoutMode;
  /** planBasis: what else the hero was decided from. */
  basis: string;
  hero: SeedHero;
  next: string | null;
  weekDone: number | null;
};
export type LiveMark = { id: string; created_at: string | null; date: string };
export type TrainingBody = { workout: LiveMark | null; today: TodaySeed | null };
export type LaunchRestore = {
  /** An envelope of another account: clear everything, restore nothing. */
  foreign: boolean;
  program: { splits: Split[]; activeSplit: Split | null; workoutMode: WorkoutMode } | null;
  templates: FlexDayTemplate[] | null;
  volume: { weeklyVolume: MuscleVolume[]; volumeLandmarks: VolumeLandmark[] } | null;
  target: TargetBody | null;
  profile: ProfileBody | null;
  fuel: { todayKey: string; totals: MacroTotals; month: MonthBody | null } | null;
  /** The plan card waits for this launch's workout read. */
  holdPlan: boolean;
  seed: TodaySeed | null;
};

/** The backend's host (and port), so a copy made against one server is never shown against another. */
export const backendOf = (url: string | undefined) => /^https?:\/\/([^/?#]+)/i.exec(url ?? '')?.[1].toLowerCase() ?? '';

export function readEnvelope(
  raw: string | null,
  part: Part,
  ctx: { backend: string; build: string; now: Date },
): { envelope: Envelope | null; remove: boolean } {
  if (raw === null) return { envelope: null, remove: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { envelope: null, remove: true };
  }
  const stamp = (value as Partial<Envelope> | null)?.stamp as Partial<Stamp> | undefined;
  const body = (value as Partial<Envelope> | null)?.body;
  if (!stamp || typeof stamp !== 'object' || body === null || typeof body !== 'object') return { envelope: null, remove: true };
  // Another backend's copy (a build pointed at a test server): not ours to show or remove.
  if (stamp.backend !== ctx.backend) return { envelope: null, remove: false };
  const now = ctx.now.getTime();
  const ok = stamp.v === LAUNCH_SNAPSHOT_VERSION && stamp.part === part && stamp.build === ctx.build
    && typeof stamp.userId === 'string' && stamp.userId !== ''
    && typeof stamp.savedAt === 'number' && Number.isFinite(stamp.savedAt)
    && stamp.savedAt <= now + CLOCK_SLACK_MS && now - stamp.savedAt <= MAX_AGE_MS;
  return ok ? { envelope: value as Envelope, remove: false } : { envelope: null, remove: true };
}

type Row = Record<string, unknown>;
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isMode = (value: unknown): value is WorkoutMode => value === 'split' || value === 'flexible';
const owned = (rows: unknown, userId: string): rows is Row[] =>
  Array.isArray(rows) && rows.every((row) => isObject(row) && row.user_id === userId);
const isTotals = (value: unknown): value is MacroTotals =>
  isObject(value) && finite(value.calories) && finite(value.protein) && finite(value.carbs) && finite(value.fat);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ZERO: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const PLAIN_HEROES = new Set(['rest', 'no-schedule', 'flexible', 'first-run']);

function programOf(body: unknown, userId: string): LaunchRestore['program'] {
  if (!isObject(body) || !isMode(body.workoutMode) || !owned(body.splits, userId)) return null;
  const shaped = body.splits.every((split) => typeof split.id === 'string' && Array.isArray(split.days)
    && split.days.every((day) => isObject(day) && typeof day.id === 'string' && Array.isArray(day.exercises)));
  if (!shaped) return null;
  const splits = body.splits as unknown as Split[];
  // The same rule as fetchSplits.
  return { splits, activeSplit: splits.find((split) => split.is_active) ?? null, workoutMode: body.workoutMode };
}

function templatesOf(body: unknown, userId: string): FlexDayTemplate[] | null {
  if (!isObject(body) || !owned(body.templates, userId)) return null;
  const shaped = body.templates.every((template) => typeof template.id === 'string'
    && typeof template.label === 'string' && Array.isArray(template.items));
  return shaped ? (body.templates as unknown as FlexDayTemplate[]) : null;
}

function volumeOf(body: unknown, userId: string, now: Date): LaunchRestore['volume'] {
  if (!isObject(body) || body.weekStart !== trainingWeekRange(now).weekStart) return null;
  if (!Array.isArray(body.weeklyVolume) || !body.weeklyVolume.every(isObject) || !owned(body.volumeLandmarks, userId)) return null;
  return {
    weeklyVolume: body.weeklyVolume as unknown as MuscleVolume[],
    volumeLandmarks: body.volumeLandmarks as unknown as VolumeLandmark[],
  };
}

function ownedValueOf<T>(body: unknown, userId: string, shaped: (value: Row) => boolean = () => true): { value: T | null } | null {
  if (!isObject(body) || !('value' in body)) return null;
  if (body.value === null) return { value: null };
  if (!isObject(body.value) || body.value.user_id !== userId || !shaped(body.value)) return null;
  return { value: body.value as unknown as T };
}

function isSeedHero(value: unknown): value is SeedHero {
  if (!isObject(value)) return false;
  if (value.kind === 'planned') return typeof value.dayId === 'string';
  if (value.kind === 'done') return typeof value.title === 'string';
  return typeof value.kind === 'string' && PLAIN_HEROES.has(value.kind);
}

function isSeed(value: unknown): value is TodaySeed {
  return isObject(value)
    && typeof value.dayKey === 'string'
    && (value.splitId === null || typeof value.splitId === 'string')
    && isMode(value.mode)
    && typeof value.basis === 'string'
    && isSeedHero(value.hero)
    && (value.next === null || typeof value.next === 'string')
    && (value.weekDone === null || finite(value.weekDone));
}

function trainingOf(body: unknown): TrainingBody | null {
  if (!isObject(body)) return null;
  const workout = body.workout;
  const markOk = workout === null || (isObject(workout) && typeof workout.id === 'string'
    && (workout.created_at === null || typeof workout.created_at === 'string') && typeof workout.date === 'string');
  if (!markOk || !(body.today === null || isSeed(body.today))) return null;
  return body as unknown as TrainingBody;
}

const nothing: LaunchRestore = {
  foreign: false, program: null, templates: null, volume: null, target: null, profile: null, fuel: null, holdPlan: false, seed: null,
};

/** What a cold start may draw from the saved parts, each checked on its own against the day it describes. */
export function planLaunchRestore(copies: Partial<Record<Part, Envelope>>, userId: string, now: Date): LaunchRestore {
  if (Object.values(copies).some((copy) => copy && copy.stamp.userId !== userId)) return { ...nothing, foreign: true };

  const program = programOf(copies.program?.body, userId);
  const templates = templatesOf(copies.templates?.body, userId);
  const volume = volumeOf(copies.volume?.body, userId, now);
  const target = ownedValueOf<MacroTarget>(copies.target?.body, userId,
    (value) => finite(value.calories) && finite(value.protein) && finite(value.carbs) && finite(value.fat));
  const profile = ownedValueOf<NutritionProfile>(copies.profile?.body, userId);

  // Today's figures: the copy's own for today, zeros for an earlier day (nothing
  // can be logged for a day before it starts), unknown for a later one.
  const key = todayKey(now);
  const today = copies.today?.body;
  let fuel: LaunchRestore['fuel'] = null;
  if (isObject(today) && typeof today.dayKey === 'string' && DAY_KEY.test(today.dayKey) && isTotals(today.totals)) {
    const totals = today.dayKey === key ? today.totals : today.dayKey < key ? { ...ZERO } : null;
    const saved = { dayKey: today.dayKey, totals: today.totals };
    if (totals) fuel = { todayKey: key, totals, month: monthOf(copies.month?.body, userId, now, saved, { dayKey: key, totals }) };
  }

  const training = trainingOf(copies.training?.body);
  const live = Boolean(training?.workout && canResumeWorkout({
    completed: false,
    created_at: training.workout.created_at ?? undefined,
    date: training.workout.date,
  }, now));

  return {
    foreign: false,
    program,
    templates,
    volume,
    // Today's kcal left is the target minus what was eaten: the target comes back only with today's food.
    target: fuel ? target : null,
    profile,
    fuel,
    holdPlan: Boolean(program) && (!training || live),
    seed: program && training && training.workout === null && training.today?.dayKey === key ? training.today : null,
  };
}

/**
 * This month, only beside the today part it was saved with (the same day and
 * figures: a month left behind while Fuel showed another month is not), and
 * in step with today's figures now, or Fuel and Today would disagree.
 */
function monthOf(body: unknown, userId: string, now: Date, saved: TodayBody, current: TodayBody): MonthBody | null {
  const month = format(now, 'yyyy-MM');
  if (!isObject(body) || body.month !== month || body.dayKey !== saved.dayKey) return null;
  const inMonth = (rows: Row[]) => rows.every((row) => typeof row.date === 'string' && row.date.startsWith(`${month}-`));
  if (!owned(body.logs, userId) || !inMonth(body.logs) || !owned(body.groups, userId) || !inMonth(body.groups)) return null;
  const logs = body.logs as unknown as FoodLog[];
  if (!sameTotals(todayTotalsOf(logs, saved.dayKey), saved.totals)) return null;
  if (!sameTotals(todayTotalsOf(logs, current.dayKey), current.totals)) return null;
  return { month, dayKey: saved.dayKey, logs, groups: body.groups as unknown as NutritionGroup[] };
}

/** The part of today's hero worth keeping for the next cold start the same day. */
export function seedHero(hero: HeroState): SeedHero | null {
  switch (hero.kind) {
    case 'planned':
      return { kind: 'planned', dayId: hero.day.id };
    case 'done':
      return { kind: 'done', title: hero.title };
    case 'rest':
    case 'no-schedule':
    case 'flexible':
    case 'first-run':
      return { kind: hero.kind };
    default:
      return null; // loading, schedule-error and resume are never kept
  }
}

/**
 * What today's plan is decided from besides the day, program and mode: the
 * program's days in order, the saved schedule (its updatedAt too, which decides
 * the sessions that count) and adaptive scheduling. A seed stands in only while
 * these are unchanged, so after a schedule save, a change to the program's days
 * or a newer schedule from another device the plan card keeps its place until
 * it is decided again, never showing the decision from before.
 */
export function planBasis(input: { activeSplit: Split | null; schedule: PlanSchedule | null; adaptiveSchedulingEnabled: boolean }): string {
  const { activeSplit, schedule, adaptiveSchedulingEnabled } = input;
  return JSON.stringify([
    activeSplit?.days.map((day) => day.id) ?? null,
    // Field by field, so the device copy read at the next cold start matches.
    schedule
      ? [schedule.splitId, schedule.startDate, schedule.mode, schedule.weekdays, schedule.anchorDay ?? null, schedule.flexAnchorIndex ?? null, schedule.updatedAt ?? null]
      : null,
    adaptiveSchedulingEnabled,
  ]);
}

/** The kept hero, only for the same day, program, mode and basis, with the planned day taken from the live program. */
export function heroFromSeed(
  seed: TodaySeed | null,
  live: { dayKey: string; activeSplit: Split | null; workoutMode: WorkoutMode; basis: string },
): HeroState | null {
  if (!seed || seed.dayKey !== live.dayKey || seed.mode !== live.workoutMode || seed.splitId !== (live.activeSplit?.id ?? null)) return null;
  if (seed.basis !== live.basis) return null;
  const hero = seed.hero;
  if (hero.kind === 'planned') {
    const day = live.activeSplit?.days.find((candidate) => candidate.id === hero.dayId);
    return day ? { kind: 'planned', day } : null;
  }
  return hero.kind === 'done' ? { kind: 'done', title: hero.title } : { kind: hero.kind };
}

export function serializeEnvelope(stamp: Stamp, body: unknown, limit: number): { json: string; body: string } | null {
  const bodyJson = JSON.stringify(body);
  const json = `{"stamp":${JSON.stringify(stamp)},"body":${bodyJson}}`;
  return json.length <= limit ? { json, body: bodyJson } : null; // body: dedup without savedAt
}

/** This training week, unless a week began so recently that a read now landing may have counted the last one. */
export function stableWeek(now: Date): string | null {
  const { weekStart } = trainingWeekRange(now);
  return trainingWeekRange(new Date(now.getTime() - VOLUME_WEEK_MARGIN_MS)).weekStart === weekStart ? weekStart : null;
}

export const todayTotalsOf = (logs: readonly FoodLog[], key: string) => sumMacros(logs.filter((log) => log.date === key));
export const sameTotals = (a: MacroTotals, b: MacroTotals) =>
  a.calories === b.calories && a.protein === b.protein && a.carbs === b.carbs && a.fat === b.fat;
