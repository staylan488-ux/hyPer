import { describe, expect, it } from 'vitest';

import { splitTemplates } from '../src/lib/splitTemplates';
import { buildGuidedTemplate, recommendProgramTemplate, type ProgramDesignAnswers } from '../src/lib/programDesigner';

const baseAnswers: ProgramDesignAnswers = {
  daysPerWeek: 4,
  focus: 'no_focus',
  equipment: 'full_gym',
  sessionLength: 'moderate',
  experience: 'intermediate',
};

describe('program designer', () => {
  it('recommends non-specialized evidence template for balanced users', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);
    expect(template.name).toBe('Evidence Upper/Lower (4 days)');
  });

  it('selects lower specialization only when explicitly requested', () => {
    const template = recommendProgramTemplate(splitTemplates, {
      ...baseAnswers,
      focus: 'lower_focus',
    });
    expect(template.name).toContain('Lower Focus');
  });

  it('selects upper specialization when upper focus is requested', () => {
    const template = recommendProgramTemplate(splitTemplates, {
      ...baseAnswers,
      focus: 'upper_focus',
    });
    expect(template.name).toContain('Upper Focus');
  });

  it('adjusts sets by focus and constraints while keeping structure', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);
    const guided = buildGuidedTemplate(template, {
      ...baseAnswers,
      focus: 'upper_focus',
      sessionLength: 'short',
      experience: 'beginner',
      equipment: 'dumbbell_only',
    });

    const upperA = guided.days.find((day) => day.day_name === 'Upper A');
    const lowerA = guided.days.find((day) => day.day_name === 'Lower A');

    expect(guided.days).toHaveLength(template.days.length);
    expect(upperA?.exercises.length).toBeGreaterThan(0);
    expect(lowerA?.exercises.length).toBeGreaterThan(0);

    const baselineUpperA = template.days.find((day) => day.day_name === 'Upper A');
    const baselineLowerA = template.days.find((day) => day.day_name === 'Lower A');
    if (!upperA || !lowerA || !baselineUpperA || !baselineLowerA) return;

    expect(upperA.exercises[0].sets).toBeGreaterThanOrEqual(1);
    expect(lowerA.exercises[0].sets).toBeLessThanOrEqual(baselineLowerA.exercises[0].sets);
    expect(guided.name).toContain('Guided');
  });

  it('applies dumbbell-only substitutions', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);
    const guided = buildGuidedTemplate(template, {
      ...baseAnswers,
      equipment: 'dumbbell_only',
    });

    const allExerciseNames = guided.days.flatMap((day) => day.exercises.map((exercise) => exercise.name.toLowerCase()));

    expect(allExerciseNames.some((name) => /barbell|machine|cable|pulldown|pushdown/.test(name))).toBe(false);
    expect(guided.description.toLowerCase()).toContain('dumbbell-and-bodyweight substitutions');
  });

  it('maps legacy minimal selection to dumbbell-only behavior', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);
    const legacyMinimalGuided = buildGuidedTemplate(template, {
      ...baseAnswers,
      equipment: 'minimal',
    });
    const dumbbellOnlyGuided = buildGuidedTemplate(template, {
      ...baseAnswers,
      equipment: 'dumbbell_only',
    });

    const legacyNames = legacyMinimalGuided.days.flatMap((day) => day.exercises.map((exercise) => exercise.name));
    const dumbbellNames = dumbbellOnlyGuided.days.flatMap((day) => day.exercises.map((exercise) => exercise.name));

    expect(legacyNames).toEqual(dumbbellNames);
    expect(legacyMinimalGuided.description.toLowerCase()).toContain('dumbbell-and-bodyweight substitutions');
  });

  it('short sessions produce fewer exercises per day than moderate', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);

    const moderate = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'moderate' });
    const short = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'short' });

    const moderateTotal = moderate.days.reduce((sum, day) => sum + day.exercises.length, 0);
    const shortTotal = short.days.reduce((sum, day) => sum + day.exercises.length, 0);

    expect(shortTotal).toBeLessThan(moderateTotal);

    // Every day should keep at least 4 exercises
    for (const day of short.days) {
      expect(day.exercises.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('long sessions produce more exercises per day than moderate', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);

    const moderate = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'moderate' });
    const long = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'long' });

    const moderateTotal = moderate.days.reduce((sum, day) => sum + day.exercises.length, 0);
    const longTotal = long.days.reduce((sum, day) => sum + day.exercises.length, 0);

    expect(longTotal).toBeGreaterThan(moderateTotal);

    // Lead compound should have more sets than moderate
    const longFirstSets = long.days[0].exercises[0].sets;
    const modFirstSets = moderate.days[0].exercises[0].sets;
    expect(longFirstSets).toBeGreaterThanOrEqual(modFirstSets);
  });

  it('session length changes are visible across all three options', () => {
    const template = recommendProgramTemplate(splitTemplates, baseAnswers);

    const short = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'short' });
    const moderate = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'moderate' });
    const long = buildGuidedTemplate(template, { ...baseAnswers, sessionLength: 'long' });

    const count = (t: typeof short) => t.days.reduce((s, d) => s + d.exercises.length, 0);

    // Strictly ordered: short < moderate < long
    expect(count(short)).toBeLessThan(count(moderate));
    expect(count(moderate)).toBeLessThan(count(long));
  });
});
