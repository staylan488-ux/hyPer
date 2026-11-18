# How to do a movement: the lines and what they rest on

The movement sheet of a live workout has a folding row, "How to do it": the
setup, each rep, and why. This page is where the lines come from, which parts
are research and which are coaching judgment. Written 2026-11-18.

The lines are in [src/lib/movementHowTo.ts](../src/lib/movementHowTo.ts).
Nothing is stored: a movement's lines come from its name and equipment, the
same way its swap matches do ([movement-swaps.md](movement-swaps.md)).

## How a movement gets its lines

1. Its name gives it a pattern and an equipment kind
   (`src/lib/movementProfiles.ts`): a squat on a machine, a curl on a cable.
2. Each pattern has an ordered list of variants. The first whose name and
   equipment fit wins: a Hack Squat gets the hack squat lines, a Goblet Squat
   its own, a plain barbell squat the pattern's standard form.
3. No fit, no row. That covers a name the rules cannot place, a pattern with
   no standard form for that equipment (a leg curl with a dumbbell), skills
   and odd variants the lines would be wrong for (`NOT_COVERED`: a pistol
   squat, a handstand push-up, anything banded), and one-leg versions of the
   squat, leg press, hinge, deadlift and hip thrust.

Showing nothing is the safe failure. A wrong cue is worse than a missing one.

## The rule for naming a study

A "why" names a study only when that study's finding is the reason for a cue
in the same entry. One study at most, by first author and year, in brackets.
Everything else is judgment and names nothing. The tests check that a study
is named exactly when the entry carries one, that every listed study is used,
and that each has its reference here.

Each finding below was read before it was written into a line. Most are one
study, usually eight to twelve weeks in people new to training, so each is a
reason for a cue and not a law.

## The studies

- **Deep squats** (Kubo et al. 2019). Ten weeks, 17 men, full squats against
  half squats: glutes +6.7% against +2.2%, adductors +6.2% against +2.7%,
  with no growth in the rectus femoris or hamstrings either way. Kubo,
  Ikebukuro and Yata, European Journal of Applied Physiology 2019,
  <https://doi.org/10.1007/s00421-019-04181-y>. Behind "go below parallel" on
  the barbell and Smith squat.
- **Machines and free weights** (Haugen et al. 2023). A pooled analysis of
  13 studies found no difference in muscle growth. BMC Sports Science,
  Medicine and Rehabilitation 15:103,
  <https://doi.org/10.1186/s13102-023-00713-4>. Named on the hack squat, leg
  press, machine chest press and machine shoulder press, the lifts those
  studies used.
- **Leaning back on the leg extension** (Larsen et al. 2025). Ten weeks, 22
  untrained men, one leg with the hips at 40 degrees and one at 90: the
  rectus femoris grew more leaned back, the vastus lateralis the same.
  Journal of Sports Sciences 43(2), <https://pubmed.ncbi.nlm.nih.gov/39699974/>.
- **Seated leg curls** (Maeo et al. 2021). Twelve weeks, one leg each way:
  hamstrings +14% seated against +9% lying. Medicine & Science in Sports &
  Exercise 53(4):825, <https://pubmed.ncbi.nlm.nih.gov/33009197/>. "Lean
  forward" on the seated curl follows from the same reasoning (more bend at
  the hip, longer hamstrings); the study did not test leaning.
- **Overhead triceps extensions** (Maeo et al. 2023). Twelve weeks, one arm
  each way on a cable: triceps +19.9% overhead against +13.9% with the arm by
  the side. European Journal of Sport Science 23(7):1240,
  <https://pubmed.ncbi.nlm.nih.gov/35819335/>.
- **Standing calf raises** (Kinoshita et al. 2023). Twelve weeks, one leg
  each way: the gastrocnemius grew 9 to 12% standing and about 1% seated.
  Frontiers in Physiology 14:1272106,
  <https://doi.org/10.3389/fphys.2023.1272106>.
- **The stretch on a calf raise** (Kassiano et al. 2023). Eight weeks, 42
  young women on a leg-press calf raise: reps kept to the bottom part of the
  range grew the medial gastrocnemius 15.2%, more than full reps or reps kept
  to the top part. Journal of Strength and Conditioning Research 2023,
  <https://pubmed.ncbi.nlm.nih.gov/37015016/>. The line asks for a full rep
  with a pause in the stretch, not for partial reps.
- **The incline press** (Chaves et al. 2020). Eight weeks in untrained men:
  the upper chest thickened most with the incline press. International
  Journal of Exercise Science 13(6):859,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC7449336/>.
- **Cable and dumbbell lateral raises** (Larsen et al. 2025). Eight weeks,
  one arm each: no difference in side delt growth. Frontiers in Physiology,
  <https://doi.org/10.3389/fphys.2025.1611468>.
- **The bottom half of a preacher curl** (Pedrosa et al. 2023). Eight weeks,
  19 untrained young women, one arm in the bottom half of the range and one
  in the top half: the lower biceps grew more and the full-range strength
  rose more with the bottom half; the middle of the biceps grew the same.
  Sports 11(2):39, <https://pubmed.ncbi.nlm.nih.gov/36828324/>.
- **Hip thrusts and squats** (Plotkin et al. 2023). Nine weeks, 34 untrained
  adults: the glutes grew the same with either, the thighs more with squats.
  Frontiers in Physiology 14:1279170,
  <https://doi.org/10.3389/fphys.2023.1279170>.
- **Curls and rows** (Mannarino et al. 2021). Eight weeks, 10 untrained men,
  one arm curling and one rowing: elbow flexors +11.06% against +5.16%.
  Journal of Strength and Conditioning Research 35(10):2677,
  <https://doi.org/10.1519/JSC.0000000000003234>.

## Judgment, not research

Every setup line, every rep line, and every "why" with no study. They are
the cues a coach gives for that movement: where the pad goes, where the bar
touches, what moves and what stays still, and the usual way the movement
goes wrong. Three that come up often:

- **"Pause in the stretch" and "lower all the way".** The studies above
  favour the long end of the range for the calves, hamstrings, triceps and
  biceps. The lines carry that to flies, pulldowns and rows as a judgment,
  and name no study there.
- **Angles and counts** ("about 45 degrees", "30 to 45 degrees", "a count of
  two", "once you can do 12, add weight") are round coaching figures.
- **Nothing here is about pain or injury.** "Start lighter than you think" on
  the adduction machine is about a muscle new to the movement, and is the
  only line of its kind.

## What it does not do

- It shows no pictures or video.
- It does not know the person's machine: "if the seat back moves" is as far
  as it goes.
- It says nothing for a movement it cannot place, and never guesses.
- It changes nothing in the database.

## Adding or changing a line

Add a variant above the pattern's standard form, with a `name` rule or an
`equipment` kind. Keep each line under 150 characters, one or two plain
sentences. Read a study before naming it, add it to `HOW_TO_STUDIES` and to
the list above, and name it only in an entry whose cue it explains.
`tests/movementHowTo.test.ts` checks the rest.
