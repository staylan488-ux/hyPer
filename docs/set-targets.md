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

**Old ratings are not read.** Until the build of 2026-11-13 the set card
carried a rating over from the set before, so earlier ratings were mostly
never chosen. `ratingsFrom` skips them. Someone still logging on an older
build keeps writing carried-over ratings after that day; move the date when
the fixed build is the one in use.

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

## What the rule does not do

- It never raises the weight with no rep range, or on bodyweight work: reps
  climb and the weight is the person's to move.
- It does not plan deloads. Coleman et al. 2024 (PeerJ,
  <https://peerj.com/articles/16777>; abstract from search results only) found
  a one-week deload in the middle of nine weeks of training gave no benefit.
