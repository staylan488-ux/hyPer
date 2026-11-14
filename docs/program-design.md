# Built-in programs: how they are designed and what that rests on

The builder asks five questions (days, emphasis, equipment, session length,
experience) and hands the editor a program. The programs are written in
`src/lib/programBlueprints.ts`; the sets are shared out by
`src/lib/programDesigner.ts`. This note says why each is the way it is.
Written 2026-11-13.

How sets are counted, and the low, solid and high bands, are in
[training-volume.md](training-volume.md). This note builds on it.

## The programs

One for each day count, written by hand:

| Days | Program | Days of the week |
|---|---|---|
| 3 | Full Body | Full Body A, B, C |
| 4 | Upper/Lower | Upper A, Lower A, Upper B, Lower B |
| 5 | Upper/Lower + Push/Pull/Legs | Upper, Lower, Push, Pull, Legs |
| 6 | Push/Pull/Legs | Push A, Pull A, Legs A, Push B, Pull B, Legs B |

Each trains every main muscle on two days or more. A program is a list of
movements in training order with no set counts. The designer adds the sets, so
a 45-minute beginner and a 75-minute advanced lifter get the same program at
different sizes, not two different programs.

There used to be seven templates. The 3-day push/pull/legs trained each muscle
once a week with 2 to 3 sets for hamstrings and side delts. The 6-day
"Arnold" split could not be reached from the builder and gave triceps 18 sets
and rear delts none. The two "focus" variants of upper/lower left the other
half under the minimum (chest 2 sets a week on the lower-focus one). Five days
gave the 4-day plan. All of that is gone; an emphasis is now an answer that
moves sets inside the same program.

## The rules, and where each comes from

### 1. Plan by sets per muscle per week

The strongest finding in the hypertrophy research is the dose-response of
weekly sets. Pelland et al. (Sports Medicine 2025,
<https://doi.org/10.1007/s40279-025-02344-w>; open preprint
<https://sportrxiv.org/index.php/server/preprint/view/460>) pooled 67 studies:
about 4 sets a week is the smallest dose that reliably grows a muscle, each
set up to about 10 buys the most, and 11 to 18 still adds, more slowly.

So the designer aims every main muscle at a number of sets a week, set by the
Experience answer (`WEEKLY_SET_TARGETS`):

| Experience | Aim, sets a week per main muscle |
|---|---|
| Beginner | 6 |
| Intermediate | 10 |
| Advanced | 14 |

- 10 is the top of the tier where each added set buys the most.
- 14 sits in the next tier, for someone the easy gains have left.
- 6 is a starting dose just above the minimum, with room to add.
- No main muscle is ever aimed under 4.

The three values are a judgment inside those tiers. The research gives the
tiers, not a number for each experience level.

The plan lands under its aim when the sessions cannot hold it, and stops at
the aim when they can. Six days at 60 minutes already hold an intermediate's
week, so asking for 75 minutes adds nothing and the description says how long
the sessions really are.

### 2. The split is a schedule, not a method

With weekly sets equal, how they are split over the week makes little or no
difference to growth: Pelland et al. found the effect of frequency negligible
once volume was accounted for, Schoenfeld, Grgic and Krieger (2019) found the
same, and Ramos-Campo et al. (2024, <https://pubmed.ncbi.nlm.nih.gov/38595233/>)
found no difference between split and full-body routines at equal volume.

So "full body" or "push/pull/legs" is only how the week's sets are laid out
for the days a person has. The reason every program still trains each main
muscle on two days or more is practical: the tenth set for a muscle in one
session is worth less than the fifth (Remmert et al., preprint,
<https://sportrxiv.org/index.php/server/preprint/view/537>, find returns per
session flattening at around 11 sets), and ten good sets are easier across two
days than in one. A plan that trains a muscle once a week has to put the whole
week's work in one session, which is the real weakness of body-part splits.

The designer never gives one muscle more than 10 sets in one session. That
ceiling is a design choice below where Remmert's curve flattens, not a limit
the research sets.

### 3. Session length is a number of sets

A working set with its rest takes about 3 minutes, after about 5 minutes of
warm-up: 45 minutes hold 13 sets, 60 hold 18, 75 hold 23 (`SESSION_SET_CAPS`).
Rests longer than a minute grow slightly more muscle than shorter ones, with
no clear gain past about 90 seconds (Singer et al. 2024,
<https://doi.org/10.3389/fspor.2024.1429789>), which is what the 3 minutes a
set allow for.

### 4. Rep ranges are about practicality

Muscle grows equally well from heavy and light loads when sets are taken
close to failure (Schoenfeld et al. 2017,
<https://pubmed.ncbi.nlm.nih.gov/28834797/>; Lopez et al. 2021). The ranges
are picked for the job: 6 to 10 for the big barbell lifts, 8 to 12 for other
compounds, 10 to 15 for single-muscle work, 12 to 20 for lateral raises and
rear delts, where heavy loads are awkward and hard to step up.

### 5. Movement choices

Each of these changes what a program holds.

- **A leg extension beside the squat.** Squats grow three of the four quad
  muscles and leave the rectus femoris nearly untouched (Kubo et al. 2019);
  leg extensions grow it (Zabaleta-Korta et al. 2021; Larsen et al. 2025,
  <https://pubmed.ncbi.nlm.nih.gov/39699974/>).
- **A leg curl as well as a Romanian deadlift.** Squats do not grow the
  hamstrings (Kubo et al. 2019). The seated curl leads because it grew the
  hamstrings more than the lying curl (Maeo et al. 2021); the lying curl is
  the second choice on the other leg day.
- **An overhead triceps extension.** It grew the triceps more than the same
  movement with the arms by the sides (Maeo et al. 2023). Every program has
  one, with a different triceps movement on another day.
- **An incline press.** It grows the upper chest more than the flat press
  (Chaves et al. 2020, <https://pmc.ncbi.nlm.nih.gov/articles/PMC7449336/>).
  Every program has a flat and an incline press on different days.
- **Curls, not only rows.** Rows and pulldowns grow the biceps less than
  curls do (Mannarino et al. 2021), so the half set a row counts for the
  biceps is not left to carry them.
- **A pulldown or pull-up and a row.** They load the back differently, and
  every plan, for every answer, has at least one of each.
- **Straight-leg calf raises.** Standing raises grew the calves more than
  seated ones (Kinoshita et al. 2023, Frontiers in Physiology 14:1272106).
- **Glutes aim at 0.8 of the others.** Squats grew the glutes as much as hip
  thrusts did (Plotkin et al. 2023,
  <https://doi.org/10.3389/fphys.2023.1279170>), and the app counts a squat as
  half a set for them. A plan that chased the full number would pile on hip
  thrusts.
- **Shoulder presses come last.** Bench and incline presses already train the
  front delts, so the designer counts them as half a set there and adds a
  shoulder press only when a session has room to spare. Side delts get lateral
  raises on two days or more, because pressing does little for them. This is
  a judgment, and it means a 4-day, 60-minute plan has no overhead press.
- **Order.** Which movement comes first in a session does not change growth
  (Nunes et al. 2021, <https://pubmed.ncbi.nlm.nih.gov/32077380/>), so the
  order is the practical one: the heaviest lift first, single-muscle work
  after, and the two days of a pair led by different lifts.

### 6. Emphasis

Under an emphasis the favoured half of the body aims 1.3 times higher and the
other half 0.75 times, never under 4 (`EMPHASIS`). For an intermediate that is
13 sets against 7.5. The favoured half fills its own days first; only when
they are full does its work go on the other half's days (a pulldown, lateral
raises and triceps on a leg day).

The size of the shift is a judgment. It follows the owner's own notes
(`references/volume-progressions.md` in the notes repository: add about 2 to 6
sets a week to the muscle being specialised and take some from the others).

### 7. Dumbbells only

Each row names its dumbbell or bodyweight stand-in, or none. The seeded
library has one hamstring movement for dumbbells (the dumbbell Romanian
deadlift), so hamstrings top out at 8 sets a week on a 4-day or longer
dumbbell plan, and there is no direct glute movement. Adding a dumbbell leg
curl or a Nordic curl to the library would lift that.

## How the sets are shared out

1. Every row starts at 0 sets.
2. The muscle furthest from its aim goes next. A main muscle under 4 goes
   before everyone.
3. It gets a first-choice movement at 2 sets on the day that has the least of
   it. With those in, a third set or a second-choice movement, then a fourth
   set, then the third choices. No movement gets more than 4 sets, and none
   fewer than 2.
4. Calves, rear delts, front delts and abs aim at a share of a main muscle's
   number (0.6, 0.6, 0.6 and 0.4) and wait until the main muscles are most of
   the way there, so they are the first to go when sessions are short.
5. It stops when every aim is met or no session has room.
6. On leg days of a balanced plan, a lateral raise or an arm movement can
   take room that is still free after that.
7. A day left with fewer than three movements takes one more.

`describeProgram` then writes the plan's description from its own numbers:
"Planned by sets per muscle: every main muscle twice a week, 8 to 10 sets
each. Sessions take 55 to 60 minutes."

## What is judgment, not research

- The aims of 6, 10 and 14, inside the tiers the research gives.
- The emphasis factors, 1.3 and 0.75.
- The ceiling of 10 sets for one muscle in one session.
- 2 to 4 sets a movement, and 3 minutes a set.
- The shares for calves, rear delts, front delts and abs.
- Leaving the overhead press for last.

## A program that keeps your own movements

When someone with a program rebuilds it, the builder keeps their movements in
the new plan's slots. That plan is no longer the designer's, and before
2026-11-13 it was only brought up to the floor of 4 sets a muscle. Now
`topUpToAim` (`src/lib/programFill.ts`) takes each main muscle toward the same
weekly aim a designed plan gets for those answers (owner decision,
2026-11-13).

It works by the designer's order and limits:

1. The muscle furthest from its aim goes next. One within half a set has
   arrived.
2. A day where the built-in program trains that muscle, and this program has
   nothing for it, takes a movement at 2 sets: the built-in program's own
   choice for that day, with its rep range. A curl lands on a pull day.
3. Then the person's movements for the muscle go to 3 sets, then to 4.
4. Only then does another movement join.
5. A muscle one set short gets a set, not a movement.
6. No session passes its length, no muscle gets more than 10 sets in a
   session, and nothing is taken from any movement.

A plan that is still the designer's, movement for movement, skips this: it
was already shared out to the same aim with the whole week in view. A plan
whose sessions are full stays under the aim, as a designed plan does.

## What the designer does not do

- It does not grade attendance, count missed days or shrink a plan.
- It does not set how hard a set is or when to add weight. Set targets do
  that.
- It does not change a saved program. It only fills the editor's draft.

## Checks

`tests/programDesigner.test.ts` runs all 216 combinations of the five answers
and holds each to the rules above: every session inside its length, 2 to 4
sets a movement, every main muscle on two days with 4 sets or more, a
pulldown and a row, balance, dumbbell plans using only dumbbells and
bodyweight, and the plan reaching the editor unchanged. It also pins the
default plan movement by movement, so a change to it is a deliberate one.
`tests/programFill.test.ts` covers the top-up of a person's own program.
