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
});
