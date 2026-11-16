# Swapping a movement: how the closest matches are chosen

When a movement is swapped, in a workout or in the program editor, the picker
opens on its closest matches: the movements that train the same muscles the
same way, each with one line saying what stays the same and what changes, and
at most one research finding that bears on the swap. The aim is that nobody
has to leave the app to ask what to do instead.

The rules are in `src/lib/movementProfiles.ts` (what a movement trains) and
`src/lib/swapSuggestions.ts` (how two movements compare). This note says what
each rests on, and which parts are judgment. Written 2026-11-15.

## What a match is judged on

In this order of weight:

1. **The muscle parts it shares with the original (60%).** The library's one
   main muscle is too coarse: a leg extension and a squat are both "quads".
   A profile lists the parts a pattern trains, 1 for a part trained directly
   and 0.5 for one that helps, the same two weights weekly sets are counted
   with.
   A match must cover at least half of what the original trains.
2. **How near the movement is (30%).** The same pattern scores 1 (a hack
   squat is a squat). Related patterns have a written nearness (`NEAR`): a leg
   press is 0.9 from a squat, a lunge 0.7, a leg extension 0.3.
3. **Muscle length (10%).** A match that trains the muscle at a shorter length
   than the original loses this share; one that trains it longer gains a
   little.

Equipment never lowers a match. It only spreads the list: each pick on the
same equipment counts slightly against the next, so the five matches cover
machines, a Smith machine, a bar and dumbbells where the library has them.
The usual reason for a swap is the equipment (taken, missing, or not
tolerated), and the app does not know which, or what a person's gym holds.

Three small deductions, all judgment: a movement whose load is limited by
something other than the target muscle (a goblet hold, bodyweight); equipment
few gyms have (pendulum and belt squat machines); and one side at a time for
a movement done with both.

The weights and the nearness table are choices, not findings. The tests in
`tests/swapSuggestions.test.ts` pin what they produce for the common lifts.

## What the evidence decides

Each of these changes which movements count as a match.

- **Machines and free weights are equals for growth.** Haugen et al. pooled
  13 studies that compared them directly and found no difference in
  hypertrophy ("Effect of free-weight vs. machine-based strength training on
  maximal strength, hypertrophy and jump performance", BMC Sports Science,
  Medicine and Rehabilitation 15:103, 2023,
  <https://doi.org/10.1186/s13102-023-00713-4>). So a hack squat is a full
  match for a barbell squat, not a second-best. Shown as a note only for the
  big lifts those studies used (squats, presses, rows, pulls) and only when
  the matches cross from one kind to the other.
- **A squat is not a leg extension.** Ten weeks of squats grew the vasti,
  glutes and adductors and left the rectus femoris and hamstrings unchanged
  (Kubo, Ikebukuro and Yata, European Journal of Applied Physiology 2019,
  <https://doi.org/10.1007/s00421-019-04181-y>). Leg extensions grew the
  rectus femoris in every region measured (Zabaleta-Korta et al., Journal of
  Sports Sciences 39(20):2298, 2021,
  <https://pubmed.ncbi.nlm.nih.gov/34743671/>). So the quads are two parts
  here, a leg extension is never a match for a squat, and a squat offered for
  a leg extension says "No rectus femoris".
- **Seated leg curls beat lying ones.** Twelve weeks, one leg each way:
  hamstrings +14% seated against +9% lying (Maeo et al., Medicine & Science
  in Sports & Exercise 53(4):825, 2021,
  <https://pubmed.ncbi.nlm.nih.gov/33009197/>). The seated curl is marked as
  long-length, so it leads for a lying curl ("more stretch") and a lying curl
  offered for it says "less stretch".
- **Overhead triceps extensions beat pushdowns.** Twelve weeks, one arm each
  way on a cable: whole triceps +19.9% overhead against +13.9% with the arm by
  the side (Maeo et al., European Journal of Sport Science 23(7):1240, 2023,
  <https://pubmed.ncbi.nlm.nih.gov/35819335/>). Marked the same way.
- **Standing calf raises beat seated ones.** Twelve weeks, one leg each way:
  the gastrocnemius grew 9 to 12% standing and about 1% seated, the soleus the
  same in both (Kinoshita et al., Frontiers in Physiology 14:1272106, 2023,
  <https://doi.org/10.3389/fphys.2023.1272106>). A seated raise is filed as
  soleus only.
- **The incline press grows the upper chest more.** Eight weeks in untrained
  men: the upper part of the chest thickened most with the incline press
  (Chaves et al., International Journal of Exercise Science 13(6):859, 2020,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC7449336/>). The chest is two parts,
  and a flat press offered for an incline one says "Less upper chest".
- **Cable and dumbbell lateral raises are equals.** Eight weeks, one arm
  each: no difference in side delt growth, although the cable was expected to
  win (Larsen et al., Frontiers in Physiology 2025,
  <https://doi.org/10.3389/fphys.2025.1611468>). So no lateral raise is marked
  as long-length.

## Judgment, not evidence

- **Rows and pulldowns.** A row is filed as upper back first and lats second,
  a pulldown the other way round, so each is offered for the other only after
  its own kind, as "Less lats" or "Less upper back". No study compares their
  growth directly.
- **"Easier on the lower back".** Said when the original has the lower back
  hold the load (a bar on the back, a hinge, a bent-over barbell row) and the
  match does not (a hack squat, a leg press, a cable or supported row). It
  describes the loading, and claims nothing about pain or injury.
- **"Hard to load heavy".** A goblet squat or a push-up for a barbell lift:
  the same movement, limited by the hold or by bodyweight.
- **Curls.** Incline and Bayesian curls are marked long-length because the
  shoulder is extended. Kassiano et al. (International Journal of Sports
  Medicine 2025) found incline curls grew the upper part of the elbow flexors
  more and preacher curls the lower part, in untrained women; that is too
  narrow to rank one over the other, so the app shows no note for curls.
- **Kettlebell swings** are never offered as a match: they are done fast and
  far from failure.

## What it does not do

- A movement whose name the rules cannot place gets no matches, and the
  picker shows its usual list. Better nothing than a guess.
- Bodyweight skills are matched only to each other.
- It reads no history and no equipment setting, because the app stores none.
- It changes nothing in the database: profiles come from names.
