import { describe, expect, it } from 'vitest';

import { averageLoggedDays } from '@/hooks/useWeeklyNutrition';
import { doneOfPlanned, muscleProgressRows, plannedShare, programMuscleValue, programVolumeLine, programWeekLine, usualWeekLine, weekLine } from '@/lib/muscleProgress';

// Progress's words: what is done and what is next, never what was missed.

const sets = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('the week line', () => {
  it('says what is done and what is next', () => {
    expect(weekLine({ done: 3, target: 6, next: 'Legs A' })).toBe('3 sessions done. Legs A is next.');
    expect(weekLine({ done: 1, target: 6, next: 'Pull A' })).toBe('1 session done. Pull A is next.');
    expect(weekLine({ done: 0, target: 6, next: 'Push A' })).toBe('Push A is next.');
    expect(weekLine({ done: 2, target: null, next: null })).toBe('2 sessions done.');
  });

  it('says when every planned session is done, and never counts past it as missing', () => {
    expect(weekLine({ done: 6, target: 6, next: 'Push A' })).toBe('All 6 sessions done.');
    expect(weekLine({ done: 1, target: 1, next: null })).toBe('This week’s session is done.');
    expect(weekLine({ done: 7, target: 6, next: 'Pull A' })).toBe('7 sessions done.');
  });

  it('has nothing to say before anything is known', () => {
    expect(weekLine({ done: null, target: 6, next: null })).toBeNull();
    expect(weekLine({ done: 0, target: null, next: undefined })).toBeNull();
  });

  it('never words a week as behind or missed', () => {
    const lines = [0, 1, 2, 3, 6, 9].flatMap((done) => [null, 3, 6].map((target) => weekLine({ done, target, next: 'Legs A' }) ?? ''));
    for (const line of lines) expect(line).not.toMatch(/behind|missed|only|low|under|left|remaining/i);
  });
});

describe('the rows', () => {
  it('lists every muscle planned or trained, most planned first', () => {
    const rows = muscleProgressRows(sets({ chest: 3, traps: 1 }), sets({ quads: 11, chest: 6, back: 6, calves: 0 }));
    expect(rows.map((row) => row.muscle)).toEqual(['quads', 'chest', 'back', 'traps']);
    expect(rows[1]).toMatchObject({ label: 'Chest', done: 3, planned: 6, main: true });
    expect(rows[3]).toMatchObject({ done: 1, planned: 0, main: false });
  });

  it('with no plan, lists what was done', () => {
    expect(muscleProgressRows(sets({ chest: 3 }), null)).toEqual([{ muscle: 'chest', label: 'Chest', done: 3, planned: null, main: true }]);
  });

  it('reads done of planned, or the plain count', () => {
    expect(doneOfPlanned(3, 6)).toBe('3 of 6 planned');
    expect(doneOfPlanned(4.5, 8.5)).toBe('4.5 of 8.5 planned');
    expect(doneOfPlanned(8, 6)).toBe('8 of 6 planned');
    expect(doneOfPlanned(1, 0)).toBe('1 set');
    expect(doneOfPlanned(3, null)).toBe('3 sets');
  });

  it('fills the track by the planned share, full past the plan', () => {
    expect(plannedShare(3, 6)).toBe(0.5);
    expect(plannedShare(9, 6)).toBe(1);
    expect(plannedShare(3, 0)).toBeNull();
    expect(plannedShare(3, null)).toBeNull();
  });

  it('opens on the program’s week with its band, and the usual week as a plain figure', () => {
    expect(programWeekLine('chest', 6)).toBe('6 sets a week in the program, solid');
    expect(programWeekLine('side_delts', 2)).toBe('2 sets a week in the program, low');
    expect(programWeekLine('traps', 1)).toBe('1 set a week in the program');
    expect(programWeekLine('chest', 0)).toBe('Not in the program');
    expect(usualWeekLine(3.5)).toBe('About 3.5 sets a week lately');
    expect(usualWeekLine(1)).toBe('About 1 set a week lately');
    expect(usualWeekLine(0.1)).toBeNull();
    expect(usualWeekLine(undefined)).toBeNull();
  });
});

describe("a program's design", () => {
  it('puts a band word only on a main muscle', () => {
    expect(programMuscleValue({ muscle: 'chest', sets: 8.5 })).toBe('8.5 · solid');
    expect(programMuscleValue({ muscle: 'back', sets: 14 })).toBe('14 · high');
    expect(programMuscleValue({ muscle: 'traps', sets: 1 })).toBe('1');
  });

  it('sums a program up in one line', () => {
    expect(programVolumeLine([])).toBe('Every main muscle is solid');
    expect(programVolumeLine(['Side delts'])).toBe('Side delts is low');
    expect(programVolumeLine(['Side delts', 'Hamstrings'])).toBe('Side delts and hamstrings are low');
    expect(programVolumeLine(['Side delts', 'Hamstrings', 'Biceps'])).toBe('3 main muscles are low');
  });
});

describe('averageLoggedDays', () => {
  it('averages only days with something logged', () => {
    const days = [
      { date: '2026-10-20', calories: 2000, protein: 150 },
      { date: '2026-10-21', calories: 0, protein: 0 },
      { date: '2026-10-22', calories: 2400, protein: 0 },
    ];
    expect(averageLoggedDays(days, 'calories')).toBe(2200);
    expect(averageLoggedDays(days, 'protein')).toBe(150);
    expect(averageLoggedDays([], 'protein')).toBe(0);
  });
});
