import { describe, expect, it } from 'vitest';

import { compileEvidenceTemplates } from '../src/lib/evidence/compiler';
import { beardsleyEvidenceSnapshot } from '../src/lib/evidence/snapshot';
import { splitTemplates } from '../src/lib/splitTemplates';

describe('evidence template compiler', () => {
  it('compiles blueprint templates with evidence metadata', () => {
    const compiled = compileEvidenceTemplates(beardsleyEvidenceSnapshot);

    expect(compiled.templates.length).toBeGreaterThan(0);
    expect(Object.keys(compiled.rulesById).length).toBeGreaterThan(0);
    expect(Object.values(compiled.rulesById).some((rule) => rule.domain === 'volume')).toBe(true);

    const first = compiled.templates[0];
    expect(first.evidence?.label).toBe('Evidence-informed');
    expect(first.days_per_week).toBe(4);
    expect(first.days).toHaveLength(4);
    expect(first.days[0].exercises.length).toBeGreaterThan(0);
  });

  it('exposes evidence-first templates in split template list', () => {
    expect(splitTemplates[0].name).toBe('Evidence Upper/Lower (4 days)');
    expect(splitTemplates[0].evidence?.confidence).toBe('solid');
    expect(splitTemplates.every((template) => Boolean(template.evidence))).toBe(true);

    const upperSpecialization = splitTemplates.find((t) => t.name.includes('Upper Focus'));
    const lowerSpecialization = splitTemplates.find((t) => t.name.includes('Lower Focus'));
    expect(upperSpecialization).toBeTruthy();
    expect(lowerSpecialization).toBeTruthy();
    expect(upperSpecialization?.evidence?.confidence).toBe('emerging');
    expect(lowerSpecialization?.evidence?.confidence).toBe('emerging');
  });

  it('keeps high-skill compounds ahead of accessories in baseline template order', () => {
    const baseline = splitTemplates.find((template) => template.name === 'Evidence Upper/Lower (4 days)');
    expect(baseline).toBeTruthy();
    if (!baseline) return;

    const upperA = baseline.days.find((day) => day.day_name === 'Upper A');
    const lowerA = baseline.days.find((day) => day.day_name === 'Lower A');
    const lowerB = baseline.days.find((day) => day.day_name === 'Lower B');
    const upperB = baseline.days.find((day) => day.day_name === 'Upper B');

    expect(upperA?.exercises[0].name).toBe('Flat Barbell Bench Press');
    expect(lowerA?.exercises[0].name).toBe('Barbell Back Squat');
    expect(lowerA?.exercises[1].name).toBe('Romanian Deadlift');
    expect(lowerB?.exercises[0].name).toBe('Bulgarian Split Squat');
    expect(upperB?.exercises[0].name).toBe('Overhead Barbell Press');

    const pushdownIndex = upperA?.exercises.findIndex((exercise) => exercise.name === 'Tricep Pushdown') ?? -1;
    const benchIndex = upperA?.exercises.findIndex((exercise) => exercise.name === 'Flat Barbell Bench Press') ?? -1;
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(pushdownIndex).toBeGreaterThan(benchIndex);
  });

  describe('unprofiled exercises keep their authored slot', () => {
    const compiled = compileEvidenceTemplates(beardsleyEvidenceSnapshot).templates;
    const names = (templateName: string, dayName: string) =>
      compiled
        .find((template) => template.name === templateName)
        ?.days.find((day) => day.day_name === dayName)
        ?.exercises.map((exercise) => exercise.name) ?? [];

    it('puts Barbell Row ahead of Cable Fly and Lat Pulldown on Arnold Chest & Back A', () => {
      const order = names('Evidence Arnold Split (6 days)', 'Chest & Back A');
      expect(order.indexOf('Barbell Row')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('Barbell Row')).toBeLessThan(order.indexOf('Cable Fly'));
      expect(order.indexOf('Barbell Row')).toBeLessThan(order.indexOf('Lat Pulldown'));
    });

    it('puts Lunge ahead of Leg Extension and Calf Raise on PPL Legs A', () => {
      const order = names('Evidence Push/Pull/Legs (6 days)', 'Legs A');
      expect(order.indexOf('Lunge')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('Lunge')).toBeLessThan(order.indexOf('Leg Extension'));
      expect(order.indexOf('Lunge')).toBeLessThan(order.indexOf('Calf Raise'));
    });

    it('does not leave Barbell Row last on Full Body A', () => {
      const order = names('Evidence Full Body (3 days)', 'Full Body A');
      expect(order).toContain('Barbell Row');
      expect(order.at(-1)).not.toBe('Barbell Row');
    });

    it('keeps the authored order on a day under 60% profile coverage (PPL Pull A)', () => {
      const blueprint = beardsleyEvidenceSnapshot.template_blueprints
        .find((template) => template.name === 'Evidence Push/Pull/Legs (6 days)')
        ?.days.find((day) => day.day_name === 'Pull A');
      expect(blueprint).toBeTruthy();
      expect(names('Evidence Push/Pull/Legs (6 days)', 'Pull A')).toEqual(blueprint?.exercises.map((exercise) => exercise.name));
    });

    it('only reorders: every compiled day keeps its blueprint exercises, sets and reps', () => {
      const key = (exercise: { name: string; sets: number; reps_min: number; reps_max: number }) =>
        `${exercise.name}|${exercise.sets}|${exercise.reps_min}|${exercise.reps_max}`;

      beardsleyEvidenceSnapshot.template_blueprints.forEach((blueprint, templateIndex) => {
        blueprint.days.forEach((day, dayIndex) => {
          const compiledDay = compiled[templateIndex].days[dayIndex];
          expect(compiledDay.day_name).toBe(day.day_name);
          expect(compiledDay.exercises.map(key).sort()).toEqual(day.exercises.map(key).sort());
        });
      });
    });
  });
});
