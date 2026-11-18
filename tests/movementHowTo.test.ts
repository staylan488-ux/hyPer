import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DESIGNER_MOVEMENTS } from '@/lib/designerMovements';
import { HOW_TO, HOW_TO_STUDIES, movementHowTo, type HowToStudy } from '@/lib/movementHowTo';
import { seededLibrary } from './helpers/seededLibrary';

// "How to do it" in the movement sheet: three short lines per kind of
// movement, a study named only where one is the reason (docs/movement-how-to.md).

const library = seededLibrary();
const how = (name: string, equipment: string | null = null) => movementHowTo({ name, equipment });
const named = (name: string) => {
  const found = library.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`${name} is not in the seeded library`);
  return movementHowTo(found);
};
const entries = Object.entries(HOW_TO).flatMap(([pattern, variants]) => variants.map((variant, index) => ({ pattern, index, ...variant })));

describe('the how-to lines', () => {
  it('has lines for every kind of movement', () => {
    for (const [pattern, variants] of Object.entries(HOW_TO)) expect(variants.length, pattern).toBeGreaterThan(0);
  });

  it('keeps every line short, whole and plain', () => {
    for (const entry of entries) {
      for (const line of [entry.setup, entry.rep, entry.why]) {
        const where = `${entry.pattern} ${entry.index}: ${line}`;
        expect(line.length, where).toBeGreaterThan(20);
        expect(line.length, where).toBeLessThanOrEqual(150);
        expect(line.endsWith('.'), where).toBe(true);
        // Dashes, semicolons and "e.g." read as notes, not as a coach talking.
        expect(/[—–;]|\be\.g\.|\bi\.e\./.test(line), where).toBe(false);
      }
    }
  });

  it('names a study in the why exactly when the entry has one, and nowhere else', () => {
    for (const entry of entries) {
      const where = `${entry.pattern} ${entry.index}: ${entry.why}`;
      const cited = entry.why.match(/\(([A-Z][a-z-]+ \d{4})\)/)?.[1] ?? null;
      expect(cited, where).toBe(entry.study ? HOW_TO_STUDIES[entry.study].label : null);
      expect(/\d{4}/.test(entry.setup + entry.rep), where).toBe(false);
    }
  });

  it('uses every study it lists, and the document has each reference', () => {
    const used = new Set(entries.map((entry) => entry.study).filter(Boolean));
    const doc = readFileSync(join(__dirname, '../docs/movement-how-to.md'), 'utf8');
    for (const [key, study] of Object.entries(HOW_TO_STUDIES)) {
      expect(used.has(key as HowToStudy), key).toBe(true);
      expect(doc, key).toContain(study.url);
      expect(doc, key).toContain(study.label.replace(' ', ' et al. '));
    }
  });
});

describe('movementHowTo', () => {
  it('covers every gym movement of the seeded library', () => {
    const missing = library.filter((exercise) => exercise.category !== 'calisthenics' && !movementHowTo(exercise)).map((exercise) => exercise.name);
    expect(missing).toEqual([]);
  });

  it('covers every movement the designed programs use', () => {
    const missing = Object.entries(DESIGNER_MOVEMENTS).filter(([name, row]) => !movementHowTo({ name, equipment: row[3] })).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('gives a variant its own lines', () => {
    expect(named('Seated Leg Curl')).toMatchObject({ study: 'maeo2021', rep: expect.stringContaining('Lean forward') });
    expect(named('Lying Leg Curl')?.study).toBeUndefined();
    expect(named('Leg Curl')?.why).toContain('take the seated one');
    expect(named('Chin-Up')?.setup).toContain('Palms toward you');
    expect(named('Pull-Up')?.setup).toContain('Palms away');
    expect(named('Lat Pulldown')?.setup).toContain('Thigh pad');
    expect(named('One-Arm Lat Pulldown')?.setup).toContain('One handle');
    expect(named('Hack Squat')?.study).toBe('haugen2023');
    expect(named('Barbell Back Squat')?.study).toBe('kubo2019');
    expect(named('Goblet Squat')?.setup).toContain('one dumbbell');
    expect(named('Leg Press Calf Raise')?.study).toBe('kassiano2023');
    expect(named('Standing Calf Raise')?.study).toBe('kinoshita2023');
    expect(named('Preacher Curl')?.study).toBe('pedrosa2023');
    expect(named('Machine Preacher Curl')?.study).toBe('pedrosa2023');
    expect(named('Dumbbell Curl')?.study).toBe('mannarino2021');
    expect(named('Cable Overhead Tricep Extension')?.setup).toContain('Rope');
    expect(named('Tricep Kickback')?.why).toContain('light weight');
    expect(named('Push-Up')?.setup).toContain('straight line');
    expect(named('Machine Chest Press')?.study).toBe('haugen2023');
    expect(named('Cable Lateral Raise')?.setup).toContain('Pulley');
    expect(named('One-Arm Dumbbell Row')?.rep).toContain('hip');
    expect(named('Pendlay Row')?.rep).toContain('floor');
  });

  it('reads a typed-in movement by its name', () => {
    expect(how('Smith Squat', null)?.setup).toContain('ahead of the bar');
    expect(how('seated hamstring curl')?.study).toBe('maeo2021');
    expect(how('Incline DB Press')?.study).toBe('chaves2020');
  });

  it('says nothing where its lines would be wrong or the name is unknown', () => {
    expect(how('Mystery Lift', 'Barbell')).toBeNull();
    expect(how('Pistol Squat', 'bodyweight')).toBeNull();
    expect(how('Single-Leg Romanian Deadlift', 'dumbbells')).toBeNull();
    expect(how('Handstand Push-Up', 'bodyweight')).toBeNull();
    expect(how('Banded Squat', null)).toBeNull();
    expect(how('Dumbbell Leg Curl', 'dumbbells')).toBeNull();
    expect(how('Cable Hip Abduction', 'cable')).toBeNull();
    expect(how('Bench Dips', 'bodyweight')).toBeNull();
  });
});
