import { describe, expect, it } from 'vitest';

import { trainingWeekRange } from '@/lib/weeklyVolume';
import type { PlanSchedule } from '@/lib/planSchedule';
import type { HeroState } from '@/lib/todayModel';
import type { Split } from '@/types';
import {
  CLOCK_SLACK_MS,
  LAUNCH_SNAPSHOT_VERSION,
  MAX_AGE_MS,
  backendOf,
  heroFromSeed,
  planBasis,
  planLaunchRestore,
  readEnvelope,
  seedHero,
  serializeEnvelope,
  stableWeek,
  type Envelope,
  type Part,
  type TodaySeed,
} from '../native/src/lib/launchSnapshot';

const USER = 'user-1';
const BACKEND = 'hyper-test.invalid';
const BUILD = '2.0.0+42';
// Wednesday 4 November 2026, early afternoon (local time).
const NOW = new Date(2026, 10, 4, 13, 0, 0);
const DAY = '2026-11-04';
const ctx = { backend: BACKEND, build: BUILD, now: NOW };

function envelope(part: Part, body: unknown, stamp: Record<string, unknown> = {}): Envelope {
  return {
    stamp: { v: LAUNCH_SNAPSHOT_VERSION, part, userId: USER, backend: BACKEND, build: BUILD, savedAt: NOW.getTime() - 60_000, ...stamp } as Envelope['stamp'],
    body,
  };
}
const raw = (part: Part, body: unknown, stamp: Record<string, unknown> = {}) => JSON.stringify(envelope(part, body, stamp));

function split(id: string, active: boolean, user = USER): Split {
  return {
    id,
    user_id: user,
    name: id,
    description: null,
    days_per_week: 4,
    is_active: active,
    days: [
      { id: `${id}-push`, split_id: id, day_name: 'Push', day_order: 0, exercises: [] },
      { id: `${id}-legs`, split_id: id, day_name: 'Legs', day_order: 1, exercises: [] },
    ],
  };
}
const program = (splits: unknown[] = [split('ppl', true), split('old', false)], workoutMode: unknown = 'split') => envelope('program', { splits, workoutMode });
const log = (id: string, date: string, calories: number, protein = 10, user = USER) => ({
  id, user_id: user, date, logged_at: null, food_id: `food-${id}`, servings: 1, food: { calories, protein, carbs: 5, fat: 2 },
});
const group = (id: string, date: string, user = USER) => ({ id, user_id: user, date, kind: 'meal', label: 'lunch', sort_order: 0 });
const totals = (calories: number, protein: number, carbs: number, fat: number) => ({ calories, protein, carbs, fat });
const target = (user = USER) => ({ id: 't1', user_id: user, calories: 2800, protein: 160, carbs: 350, fat: 80 });
const BASIS = planBasis({ activeSplit: split('ppl', true), schedule: null, adaptiveSchedulingEnabled: true });
const seed = (overrides: Partial<TodaySeed> = {}): TodaySeed => ({
  dayKey: DAY, splitId: 'ppl', mode: 'split', basis: BASIS, hero: { kind: 'planned', dayId: 'ppl-push' }, next: null, weekDone: 2, ...overrides,
});
const plan = (copies: Partial<Record<Part, Envelope>>, now = NOW) => planLaunchRestore(copies, USER, now);

describe('launch copy envelopes', () => {
  it.each([
    ['malformed JSON', '{"stamp":'],
    ['a body that is not an object', JSON.stringify({ stamp: envelope('today', {}).stamp, body: 5 })],
    ['a null body', JSON.stringify({ stamp: envelope('today', {}).stamp, body: null })],
    ['another version', raw('today', {}, { v: LAUNCH_SNAPSHOT_VERSION + 1 })],
    ['another part', raw('month', {})],
    ['another build', raw('today', {}, { build: '2.0.0+41' })],
    ['an empty user id', raw('today', {}, { userId: '' })],
    ['a copy older than 30 days', raw('today', {}, { savedAt: NOW.getTime() - MAX_AGE_MS - 1 })],
    ['a copy more than 5 minutes in the future', raw('today', {}, { savedAt: NOW.getTime() + CLOCK_SLACK_MS + 1 })],
  ])('drops and removes %s', (_name, value) => {
    expect(readEnvelope(value, 'today', ctx)).toEqual({ envelope: null, remove: true });
  });

  it('ignores without removing another backend’s copy and a missing key', () => {
    expect(readEnvelope(raw('today', {}, { backend: 'other.example' }), 'today', ctx)).toEqual({ envelope: null, remove: false });
    expect(readEnvelope(null, 'today', ctx)).toEqual({ envelope: null, remove: false });
  });

  it('accepts a copy saved exactly at the clock slack', () => {
    const value = raw('today', { dayKey: DAY }, { savedAt: NOW.getTime() + CLOCK_SLACK_MS });
    expect(readEnvelope(value, 'today', ctx).envelope?.body).toEqual({ dayKey: DAY });
  });
});

describe('program, quick starts, volume and targets', () => {
  it('keeps the active split by the same rule as fetchSplits', () => {
    const restored = plan({ program: program() });
    expect(restored.program?.activeSplit?.id).toBe('ppl');
    expect(restored.program?.activeSplit).toBe(restored.program?.splits[0]);
    expect(plan({ program: program([split('a', false)]) }).program?.activeSplit).toBeNull();
  });

  it('drops a program with another account’s split, a broken shape or an unknown mode', () => {
    expect(plan({ program: program([split('ppl', true), split('x', false, 'user-2')]) }).program).toBeNull();
    expect(plan({ program: program([{ ...split('ppl', true), days: [{ id: 'd' }] }]) }).program).toBeNull();
    expect(plan({ program: program(undefined, 'circuit') }).program).toBeNull();
  });

  it('keeps quick starts owned by the account', () => {
    const templates = [{ id: 'q1', user_id: USER, label: 'Arms', items: [] }];
    expect(plan({ templates: envelope('templates', { templates }) }).templates).toEqual(templates);
    expect(plan({ templates: envelope('templates', { templates: [{ ...templates[0], user_id: 'user-2' }] }) }).templates).toBeNull();
    expect(plan({ templates: envelope('templates', { templates: [{ id: 'q1', user_id: USER, items: [] }] }) }).templates).toBeNull();
  });

  it('keeps volume only within the same training week', () => {
    const body = (weekStart: string) => ({ weekStart, weeklyVolume: [{ muscle_group: 'chest', weekly_sets: 8, status: 'mav' }], volumeLandmarks: [] });
    expect(plan({ volume: envelope('volume', body(trainingWeekRange(NOW).weekStart)) }).volume?.weeklyVolume).toHaveLength(1);
    const sunday = new Date(2026, 10, 8, 23, 59);
    const monday = new Date(2026, 10, 9, 0, 1);
    const copy = envelope('volume', body(trainingWeekRange(sunday).weekStart), { savedAt: sunday.getTime() });
    expect(plan({ volume: copy }, sunday).volume).not.toBeNull();
    expect(plan({ volume: copy }, monday).volume).toBeNull();
    expect(plan({ volume: envelope('volume', { ...body(trainingWeekRange(NOW).weekStart), volumeLandmarks: [{ id: 'l', user_id: 'user-2' }] }) }).volume).toBeNull();
  });

  it('names a week only once a read could not have counted the last one', () => {
    expect(stableWeek(new Date(2026, 10, 9, 0, 0, 30))).toBeNull();
    expect(stableWeek(new Date(2026, 10, 9, 0, 1, 1))).toBe('2026-11-09');
    expect(stableWeek(NOW)).toBe('2026-11-02');
  });

  it('keeps an owned target or profile, and an empty one, and drops another account’s', () => {
    const today = envelope('today', { dayKey: DAY, totals: totals(0, 0, 0, 0) });
    expect(plan({ today, target: envelope('target', { value: target() }) }).target).toEqual({ value: target() });
    expect(plan({ today, target: envelope('target', { value: null }) }).target).toEqual({ value: null });
    expect(plan({ today, target: envelope('target', { value: target('user-2') }) }).target).toBeNull();
    expect(plan({ today, target: envelope('target', { value: { ...target(), calories: 'lots' } }) }).target).toBeNull();
    const profile = { user_id: USER, goal: 'lean_bulk' };
    expect(plan({ profile: envelope('profile', { value: profile }) }).profile).toEqual({ value: profile });
    expect(plan({ profile: envelope('profile', { value: null }) }).profile).toEqual({ value: null });
    expect(plan({ profile: envelope('profile', { value: { ...profile, user_id: 'user-2' } }) }).profile).toBeNull();
  });
});

describe('today’s figures', () => {
  const today = (dayKey: string, figures = totals(860, 52, 10, 4)) => envelope('today', { dayKey, totals: figures });

  it('uses the copy’s totals for today, zeros for an earlier day and nothing for a later one', () => {
    expect(plan({ today: today(DAY) }).fuel).toMatchObject({ todayKey: DAY, totals: totals(860, 52, 10, 4) });
    expect(plan({ today: today('2026-11-03') }).fuel).toMatchObject({ todayKey: DAY, totals: totals(0, 0, 0, 0) });
    expect(plan({ today: today('2026-11-05') }).fuel).toBeNull();
    expect(plan({ today: envelope('today', { dayKey: 'yesterday', totals: totals(1, 1, 1, 1) }) }).fuel).toBeNull();
  });

  it('brings the target back only with today’s figures, while the profile stands alone', () => {
    const restored = plan({
      today: today('2026-11-05'),
      target: envelope('target', { value: target() }),
      profile: envelope('profile', { value: { user_id: USER } }),
    });
    expect(restored.fuel).toBeNull();
    expect(restored.target).toBeNull();
    expect(restored.profile).toEqual({ value: { user_id: USER } });
  });

  it('keeps this month only when its rows are the account’s, in the month, and agree with today', () => {
    const logs = [log('a', DAY, 500, 30), log('b', DAY, 360, 22), log('c', '2026-11-01', 900)];
    const month = (body: Record<string, unknown>) => envelope('month', { month: '2026-11', logs, groups: [group('g1', DAY)], ...body });
    const figures = totals(860, 52, 10, 4);
    expect(plan({ today: today(DAY, figures), month: month({}) }).fuel?.month?.logs).toHaveLength(3);
    expect(plan({ today: today(DAY, figures), month: month({ month: '2026-10' }) }).fuel?.month).toBeNull();
    expect(plan({ today: today(DAY, figures), month: month({ logs: [...logs, log('d', '2026-10-31', 1)] }) }).fuel?.month).toBeNull();
    expect(plan({ today: today(DAY, figures), month: month({ groups: [group('g2', DAY, 'user-2')] }) }).fuel?.month).toBeNull();
    // A month that disagrees with today's figures is dropped; the figures stay.
    const disagreeing = plan({ today: today(DAY, totals(1000, 52, 10, 4)), month: month({}) });
    expect(disagreeing.fuel).toMatchObject({ totals: totals(1000, 52, 10, 4), month: null });
    // Yesterday's copy of this month has nothing for today, so it agrees with zeros.
    const fromYesterday = envelope('month', { month: '2026-11', logs: [log('c', '2026-11-01', 900)], groups: [] });
    expect(plan({ today: today('2026-11-03'), month: fromYesterday }).fuel?.month?.logs).toHaveLength(1);
  });
});

describe('the workout and the plan card', () => {
  const training = (workout: unknown, today: unknown = null) => envelope('training', { workout, today });

  it('holds the plan for a live workout and never seeds over it', () => {
    const live = { id: 'w1', created_at: new Date(NOW.getTime() - 3_600_000).toISOString(), date: DAY };
    const restored = plan({ program: program(), training: training(live, seed()) });
    expect(restored).toMatchObject({ holdPlan: true, seed: null });
  });

  it('does not hold for a workout too old to resume', () => {
    const old = { id: 'w1', created_at: new Date(NOW.getTime() - 30 * 3_600_000).toISOString(), date: '2026-11-03' };
    expect(plan({ program: program(), training: training(old) }).holdPlan).toBe(false);
  });

  it('holds when the program came back but the copy says nothing about the workout', () => {
    expect(plan({ program: program() }).holdPlan).toBe(true);
    expect(plan({ program: program(), training: envelope('training', { workout: { id: 5 }, today: null }) }).holdPlan).toBe(true);
    expect(plan({}).holdPlan).toBe(false);
  });

  it('seeds only today’s plan, and only when no workout was live', () => {
    expect(plan({ program: program(), training: training(null, seed()) })).toMatchObject({ holdPlan: false, seed: seed() });
    expect(plan({ program: program(), training: training(null, seed({ dayKey: '2026-11-03' })) }).seed).toBeNull();
    expect(plan({ training: training(null, seed()) }).seed).toBeNull();
    expect(plan({ program: program(), training: training(null, { ...seed(), hero: { kind: 'resume' } }) }).seed).toBeNull();
    // A seed saved without what it was decided from is not a seed.
    const unbased: Partial<TodaySeed> = seed();
    delete unbased.basis;
    expect(plan({ program: program(), training: training(null, unbased) }).seed).toBeNull();
  });

  it('restores nothing when any part belongs to another account', () => {
    const restored = plan({
      program: program(),
      today: envelope('today', { dayKey: DAY, totals: totals(1, 1, 1, 1) }),
      profile: envelope('profile', { value: null }, { userId: 'user-2' }),
    });
    expect(restored).toEqual({
      foreign: true, program: null, templates: null, volume: null, target: null, profile: null, fuel: null, holdPlan: false, seed: null,
    });
  });
});

describe('launch copy helpers', () => {
  const ppl = split('ppl', true);

  it('keeps only stable heroes', () => {
    expect(seedHero({ kind: 'planned', day: ppl.days[0] })).toEqual({ kind: 'planned', dayId: 'ppl-push' });
    expect(seedHero({ kind: 'done', title: 'Push' })).toEqual({ kind: 'done', title: 'Push' });
    for (const kind of ['rest', 'no-schedule', 'flexible', 'first-run'] as const) expect(seedHero({ kind })).toEqual({ kind });
    expect(seedHero({ kind: 'loading' })).toBeNull();
    expect(seedHero({ kind: 'schedule-error', retry: () => {} })).toBeNull();
    expect(seedHero({ kind: 'resume' } as HeroState)).toBeNull();
  });

  it('draws a seeded planned day from the live program, and only for the same day, program and mode', () => {
    const live = { dayKey: DAY, activeSplit: ppl, workoutMode: 'split' as const, basis: BASIS };
    const hero = heroFromSeed(seed(), live);
    expect(hero).toEqual({ kind: 'planned', day: ppl.days[0] });
    expect(hero?.kind === 'planned' && hero.day).toBe(ppl.days[0]);
    expect(heroFromSeed(seed({ hero: { kind: 'planned', dayId: 'gone' } }), live)).toBeNull();
    expect(heroFromSeed(seed({ splitId: 'other' }), live)).toBeNull();
    expect(heroFromSeed(seed({ mode: 'flexible' }), live)).toBeNull();
    expect(heroFromSeed(seed({ dayKey: '2026-11-03' }), live)).toBeNull();
    expect(heroFromSeed(seed({ hero: { kind: 'rest' } }), live)).toEqual({ kind: 'rest' });
    expect(heroFromSeed(null, live)).toBeNull();
  });

  it('draws a seed only while the schedule, the program’s days and adaptive scheduling are as decided', () => {
    const schedule: PlanSchedule = {
      splitId: 'ppl', startDate: '2026-11-02', mode: 'fixed', weekdays: [1, 3], anchorDay: 1, updatedAt: '2026-11-02T08:00:00.000Z',
    };
    const basis = planBasis({ activeSplit: ppl, schedule, adaptiveSchedulingEnabled: true });
    const live = (change: Partial<{ activeSplit: Split; schedule: PlanSchedule | null; adaptiveSchedulingEnabled: boolean }> = {}) => {
      const input = { activeSplit: ppl, schedule, adaptiveSchedulingEnabled: true, ...change };
      return { dayKey: DAY, activeSplit: input.activeSplit, workoutMode: 'split' as const, basis: planBasis(input) };
    };
    const decided = seed({ basis });
    expect(heroFromSeed(decided, live())).toEqual({ kind: 'planned', day: ppl.days[0] });
    // The device copy read again at the next cold start (a round trip through JSON) still matches.
    expect(heroFromSeed(decided, live({ schedule: JSON.parse(JSON.stringify(schedule)) as PlanSchedule }))).not.toBeNull();
    expect(heroFromSeed(decided, live({ schedule: null }))).toBeNull();
    expect(heroFromSeed(decided, live({ schedule: { ...schedule, weekdays: [2, 4] } }))).toBeNull();
    // A save with the same choices still decides again: its time changes which sessions count.
    expect(heroFromSeed(decided, live({ schedule: { ...schedule, updatedAt: '2026-11-04T09:00:00.000Z' } }))).toBeNull();
    expect(heroFromSeed(decided, live({ adaptiveSchedulingEnabled: false }))).toBeNull();
    expect(heroFromSeed(decided, live({ activeSplit: { ...ppl, days: [...ppl.days].reverse() } }))).toBeNull();
    expect(heroFromSeed(decided, live({ activeSplit: { ...ppl, days: ppl.days.slice(0, 1) } }))).toBeNull();
    // A program edit that keeps its days (sets, reps, movements) keeps the seed, drawn from the live day.
    const edited = { ...ppl, days: ppl.days.map((day) => ({ ...day, day_name: `${day.day_name} A` })) };
    const hero = heroFromSeed(decided, live({ activeSplit: edited }));
    expect(hero?.kind === 'planned' && hero.day).toBe(edited.days[0]);
  });

  it('refuses an envelope over the limit and dedups without the time', () => {
    const stamp = envelope('today', null).stamp;
    expect(serializeEnvelope(stamp, { text: 'x'.repeat(100) }, 50)).toBeNull();
    const first = serializeEnvelope(stamp, { a: 1 }, 1_000);
    const later = serializeEnvelope({ ...stamp, savedAt: stamp.savedAt + 5_000 }, { a: 1 }, 1_000);
    expect(first?.body).toBe(later?.body);
    expect(first?.json).not.toBe(later?.json);
    expect(JSON.parse(first!.json)).toEqual({ stamp, body: { a: 1 } });
  });

  it('names the backend by its host', () => {
    expect(backendOf('https://abc.supabase.co')).toBe('abc.supabase.co');
    expect(backendOf('http://127.0.0.1:54321/rest/v1')).toBe('127.0.0.1:54321');
    expect(backendOf('HTTPS://Example.COM/path?x=1')).toBe('example.com');
    expect(backendOf('')).toBe('');
    expect(backendOf(undefined)).toBe('');
  });
});
