import { describe, expect, it } from 'vitest';
import {
  buildCronometerIdentities,
  cronometerLoggedAt,
  parseCronometerCsv,
  parseCsv,
} from '@/lib/cronometerImport';

describe('Cronometer CSV parsing', () => {
  it('parses quoted food names and the standard servings export columns', () => {
    const csv = `Day,Time,Group,Food Name,Amount,Unit,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-07-16,8:05 AM,Breakfast,"Yogurt, Greek",170,g,100,17,6,1`;
    const parsed = parseCronometerCsv(csv);

    expect(parsed.invalid).toBe(0);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      date: '2026-07-16',
      time: '8:05 AM',
      group: 'Breakfast',
      foodName: 'Yogurt, Greek',
      amount: 170,
      unit: 'g',
      calories: 100,
      protein: 17,
      carbs: 6,
      fat: 1,
    });
  });

  it('accepts underscore headers and an amount containing its unit', () => {
    const csv = `Date,Group,Food_Name,Amount,Energy_(kcal),Protein_(g),Carbs_(g),Fat_(g)\n07/16/2026,Snack 1,Protein Bar,1 bar,210,20,23,7`;
    const parsed = parseCronometerCsv(csv);

    expect(parsed.rows[0]).toMatchObject({ date: '2026-07-16', amount: 1, unit: 'bar', foodName: 'Protein Bar' });
  });

  it('handles embedded newlines and escaped quotes according to CSV rules', () => {
    const rows = parseCsv('a,b\n"line 1\nline 2","say ""hello"""');
    expect(rows).toEqual([['a', 'b'], ['line 1\nline 2', 'say "hello"']]);
  });

  it('skips rows without a valid date or food name', () => {
    const parsed = parseCronometerCsv('Day,Food Name,Energy (kcal)\nnot-a-date,Chicken,200\n2026-07-16,,100');
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.invalid).toBe(2);
  });
});
describe('Cronometer import identities', () => {
  it('keeps repeated identical foods distinct while producing stable identities', async () => {
    const { rows } = parseCronometerCsv(`Day,Group,Food Name,Amount,Unit,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-07-16,Lunch,Rice,200,g,260,5,57,1\n2026-07-16,Lunch,Rice,200,g,260,5,57,1`);
    const first = await buildCronometerIdentities(rows);
    const second = await buildCronometerIdentities(rows);

    expect(first[0].rowId).not.toBe(first[1].rowId);
    expect(first[0].foodId).toBe(first[1].foodId);
    expect(first.map((item) => item.rowId)).toEqual(second.map((item) => item.rowId));
  });

  it('builds a local timestamp with the exported time', () => {
    const { rows } = parseCronometerCsv('Day,Time,Food Name,Amount,Energy (kcal)\n2026-07-16,7:45 PM,Chicken,1,200');
    const date = new Date(cronometerLoggedAt(rows[0]));
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(16);
    expect(date.getHours()).toBe(19);
    expect(date.getMinutes()).toBe(45);
  });
});
