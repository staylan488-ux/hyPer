# Set targets: what the numbers rest on

The rule lives in `src/lib/setTargets.ts`; the phone's wording is in
`native/src/lib/setTargets.ts`. This note says where each number comes from
and which ones are a judgment, not a finding. Read 2026-11-13, for the
training science audit of that day.

## Sources

- **Plotkin et al. 2022**, "Progressive overload without progressing load? The
  effects of load or repetition progression on muscular adaptations", PeerJ,
  <https://peerj.com/articles/14142>. The page would not open on the day; the
  abstract was read as search results showed it.
- **Schoenfeld et al. 2021**, "Loading Recommendations for Muscle Strength,
  Hypertrophy, and Local Endurance: A Re-Examination of the Repetition
  Continuum", Sports, <https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/>.
  Abstract and the hypertrophy section read.
- **Robinson et al. 2024**, "Exploring the Dose-Response Relationship Between
  Estimated Resistance Training Proximity to Failure, Strength Gain, and
  Muscle Hypertrophy", Sports Medicine; preprint
  <https://sportrxiv.org/index.php/server/preprint/view/295>. Abstract read.
  The authors call the analysis exploratory.
- **Halperin et al.**, "Accuracy in Predicting Repetitions to Task Failure in
  Resistance Exercise: A Scoping Review and Exploratory Meta-analysis";
  preprint <https://sportrxiv.org/index.php/server/preprint/view/67>.
  Abstract read.
- The owner's own history (51 workouts, February to November 2026), replayed
  through the rule with `tests/setTargetsReplay.test.ts`. The export stays
  outside the repo.

## Adding reps or adding weight

Plotkin et al. had trained people progress either the load or the reps for
eight weeks and found similar muscle growth either way. Schoenfeld et al.
conclude that growth is similar across a wide span of loads when sets are
taken close to failure. So which of the two a target raises matters much less
than that one of them keeps rising, and the rule's job is to keep sets hard
without stalling on one weight.

That is why the rule is double progression: reps climb inside the range, then
the weight goes up and the reps start again near the bottom.

## When the weight goes up

Either of two things earns the next weight:

1. **The range.** Set 1 has reached the top of the rep range and every set is
   still at or above the bottom of it.
2. **The estimate.** Every set would still land inside the range at the next
   weight, by the app's estimate (Epley: weight × (1 + reps / 30)). This was
   the only gate before the audit and is kept as the early way up.

The estimate alone was too slow for the owner. Replayed over his history it
offered a heavier weight twice in nine months, while he raised the weight
himself on most movements, and on his 16 self-chosen increases it predicted a
median of about 6 fewer reps than he then did. The range gate is the standard
form of double progression and does not depend on the estimate being right
for the person.

**A big step asks for more first.** By the same estimate, a weight step costs
about (30 + reps) × the step's share of the weight in reps. A step of a tenth
(50 to 55 lb) costs about 4 reps, which a normal range absorbs. A light
movement on a coarse stack is different: 15 to 20 lb is a third heavier and
costs about 14. So a step over a tenth of the weight asks for reps past the
range before it is offered: half the estimate's cost of the part of the step
over a tenth (`repsPastRange`). Half, because the estimate ran pessimistic in
the replay. This is a judgment, not a published rule.

**After the step.** Set 1 starts at the estimate less one rep, never under the
range. When only the range earned the step, later sets keep last time's drop
from set 1 and can start a rep or two under the range. Schoenfeld et al. give
no reason to fear a couple of sets just under a chosen range.

## The rating sets the pace

Robinson et al. found growth rising as sets end closer to failure, with most
of it available a few reps short. A set that ends with 3 or more reps left is
further from failure than the app wants it, so the next target for that set
moves by more than one rep:

| Rated | Reps in reserve | Added to that set |
|---|---|---|
| RPE 8.5 and up, or unrated | 0 or 1 | nothing extra |
| RPE 7.5 to 8 | 2 | 1 |
| RPE 6.5 to 7 | 3 | 2 |
| RPE 6 and under | 4 or more | 3 |

Each step gives back one rep fewer than the rating claims. Halperin et al.
found people under-predict how many reps they have left by about one rep on
average, and that the guess is better close to failure and with lower reps,
so the table could have been bolder. It is not, because a target the person
misses reads as a failure and a target they beat does not, and because the
size of each step is a judgment: no study tests this table.

The same reps count toward the weight gate: a set 1 two short of the top with
4 in reserve has reached the top in the sense that matters.

**A target is a floor.** The line on the movement's last set opens
"Target, or more", where going past the figure costs no later set.

**Old ratings are not read.** Until the fix merged on 2026-11-16 the set card
carried a rating over from the set before, so earlier ratings were mostly
never chosen. `ratingsFrom` (2026-11-16) skips them. TestFlight 2.0.11 still
carries ratings over, so someone logging on it keeps writing them after that
day: if the first TestFlight build with the fix goes out later than
2026-11-16, move the date to that day.

## Breaks

| Days since the movement was last trained | Target |
|---|---|
| Up to 21 | The normal rule |
| 22 to 35 | Match last time |
| 36 to 84 | Last time's weight, two reps fewer on each set |
| Over 84 | About a tenth lighter (at least one weight step), last time's reps; on bodyweight, three reps fewer |

No study read for the audit gives these figures. They are coaching
convention, chosen small so that the first session back is one the person
finishes; the normal rule takes over from the next session. A gap is never counted, named or
judged anywhere in the app (owner decision, 2026-11-12).

## The first time

Added 2026-11-18. Every target above needs a last time. A movement with none
used to open with an empty weight and only its rep range: every swap, every
movement added to a workout, every movement of a new program. In the owner's
history that was 25 movements over 51 workouts, and on 10 of the 18 he came
back to, the starting weight changed the next time.

The recent read (the last 30 workouts) finding nothing does not mean never
trained. One wider read settles it (`native/src/lib/session.ts`,
`src/lib/firstTimeTargets.ts`):

- **Trained before, longer ago.** Its older sessions join the history and the
  usual rule takes it from there, which after that long is the way back in
  from the Breaks table.
- **Never trained.** Its first session finds the weight, as below.

**Set 1.** With nothing to go on, the card asks for a weight the person could
do the top of the range with, and the choice is theirs. When they have
trained a close relative in the last twelve weeks, set 1 opens on three
quarters of that movement's working weight, for its reps brought inside the
new range, and the card names the relative. A start is a place to begin, not
a target: it is not counted on Session complete and passing it says nothing.

**A close relative** is the same movement pattern (`movementProfiles.ts`) on
the same bar, dumbbells, kettlebell, Smith machine or cable, both sides or one
side alike. Never a machine: a machine's number belongs to that machine, its
levers and its stack, so a leg press says nothing about a hack squat. Never
across equipment either, and never onto a variant done far lighter than its
pattern's main lifts (a good morning beside a Romanian deadlift); that list is
in `firstTimeTargets.ts` and errs wide, since a name on it only loses the
head start.

**Three quarters** is a judgment. No study read gives the figure. Variants of
one movement on the same equipment differ by up to about a fifth (a front
squat against a back squat), and the two mistakes are not equal: a first set
that is too heavy is a grind or a miss on a movement the person has never
done, and one that is too light costs a set, which the next set corrects.

**Each later set follows the set before it.** What that set could have gone
to is its reps plus what its rating adds, by the same table as above:

| The set before | The next set |
|---|---|
| Two or more past the top of the range | Up, to the heaviest step the estimate still puts at the middle of the range, and never more than a quarter heavier |
| Two or more short of the bottom | Down, to where the estimate puts the middle of the range, for the bottom of the range |
| Anything between | The same weight, for one rep fewer than a set rated easy could have gone to, or two fewer than one that was not |

With no rep range, or on bodyweight, the weight stays and only the reps
follow.

Going down asks only for the bottom of the range because the estimate
promises more reps on a lighter weight than people get. The owner's own
history shows it both ways: he lost fewer reps than the estimate said when he
raised a weight (the 6 reps above) and gained fewer when he lowered one (80
for 8 on a pushdown, then 10 at 70 a session later, where the estimate says
13). At one weight he fell one rep or none from set 1 to set 2 in 11 of 19
first sessions and two or three in the other 8; a target is a floor, so an
unrated set asks for two fewer. Replayed over his 25 first sessions, unrated (`tests/firstTimeReplay.test.ts`), 26 of the
27 later sets he did at the target's weight reached the target. None of the
25 had a close relative behind it, so the start from a relative is tested on
made-up histories only and has not met real numbers yet.

One weight for every set of a movement is the rule everywhere else. A first
session breaks it on purpose: finding the weight is its job, and from the
second session the usual rule works from the weight most of its sets used.

## What the rule does not do

- It does not start a movement from a machine, from other equipment, or from
  a movement of another pattern (an incline press from a flat one). Those
  first sessions ask for the person's own pick and follow it.

- It never raises the weight with no rep range, or on bodyweight work: reps
  climb and the weight is the person's to move.
- It does not plan deloads. Coleman et al. 2024 (PeerJ,
  <https://peerj.com/articles/16777>; abstract from search results only) found
  a one-week deload in the middle of nine weeks of training gave no benefit.
