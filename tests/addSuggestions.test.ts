import { describe, expect, it } from 'vitest';

import { ADD_FIT_LIMIT, suggestAdds, weekCountLine, type AddFitInput, type SessionMovementSets } from '@/lib/addSuggestions';
import type { MuscleSets } from '@/lib/muscleVolume';
import type { Exercise } from '@/types';
import { seededLibrary } from './helpers/seededLibrary';

// Add a movement and Add a superset open on what fits the session and the
// week (docs/training-volume.md, "Add opens on what fits").

const library = seededLibrary();
const named = (name: string): Exercise => {
  const found = library.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`${name} is not in the seeded library`);
  return found;
};
const did = (name: string, done: number, left: number): SessionMovementSets => ({ exercise: named(name), done, left });
const sets = (entries: Record<string, number>): MuscleSets => new Map(Object.entries(entries));
const fit = (input: Partial<AddFitInput> & Pick<AddFitInput, 'session'>) => {
  const inSession = new Set(input.session.map((movement) => movement.exercise.id));
  return suggestAdds({
    library: library.filter((exercise) => !inSession.has(exercise.id)),
    flexible: false,
    elsewhere: new Map(),
    planned: null,
    ...input,
  });
};
const rows = (input: Parameters<typeof fit>[0]) => fit(input).map((row) => `${row.exercise.name} | ${row.line}`);

describe('weekCountLine', () => {
  it('says the count against the plan, or alone with no plan', () => {
    expect(weekCountLine(3, 8)).toBe('3 of 8 sets so far this week');
    expect(weekCountLine(0, 8)).toBe('0 of 8 sets so far this week');
    expect(weekCountLine(4.5, 9)).toBe('4.5 of 9 sets so far this week');
    expect(weekCountLine(4, null)).toBe('4 sets so far this week');
    expect(weekCountLine(1, null)).toBe('1 set so far this week');
    expect(weekCountLine(0, null)).toBe('none yet this week');
  });
});

describe('what leads Add a movement', () => {
  const lowerDay = [did('Barbell Back Squat', 3, 0), did('Lying Leg Curl', 1, 2), did('Standing Calf Raise', 0, 3)];

  it('offers one movement for each muscle today trains, the most open first, with the week so far', () => {
    expect(rows({
      session: lowerDay,
      elsewhere: sets({ hamstrings: 2, quads: 4 }),
      planned: sets({ quads: 9, hamstrings: 8, glutes: 6, calves: 6, chest: 10 }),
    })).toEqual([
      // Glutes: the squat's second muscle, 1.5 so far and none to come, of 6. The most open.
      'Hip Thrust | Glutes · 1.5 of 6 sets so far this week',
      // Hamstrings: 3 done (2 earlier, 1 today) and 2 to come, of 8.
      'Romanian Deadlift | Hamstrings · 3 of 8 sets so far this week',
      // Quads: 4 earlier and 3 today, of 9.
      'Leg Press | Quadriceps · 7 of 9 sets so far this week',
    ]);
  });

  it('keeps to the main muscles, and to today’s on a planned day', () => {
    const offered = fit({ session: lowerDay, planned: sets({ quads: 9, hamstrings: 8, glutes: 6, calves: 6, chest: 10, back: 10 }) }).map((row) => row.muscle);
    expect(offered).toEqual(['quads', 'hamstrings', 'glutes']);
    // A push day never leads with a row for the back, however open its week.
    const push = fit({ session: [did('Flat Barbell Bench Press', 0, 3), did('Lateral Raise', 0, 3)], planned: sets({ chest: 10, back: 12, side_delts: 8, triceps: 6, biceps: 6 }) });
    expect(push.map((row) => row.muscle).sort()).toEqual(['chest', 'side_delts', 'triceps']);
  });

  it('leaves out a muscle whose week is already covered, and leads with nothing when none has room', () => {
    const full = sets({ quads: 9, hamstrings: 8, glutes: 6 });
    expect(fit({ session: lowerDay, elsewhere: sets({ quads: 6, hamstrings: 5, glutes: 4.5 }), planned: full })).toEqual([]);
    // Today's sets still to come count: hamstrings 5 done, 2 to come, of 8 leaves 1.
    expect(fit({ session: lowerDay, elsewhere: sets({ quads: 6, hamstrings: 4, glutes: 4.5 }), planned: full }).map((row) => row.muscle)).toEqual(['hamstrings']);
  });

  it('prefers a movement from the person’s program, and a different movement from the ones already in', () => {
    const session = [did('Lying Leg Curl', 0, 3)];
    const planned = sets({ hamstrings: 8 });
    // Without a program: not a second leg curl.
    expect(fit({ session, planned })[0].exercise.name).toBe('Romanian Deadlift');
    // His own program's hamstring movement leads, even another curl.
    expect(fit({ session, planned, programExerciseIds: new Set([named('Seated Leg Curl').id]) })[0].exercise.name).toBe('Seated Leg Curl');
  });

  it('opens a flexible session with nothing in it on the least trained muscles', () => {
    expect(rows({ session: [], flexible: true, elsewhere: sets({ chest: 6, back: 7, quads: 3, hamstrings: 9, glutes: 9, side_delts: 9, triceps: 9 }) })).toEqual([
      'Dumbbell Curl | Biceps · none yet this week',
      'Leg Press | Quadriceps · 3 sets so far this week',
      'Incline Dumbbell Bench Press | Chest · 6 sets so far this week',
    ]);
  });

  it('keeps a flexible session to the half of the body it has started on', () => {
    const offered = fit({ session: [did('Lat Pulldown', 3, 0)], flexible: true }).map((row) => row.muscle);
    expect(offered).toHaveLength(ADD_FIT_LIMIT);
    for (const muscle of offered) expect(['chest', 'back', 'side_delts', 'biceps', 'triceps']).toContain(muscle);
  });

  it('never offers a bodyweight skill, a retired movement or one with no reason to lead', () => {
    const odd: Exercise[] = [
      { ...named('Dumbbell Curl'), id: 'x1', name: 'Weird Curl' },
      { ...named('Dumbbell Curl'), id: 'x2', retired_at: '2026-11-11T00:00:00Z' },
      { ...named('Cable Curl'), id: 'x3', category: 'calisthenics' },
    ];
    expect(suggestAdds({ library: odd, session: [], flexible: true, elsewhere: new Map(), planned: null })).toEqual([]);
  });

  it('states a count and stops', () => {
    const lines = [
      ...rows({ session: lowerDay, planned: sets({ quads: 9, hamstrings: 8, glutes: 6 }) }),
      ...rows({ session: [], flexible: true }),
    ];
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line).not.toMatch(/behind|missed|short|only|left|should|need|low|under/i);
  });
});

describe('what leads Add a superset', () => {
  it('offers movements that leave the paired movement’s muscles alone', () => {
    const bench = named('Flat Barbell Bench Press');
    const offered = fit({ session: [{ exercise: bench, done: 1, left: 2 }], flexible: true, pairWith: bench });
    expect(offered.map((row) => row.muscle)).toEqual(['back', 'side_delts', 'biceps']);
    expect(offered[0].exercise.name).toBe('Seated Cable Row');
  });

  it('stays in the paired movement’s half of the body and never loads the lower back twice', () => {
    const rdl = named('Romanian Deadlift');
    const offered = fit({ session: [{ exercise: rdl, done: 0, left: 3 }], flexible: true, pairWith: rdl });
    // Quads only, and a quad movement with no glutes in it: hamstrings and glutes are the deadlift's own.
    expect(offered.map((row) => `${row.muscle}: ${row.exercise.name}`)).toEqual(['quads: Leg Extension']);

    // A hinge the person's program holds for the hamstrings alone: fine beside a leg extension, not beside a squat.
    const goodMorning: Exercise = { ...named('Lying Leg Curl'), id: 'gm', name: 'Good Morning', equipment: 'barbell' };
    const pairedWith = (name: string) =>
      suggestAdds({
        library: [goodMorning], session: [did(name, 0, 3)], flexible: true, elsewhere: new Map(), planned: null,
        programExerciseIds: new Set(['gm']), pairWith: named(name),
      }).map((row) => row.exercise.name);
    expect(pairedWith('Leg Extension')).toEqual(['Good Morning']);
    expect(pairedWith('Barbell Back Squat')).toEqual([]);
  });
});
