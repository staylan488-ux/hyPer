# Calories and protein: what the numbers rest on

The calculator is `src/lib/nutritionCalculator.ts`. The learned daily burn is
`src/lib/adaptiveExpenditure.ts`, on the weight trend in
`src/lib/weightTrend.ts`. The offer made from weigh-ins alone is
`src/lib/weightNudge.ts`, and the rails on the AI suggestion are in
`src/lib/nutritionCoach.ts`. This note says where each number comes from and
which are a judgment, not a finding. Read 2026-11-13, for the training
science audit of that day.

## Sources

- **Iraki et al. 2019**, "Nutrition Recommendations for Bodybuilders in the
  Off-Season: A Narrative Review", Sports,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/>. Recommendations read.
- **Morton et al. 2018**, "A systematic review, meta-analysis and
  meta-regression of the effect of protein supplementation on resistance
  training-induced gains in muscle mass and strength in healthy adults",
  British Journal of Sports Medicine,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC5867436/>. Abstract and the key
  result read.
- **Helms et al. 2023**, a small trial of small and large energy surpluses in
  trained lifters, Sports Medicine - Open,
  <https://openrepository.aut.ac.nz/items/de93156f-23a9-492a-8a85-438233a7e6bf>.
  Abstract from search results only.
- The calculator's own comments name the rest (FAO/WHO/UNU 2004 for activity
  levels, Forbes et al. 1986 for the energy in a kilo gained).

## The calculator

| Rule | Rests on |
|---|---|
| Gaining pace: 0.25% of bodyweight a week (lean bulk) or 0.5% (bulk), adjustable from 0.15% to 0.75% | Iraki et al.: 0.25 to 0.5% a week for newer and intermediate lifters, slower for advanced. Helms et al.: a faster gain mostly added fat. |
| Surplus never over 20% of the daily burn | Iraki et al.: 10 to 20% over maintenance. |
| Protein: 1.8 g per kg of reference weight, or 2.0 g per kg of lean mass when body fat is known (2.2 and 2.4 on a cut) | Morton et al.: the benefit for muscle levels off near 1.6 g per kg, with real uncertainty up to 2.2. The target is a floor: going over is fine. |
| Fat: 25% of calories (22% on a cut), never under 20% or 0.6 g per kg, never over 35% | Iraki et al.: 20 to 35% of calories. |
| A cut never deeper than 25% under the daily burn, and never under the resting rate | The calculator's own guards. |

The audit changed none of these.

## The learned daily burn

Burn = what was eaten minus what the weight did, over three weeks, updated on
Mondays and moved at most 5% a week. The method is the one the better
nutrition apps use; the gates and windows are engineering judgment, not a
study.

- **Three weeks first, four when three do not hold enough.** Learning needs
  14 logged days and 10 weigh-ins. Inside three weeks that is food logged on
  two days in three; the owner sat right at that edge for months and the
  learning never switched on. When three weeks fall short, the same counts are
  taken over four. A four-week measurement is trusted a little less at first
  (a quarter of the way from the formula's figure, where a three-week one
  starts at 35%) and is never called measured. Someone who logs most days
  never reaches the wider window.
- **A half-logged day is left out.** A day counts once it passes half the
  resting rate, but lunch alone can do that. So a day under 60% of the
  person's own usual logged day (the median of their logged days, once there
  are seven) is left out too. Leaving out a true light day reads the burn a
  little high; counting a half-logged one reads it low and pulls the target
  down, which for someone gaining is the wrong direction.

## The offer from weigh-ins alone

Until a burn is learned, nothing reacted to the scale. Now, for a gaining goal
only, a weight that has sat flat or fallen for three weeks on the target as it
stands brings one offer: "Weight flat for 3 weeks. Your goal is about 0.5 lb a
week.", with a raise of 100 to 150 kcal the person can take or leave.

- It needs six weigh-in days across at least two of the three weeks, one of
  them in the last week, and none of it inside the first week of a new goal.
- Flat means a trend under 0.05 kg (about 0.1 lb) a week. A goal slower than
  0.1 kg a week gets no offer: three weeks of scale readings cannot tell it
  from flat.
- The raise is the surplus the trend says is missing, in steps of 25 kcal,
  held to 100 to 150. On a flat weight that is under the low end of the 10 to
  20% surplus Iraki et al. describe.
- The target must have stood for the three weeks read, so one raise never
  brings the next a week later. A target typed by hand never gets the offer,
  and once a burn is learned the Monday update takes over.
- There is no matching offer to eat less. Lowering a target from the scale
  alone is how under-eating spirals start.

## The AI target suggestion

The suggestion used to be held only to hard rails (protein anywhere from 50 g
to 400 g, whatever the person's size). With a weigh-in on file it is now held
to the calculator's own ranges for that person: calories from 25% under the
daily burn (never under the resting rate) to 20% over it, protein from 1.6 to
2.4 g per kg of reference weight and never over 40% of calories, fat from 20
to 35% of calories and never under 0.6 g per kg. Carbs take what is left. A
figure that was moved is named under the suggestion, since the model's
reasoning was written for its own number. The person still reviews and edits
before anything is saved.
