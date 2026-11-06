import { format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clampReminderMinutes,
  FUEL_REMINDER_DAYS,
  fuelReminderId,
  fuelReminderNote,
  fuelShortfall,
  hasReminderTarget,
  isFuelReminderId,
  minutesOf,
  parseReminderHistory,
  parseReminderSettings,
  planFuelReminders,
  pruneReminderHistory,
  reminderCopy,
  reminderDay,
  reminderPermission,
  reminderSent,
  reminderTimeDate,
  type ReminderPlanInput,
} from '../native/src/lib/fuelReminderPlan';

// The fuel reminder's rules: well short is a quarter of the target or more
// still to go (calories only while gaining, protein on any goal), one
// calendar request a day for today and the next two, and never twice a day.

const totals = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0 });
const target = { calories: 2800, protein: 160 };
const base = {
  settings: { enabled: true, minutes: 1200 },
  target,
  goal: 'bulk' as const,
  history: {},
  pendingIds: new Set<string>(),
};
const plan = (now: Date, overrides: Partial<ReminderPlanInput> = {}) =>
  planFuelReminders({ ...base, now, day: format(now, 'yyyy-MM-dd'), totals: totals(1950, 120), ...overrides });
const HOUR = 60 * 60 * 1000;

function inZone(zone: string) {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TZ;
    process.env.TZ = zone;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

describe('fuelShortfall', () => {
  it('names calories and protein while bulking or lean bulking', () => {
    expect(fuelShortfall(totals(1950, 120), target, 'bulk')).toEqual({ kcal: 850, protein: 40 });
    expect(fuelShortfall(totals(1950, 120), target, 'lean_bulk')).toEqual({ kcal: 850, protein: 40 });
  });

  it.each(['cut', 'maintain', null] as const)('counts protein only on %s', (goal) => {
    expect(fuelShortfall(totals(1950, 120), target, goal)).toEqual({ kcal: null, protein: 40 });
  });

  it('starts at a quarter still to go, in whole numbers', () => {
    expect(fuelShortfall(totals(2100, 200), target, 'bulk')).toEqual({ kcal: 700, protein: null });
    expect(fuelShortfall(totals(2101, 200), target, 'bulk')).toBeNull();
    expect(fuelShortfall(totals(3000, 120), target, 'bulk')).toEqual({ kcal: null, protein: 40 });
    expect(fuelShortfall(totals(3000, 121), target, 'bulk')).toBeNull();
  });

  it('is nothing once targets are hit or passed', () => {
    expect(fuelShortfall(totals(3100, 200), target, 'bulk')).toBeNull();
    expect(fuelShortfall(totals(2800, 160), target, 'cut')).toBeNull();
  });

  it('uses Fuel’s 150 g when the saved protein is 0', () => {
    const noProtein = { calories: 2800, protein: 0 };
    expect(fuelShortfall(totals(3000, 112), noProtein, 'cut')).toEqual({ kcal: null, protein: 38 });
    expect(fuelShortfall(totals(3000, 113), noProtein, 'cut')).toBeNull();
  });
});

describe('reminderCopy', () => {
  it('names what is well short, in Fuel’s figures', () => {
    expect(reminderCopy(totals(1950, 120), { kcal: 850, protein: 40 })).toEqual({
      title: '850 kcal and 40 g protein to go',
      body: 'Still time for a good meal.',
    });
    const proteinHit = fuelShortfall(totals(1950, 170), target, 'bulk')!;
    expect(reminderCopy(totals(1950, 170), proteinHit)).toEqual({ title: '850 kcal to go', body: 'Still time for a good meal.' });
    const cut = fuelShortfall(totals(1950, 120), target, 'cut')!;
    expect(reminderCopy(totals(1950, 120), cut)).toEqual({ title: '40 g protein to go', body: 'Still time for some protein.' });
  });

  it('writes thousands as Fuel does', () => {
    const short = fuelShortfall(totals(100, 10), target, 'bulk')!;
    expect(reminderCopy(totals(100, 10), short).title).toBe('2,700 kcal and 150 g protein to go');
  });

  it('asks for a log when nothing is logged, rather than counting the whole target', () => {
    const short = fuelShortfall(totals(0, 0), target, 'bulk')!;
    expect(reminderCopy(totals(0, 0), short)).toEqual({
      title: 'Nothing logged today',
      body: 'Log what you’ve eaten to see what’s left.',
    });
  });
});

describe('planFuelReminders', () => {
  inZone('America/Los_Angeles');
  // Built inside each test, after the zone is set.
  let now: Date;
  beforeEach(() => {
    now = new Date(2026, 10, 4, 13, 0);
  });

  it('plans nothing when off or without a saved calorie target', () => {
    expect(plan(now, { settings: { enabled: false, minutes: 1200 } })).toEqual([]);
    expect(plan(now, { target: null })).toEqual([]);
    expect(plan(now, { target: { calories: 0, protein: 160 } })).toEqual([]);
  });

  it('keeps what iOS holds while a new day is still loading', () => {
    expect(plan(now, { day: '2026-11-03' })).toBeNull();
  });

  it('plans today and the next two days at the chosen wall-clock time', () => {
    const requests = plan(now)!;
    expect(requests.map((request) => request.id)).toEqual([
      'hyper-fuel-reminder-2026-11-04',
      'hyper-fuel-reminder-2026-11-05',
      'hyper-fuel-reminder-2026-11-06',
    ]);
    expect(requests.length).toBeLessThanOrEqual(FUEL_REMINDER_DAYS);
    expect(new Set(requests.map((request) => request.id)).size).toBe(requests.length);
    expect(requests[0]).toMatchObject({
      day: '2026-11-04',
      at: { year: 2026, month: 11, day: 4, hour: 20, minute: 0 },
      atMs: new Date(2026, 10, 4, 20, 0).getTime(),
      title: '850 kcal and 40 g protein to go',
      body: 'Still time for a good meal.',
    });
    expect(requests.slice(1).map((request) => request.title)).toEqual(['Nothing logged today', 'Nothing logged today']);
  });

  it('leaves today out once its time has come', () => {
    expect(plan(new Date(2026, 10, 4, 20, 0))!.map((request) => request.day)).toEqual(['2026-11-05', '2026-11-06']);
    expect(plan(new Date(2026, 10, 4, 19, 59))![0].day).toBe('2026-11-04');
    expect(plan(now, { settings: { enabled: true, minutes: 1290 } })![0].at).toMatchObject({ hour: 21, minute: 30 });
  });

  it('never plans a day twice once its reminder went out', () => {
    const at2000 = new Date(2026, 10, 4, 20, 0).getTime();
    const later = new Date(2026, 10, 4, 20, 1);
    const settings = { enabled: true, minutes: 1290 };
    expect(plan(later, { settings, history: { '2026-11-04': at2000 } })!.map((request) => request.day)).not.toContain('2026-11-04');
    // Still waiting in iOS (not yet fired): it is replaced.
    expect(plan(later, { settings, history: { '2026-11-04': at2000 }, pendingIds: new Set([fuelReminderId('2026-11-04')]) })![0].day)
      .toBe('2026-11-04');
    // Handed over for a time still ahead: not sent yet.
    const at2130 = new Date(2026, 10, 4, 21, 30).getTime();
    expect(plan(later, { settings, history: { '2026-11-04': at2130 } })![0].day).toBe('2026-11-04');
  });

  it('counts a future day that fired while the app was closed as sent', () => {
    const fired = { '2026-11-05': new Date(2026, 10, 5, 20, 0).getTime() };
    const next = plan(new Date(2026, 10, 5, 21, 0), { settings: { enabled: true, minutes: 1320 }, history: fired })!;
    expect(next.map((request) => request.day)).toEqual(['2026-11-06', '2026-11-07']);
  });

  it('counts a day sent before a flight west over the date line', () => {
    // Nov 4 20:00 in Auckland, handed over there.
    const history = { '2026-11-04': Date.UTC(2026, 10, 4, 7, 0) };
    const requests = plan(new Date(2026, 10, 4, 18, 0), { history })!;
    expect(requests.map((request) => request.day)).toEqual(['2026-11-05', '2026-11-06']);
  });

  it('skips a day that is hit and still reminds for the days ahead', () => {
    expect(plan(now, { totals: totals(2500, 150) })!.map((request) => request.day)).toEqual(['2026-11-05', '2026-11-06']);
    const cut = plan(now, { goal: 'cut', totals: totals(1200, 165) })!;
    expect(cut.map((request) => request.day)).toEqual(['2026-11-05', '2026-11-06']);
    expect(cut.map((request) => request.title)).toEqual(['Nothing logged today', 'Nothing logged today']);
  });

  it('counts months from 1 across month and year ends', () => {
    const requests = plan(new Date(2026, 11, 30, 10, 0))!;
    expect(requests.map((request) => request.day)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(requests.map((request) => request.at.month)).toEqual([12, 12, 1]);
    expect(requests[2].at.year).toBe(2027);
  });

  it('keeps the wall-clock time across the fall-back and spring-forward changes', () => {
    const fall = plan(new Date(2026, 9, 31, 10, 0))!;
    expect(fall.map((request) => request.day)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(fall.every((request) => request.at.hour === 20 && request.at.minute === 0)).toBe(true);
    expect(fall[1].atMs - fall[0].atMs).toBe(25 * HOUR);
    expect(fall[2].atMs - fall[1].atMs).toBe(24 * HOUR);
    const spring = plan(new Date(2026, 2, 7, 10, 0))!;
    expect(spring[1].atMs - spring[0].atMs).toBe(23 * HOUR);
  });
});

describe('planFuelReminders in London', () => {
  inZone('Europe/London');

  it('keeps the wall-clock time when the clocks go back', () => {
    const requests = plan(new Date(2026, 9, 24, 10, 0))!;
    expect(requests[1].day).toBe('2026-10-25');
    expect(requests[1].atMs - requests[0].atMs).toBe(25 * HOUR);
  });
});

describe('planFuelReminders by time zone', () => {
  const instant = new Date(Date.UTC(2026, 10, 4, 7, 30));

  describe('in Auckland', () => {
    inZone('Pacific/Auckland');
    it('reads the local day and time (Nov 4, 8:30 PM)', () => {
      const now = new Date(instant.getTime());
      expect(plan(now)!.map((request) => request.day)).toEqual(['2026-11-05', '2026-11-06']);
    });
  });

  describe('in Los Angeles', () => {
    inZone('America/Los_Angeles');
    it('reads the local day and time (Nov 3, 11:30 PM)', () => {
      const now = new Date(instant.getTime());
      expect(format(now, 'yyyy-MM-dd')).toBe('2026-11-03');
      expect(plan(now)!.map((request) => request.day)).toEqual(['2026-11-04', '2026-11-05']);
    });
  });
});

describe('reminder history', () => {
  inZone('America/Los_Angeles');
  let now: Date;
  beforeEach(() => {
    now = new Date(2026, 10, 4, 13, 0);
  });

  it('counts a day as sent only when handed over, due and no longer pending', () => {
    const due = new Date(2026, 10, 4, 12, 0).getTime();
    expect(reminderSent({ '2026-11-04': due }, '2026-11-04', now, new Set())).toBe(true);
    expect(reminderSent({}, '2026-11-04', now, new Set())).toBe(false);
    expect(reminderSent({ '2026-11-04': now.getTime() + 1 }, '2026-11-04', now, new Set())).toBe(false);
    expect(reminderSent({ '2026-11-04': due }, '2026-11-04', now, new Set([fuelReminderId('2026-11-04')]))).toBe(false);
  });

  it('keeps yesterday and later, oldest first', () => {
    const pruned = pruneReminderHistory({ '2026-11-06': 3, '2026-11-02': 1, '2026-11-03': 2, '2026-11-04': 4 }, now);
    expect(Object.keys(pruned)).toEqual(['2026-11-03', '2026-11-04', '2026-11-06']);
  });

  it('reads only well-formed days and instants', () => {
    expect(parseReminderHistory(JSON.stringify({ '2026-11-04': 5, 'nov 4': 6, '2026-11-05': 'x', '2026-11-06': null })))
      .toEqual({ '2026-11-04': 5 });
    expect(parseReminderHistory('[1, 2]')).toEqual({});
    expect(parseReminderHistory('garbage')).toEqual({});
    expect(parseReminderHistory(null)).toEqual({});
  });
});

describe('reminder settings', () => {
  it('starts off at 8:00 PM and reads saved values inside the evening window', () => {
    for (const raw of [null, '', 'garbage', 'null', '"text"']) {
      expect(parseReminderSettings(raw)).toEqual({ enabled: false, minutes: 1200 });
    }
    expect(parseReminderSettings(JSON.stringify({ enabled: 'yes', minutes: 2000 }))).toEqual({ enabled: false, minutes: 1380 });
    expect(parseReminderSettings(JSON.stringify({ enabled: true, minutes: 600 }))).toEqual({ enabled: true, minutes: 1020 });
    expect(parseReminderSettings(JSON.stringify({ enabled: true, minutes: 12.5 }))).toEqual({ enabled: true, minutes: 1200 });
    expect(parseReminderSettings(JSON.stringify({ enabled: true, minutes: 1290 }))).toEqual({ enabled: true, minutes: 1290 });
  });

  it('clamps a time to 5:00 PM to 11:00 PM', () => {
    expect(clampReminderMinutes(0)).toBe(1020);
    expect(clampReminderMinutes(1439)).toBe(1380);
    expect(clampReminderMinutes(Number.NaN)).toBe(1200);
    expect(clampReminderMinutes(1290)).toBe(1290);
  });

  it('round-trips the picker’s time', () => {
    for (const minutes of [1020, 1200, 1380]) expect(minutesOf(reminderTimeDate(minutes))).toBe(minutes);
  });
});

describe('fuelReminderNote', () => {
  it('says what counts on the saved goal', () => {
    expect(fuelReminderNote('bulk', true)).toContain('calories or protein');
    expect(fuelReminderNote('lean_bulk', true)).toContain('calories or protein');
    expect(fuelReminderNote('cut', true)).toBe('Reminds you when protein is well below today’s target. Stops once you reach it.');
    expect(fuelReminderNote(null, true)).not.toContain('calories');
    expect(fuelReminderNote('bulk', false)).toBe('Set your targets to get this reminder.');
  });
});

describe('reminder ids and targets', () => {
  it('tells a reminder from Rest over and reads its day', () => {
    expect(isFuelReminderId(fuelReminderId('2026-11-04'))).toBe(true);
    expect(isFuelReminderId('hyper-rest-over')).toBe(false);
    expect(reminderDay(fuelReminderId('2026-11-04'))).toBe('2026-11-04');
  });

  it('needs a saved calorie target', () => {
    expect(hasReminderTarget(null)).toBe(false);
    expect(hasReminderTarget(undefined)).toBe(false);
    expect(hasReminderTarget({ calories: 0 })).toBe(false);
    expect(hasReminderTarget(target)).toBe(true);
  });
});

describe('reminderPermission', () => {
  const ios = (overrides: Record<string, unknown> = {}) => ({
    status: 2, allowsAlert: true, allowsDisplayOnLockScreen: true, allowsDisplayInNotificationCenter: true, ...overrides,
  });

  it('maps iOS’s answer to what the reminder can do', () => {
    expect(reminderPermission({ granted: true, canAskAgain: true, ios: ios() })).toBe('granted');
    expect(reminderPermission({ granted: false, canAskAgain: true, ios: ios({ status: 3 }) })).toBe('granted');
    expect(reminderPermission({ granted: true, canAskAgain: true, ios: ios({ allowsAlert: false }) })).toBe('granted');
    expect(reminderPermission({ granted: false, canAskAgain: true, ios: ios({ status: 0 }) })).toBe('undetermined');
    expect(reminderPermission({ granted: false, canAskAgain: false, ios: ios({ status: 1 }) })).toBe('denied');
  });

  it('treats allowed but shown nowhere as off', () => {
    const hidden = ios({ allowsAlert: false, allowsDisplayOnLockScreen: false, allowsDisplayInNotificationCenter: false });
    expect(reminderPermission({ granted: true, canAskAgain: true, ios: hidden })).toBe('denied');
  });
});
