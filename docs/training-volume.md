# Weekly sets per muscle: what the numbers rest on

The rules live in `src/lib/muscleVolume.ts` (counting, bands, the program's
week, done of planned, the usual week) and `src/lib/volumeSuggestions.ts`
(one-tap fixes for a program). This note says where each number comes from.
Read 2026-11-12.

## Sources

- **Pelland et al.**, "The Resistance Training Dose-Response: Meta-Regressions
  Exploring the Effects of Weekly Volume and Frequency on Muscle Hypertrophy
  and Strength Gain", Sports Medicine,
  <https://doi.org/10.1007/s40279-025-02344-w>. The published article is behind
  a login; the full text read here is the open preprint, SportRxiv 460 v2
  (last modified September 2024):
  <https://sportrxiv.org/index.php/server/preprint/view/460>. 67 studies,
  2,058 participants. If the published numbers differ, the published ones win.
- **Remmert et al.**, "Is There Too Much of a Good Thing? Meta-Regressions of
  the Effect of Per-Session Volume on Hypertrophy and Strength", the same
  group's companion analysis, SportRxiv 537 (last modified March 2025):
  <https://sportrxiv.org/index.php/server/preprint/view/537>.
- The app's own research notes, `src/lib/evidence/snapshot.ts` (imported from
  Chris Beardsley's articles). The ones used here:
  `volume-track-volume-as-the-number-of-sets-taken-close-enough-to-fai` (count
  hard sets), `volume-do-not-add-weekly-volume-sets-unless-you-have-stopped-progre`
  (more sets is not a default) and
  `volume-expect-different-muscles-e-g-quads-vs-side-delts-to-have-dif`.

## Counting: 1 for the main muscle, 0.5 for the second

Pelland et al. counted every study three ways: indirect (synergist) sets as 1
("total"), 0.5 ("fractional") or 0 ("direct"). For hypertrophy the fractional
count fit best, with strong evidence over total and very strong evidence over
direct (2 × log Bayes factor 9.48 and 10.29; section 4.4 of the preprint). The
app already counted this way (`computeWeeklyVolume`), and the new rules keep it.

A press filed under `shoulders` with `front_delts` second is one muscle, so it
counts once, not 1.5.

## The three bands

Same edges for every muscle, in fractional sets a week:

| Band | Sets a week | Rests on |
|---|---|---|
| Low | under 4 | Table 2A of Pelland et al.: 4 fractional sets is the minimum effective dose, the smallest weekly volume whose predicted growth passes the smallest detectable effect (2.05%). |
| Solid | 4 to 10 | The "higher efficiency" tier, 5 to 10 sets, where about 6 more sets buy one more detectable step of growth. |
| High | above 10 | From 11 sets each further step costs more sets: about 8.5 (11 to 18), 10.75 (19 to 29), 12.5 (30 to 42). Growth still rises. |

The brief started from "solid from 4, high above about 12". The paper's own
tier boundary is between 10 and 11, so high starts above 10. The median study
volume was 10.5 fractional sets a week, so "solid" covers what most of the
research actually tested.

**No upper limit.** The best-fitting hypertrophy model was a square-root curve:
diminishing returns, no plateau and no inverted U (section 5.4: "no clear
plateau"). Few studies went past about 25 sets, so the top end is uncertain,
but nothing supports a maximum. "High" is therefore a plain description, never
a warning and never red. The old maximum (MRV) numbers came from a coaching
convention, not from this data.

**The same edges for every muscle.** The app's research notes expect muscles
to differ in how much they can recover from, but no paper here gives
per-muscle numbers, so the bands do not pretend to.

## Where the bands are used

Only on a program's design: every day of a program done once. A person's own
weeks are counted (this week as done of planned, the usual week as a plain
average) and never given a band word. Training fewer sessions than the plan is
not graded anywhere (owner decision, 2026-11-12).

## Suggestions

Made only for the main muscles (chest, back, quads, hamstrings, glutes, side
delts, biceps, triceps) when the program's week puts one in the low band. They
aim at 4 sets, the bottom of solid:

- First, raise a movement the program already has for that muscle, never past
  5 sets. Both papers find more sets keep helping inside one session too
  (Remmert et al. put the point where more sets stop being detectably better at
  about 11 fractional sets per muscle per session), so a few more sets on an
  existing movement is the smallest change that works.
- Otherwise, add 2 or 3 sets of a staple from the library to the day with the
  fewest sets that already trains that half of the body, preferring equipment
  the program already uses. Pelland et al. found frequency adds little once
  sets are equal, so the day is chosen for room, not for spreading.
- The research note "do not add weekly volume unless you have stopped
  progressing" is about adding past what a program already gives. These
  suggestions only lift a program to the minimum effective dose.

## Frequency

Pelland et al.: with weekly sets equal, more sessions a week made little
difference to growth (posterior probability of a positive slope 91.3%, "compatible
with negligible effects"). This is why a muscle's sets a week, not how often it
is trained, is what the app counts.
