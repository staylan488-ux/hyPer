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
      equipment: 'minimal',
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
});
