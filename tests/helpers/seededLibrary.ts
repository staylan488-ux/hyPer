import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Exercise, MuscleGroup } from '@/types';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const ROW = /^\s*\('((?:[^']|'')+)', '(\w+)', (NULL|'\w+'), '([^']+)', (true|false)(?:, '(\w+)')?\)/gm;

function rows(sql: string): Exercise[] {
  return Array.from(sql.matchAll(ROW), ([, name, muscle, secondary, equipment, compound, category]) => ({
    id: `seed-${name.replace(/''/g, "'").toLowerCase()}`,
    name: name.replace(/''/g, "'"),
    muscle_group: muscle as MuscleGroup,
    muscle_group_secondary: secondary === 'NULL' ? null : (secondary.slice(1, -1) as MuscleGroup),
    equipment,
    is_compound: compound === 'true',
    category: (category as Exercise['category']) ?? 'gym',
  }));
}

/**
 * The shared exercise library a fresh database holds: the schema's seed, the
 * gym staples migration and the curated list, without the rows the curation
 * retired. Ids are made up from the names.
 */
export function seededLibrary(): Exercise[] {
  const schema = read('supabase/schema.sql');
  const seedStart = schema.indexOf('INSERT INTO exercises');
  const seed = schema.slice(seedStart, schema.indexOf('ON CONFLICT', seedStart));
  const staples = read('supabase/migrations/20261012120000_add_exercise_category_and_gym_staples.sql');
  const curated = read('supabase/migrations/20261111110000_curate_exercise_library.sql');

  const retiredStart = curated.indexOf('UPDATE exercises SET retired_at = NOW()\nWHERE retired_at IS NULL AND name IN (');
  const retiredBlock = curated.slice(retiredStart, curated.indexOf('\n);', retiredStart));
  const retired = new Set(Array.from(retiredBlock.matchAll(/'((?:[^']|'')+)'/g), (match) => match[1].toLowerCase()));

  const byName = new Map<string, Exercise>();
  for (const row of [...rows(seed), ...rows(staples), ...rows(curated)]) {
    if (!byName.has(row.name.toLowerCase())) byName.set(row.name.toLowerCase(), row);
  }
  return [...byName.values()].filter((row) => !retired.has(row.name.toLowerCase()));
}
