import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { exerciseCategory } from '@/lib/exerciseSearch';
import { splitTemplates } from '@/lib/splitTemplates';
import type { MuscleGroup } from '@/types';
import { MUSCLE_GROUP_LABELS } from '@/types';

const sql = readFileSync(join(__dirname, '../supabase/migrations/20261111110000_curate_exercise_library.sql'), 'utf8');

/** The quoted names in the statement that starts with `marker`, up to its closing parenthesis. */
function namesAfter(marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf('\n);', start));
  return Array.from(block.matchAll(/'((?:[^']|'')+)'/g), (match) => match[1].replace(/''/g, "'"));
}

const added = Array.from(
  sql.matchAll(/^\s*\('((?:[^']|'')+)', '(\w+)', (NULL|'\w+'), '([^']+)', (true|false)\)/gm),
  ([, name, muscle, secondary, equipment]) => ({ name, muscle, secondary: secondary === 'NULL' ? null : secondary.slice(1, -1), equipment }),
);
const retired = namesAfter('UPDATE exercises SET retired_at = NOW()\nWHERE retired_at IS NULL AND name IN (').filter((name) => name !== 'NOW');
const moved = namesAfter("UPDATE exercises SET category = 'calisthenics'");

describe('the curated exercise library migration', () => {
  it('adds each staple once, with muscles the app knows', () => {
    expect(added.length).toBeGreaterThan(40);
    expect(new Set(added.map((row) => row.name.toLowerCase())).size).toBe(added.length);
    for (const row of added) {
      expect(MUSCLE_GROUP_LABELS[row.muscle as MuscleGroup], row.name).toBeDefined();
      if (row.secondary) expect(MUSCLE_GROUP_LABELS[row.secondary as MuscleGroup], row.name).toBeDefined();
      expect(exerciseCategory({ name: row.name, equipment: row.equipment }), row.name).toBe('gym');
    }
  });

  it('adds the hip machines and the calf raise guided plans ask for', () => {
    const names = added.map((row) => row.name);
    expect(names).toContain('Hip Abduction Machine');
    expect(names).toContain('Calf Raise');
  });

  it('never retires or moves a movement the guided plans use', () => {
    const planned = new Set(splitTemplates.flatMap((template) => template.days.flatMap((day) => day.exercises.map((exercise) => exercise.name))));
    expect(planned.size).toBeGreaterThan(10);
    for (const name of [...retired, ...moved]) expect(planned.has(name), name).toBe(false);
  });

  it('keeps the retire and move lists apart from the additions', () => {
    expect(retired).toContain('Face Pulls');
    expect(moved).toContain('Iron Cross Hold');
    const addedNames = new Set(added.map((row) => row.name));
    for (const name of [...retired, ...moved]) expect(addedNames.has(name), name).toBe(false);
    for (const name of retired) expect(moved, name).not.toContain(name);
  });
});

describe('the muscle tag migration', () => {
  const tags = readFileSync(join(__dirname, '../supabase/migrations/20261113120000_fix_muscle_tags.sql'), 'utf8');
  const statements = tags.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n').split(';').map((statement) => statement.trim()).filter(Boolean);

  it('only updates tags, and only where it names the value it expects', () => {
    expect(statements.length).toBeGreaterThan(3);
    for (const statement of statements) {
      expect(statement, statement).toMatch(/^UPDATE exercises SET muscle_group(_secondary)? = /);
      expect(statement, statement).toMatch(/WHERE .*muscle_group(_secondary)? (=|IN|IS) /s);
    }
  });

  it('sets only muscles the app knows', () => {
    // Each SET clause sits on its statement's first line, before WHERE.
    const values = statements.flatMap((statement) => Array.from(statement.split(/\bWHERE\b/)[0].matchAll(/= '(\w+)'/g), (match) => match[1]));
    expect(values.length).toBeGreaterThanOrEqual(statements.length);
    expect(values).toContain('adductors');
    expect(values).toContain('lower_back');
    for (const value of values) expect(MUSCLE_GROUP_LABELS[value as MuscleGroup], value).toBeDefined();
  });
});
