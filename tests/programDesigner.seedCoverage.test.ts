import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { splitTemplates } from '../src/lib/splitTemplates';
import {
  buildGuidedTemplate,
  recommendProgramTemplate,
  type ProgramDesignAnswers,
} from '../src/lib/programDesigner';

// Same normalization SplitBuilder.createFromTemplate uses to match template names
// against exercise rows. Names that do not resolve are dropped from the saved split.
function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSeededExerciseNames(): Set<string> {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  const start = schema.indexOf('INSERT INTO exercises');
  const end = schema.indexOf('ON CONFLICT', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const names = new Set<string>();
  for (const match of schema.slice(start, end).matchAll(/^\('([^']+)'/gm)) {
    names.add(normalizeExerciseName(match[1]));
  }
  return names;
}

const DAYS = [2, 3, 4, 5, 6];
const FOCUSES: ProgramDesignAnswers['focus'][] = ['no_focus', 'upper_focus', 'lower_focus'];
const EQUIPMENT: ProgramDesignAnswers['equipment'][] = ['full_gym', 'dumbbell_only', 'minimal'];
const SESSION_LENGTHS: ProgramDesignAnswers['sessionLength'][] = ['short', 'moderate', 'long'];
const EXPERIENCE: ProgramDesignAnswers['experience'][] = ['beginner', 'intermediate', 'advanced'];

describe('guided programs only use seeded exercises', () => {
  it('parses the exercise seed from schema.sql', () => {
    const seeded = readSeededExerciseNames();
    expect(seeded.size).toBeGreaterThan(40);
    expect(seeded.has('overhead dumbbell press')).toBe(true);
  });

  it('every guided template exercise resolves to a seeded exercise', () => {
    const seeded = readSeededExerciseNames();
    const missing = new Set<string>();

    for (const daysPerWeek of DAYS) {
      for (const focus of FOCUSES) {
        for (const equipment of EQUIPMENT) {
          for (const sessionLength of SESSION_LENGTHS) {
            for (const experience of EXPERIENCE) {
              const answers: ProgramDesignAnswers = { daysPerWeek, focus, equipment, sessionLength, experience };
              const guided = buildGuidedTemplate(recommendProgramTemplate(splitTemplates, answers), answers);
              for (const day of guided.days) {
                for (const exercise of day.exercises) {
                  if (!seeded.has(normalizeExerciseName(exercise.name))) {
                    missing.add(`${exercise.name} (${guided.name}, ${equipment})`);
                  }
                }
              }
            }
          }
        }
      }
    }

    expect([...missing]).toEqual([]);
  });

  it('dumbbell-only upper days keep an overhead press', () => {
    const answers: ProgramDesignAnswers = {
      daysPerWeek: 4,
      focus: 'no_focus',
      equipment: 'dumbbell_only',
      sessionLength: 'moderate',
      experience: 'intermediate',
    };
    const guided = buildGuidedTemplate(recommendProgramTemplate(splitTemplates, answers), answers);
    const names = guided.days.flatMap((day) => day.exercises.map((exercise) => exercise.name));
    expect(names).toContain('Overhead Dumbbell Press');
    expect(names).not.toContain('Dumbbell Shoulder Press');
  });
});
