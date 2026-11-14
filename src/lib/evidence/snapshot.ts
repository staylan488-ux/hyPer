import type { EvidenceSnapshot } from './types';

export const beardsleyEvidenceSnapshot: EvidenceSnapshot = {
  "version": "2026.11.13-45eb9ea",
  "imported_at": "2026-11-13T19:40:57.966Z",
  "source_repo": "https://github.com/staylan488-ux/hypertrophy-coach",
  "source_ref": "main/references@45eb9eaa7752",
  "parser_version": "v0.3-rules-only",
  "rules": [
    {
      "id": "volume-track-volume-as-the-number-of-sets-taken-close-enough-to-fai",
      "domain": "volume",
      "statement": "Track volume as the number of sets taken close enough to failure to recruit high-threshold motor units.",
      "rationale": "\"Stimulating reps\" are the active ingredient. Tonnage is misleading if the sets are too easy.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-is-training-volume-286b8da6f427"
      ]
    },
    {
      "id": "volume-there-is-a-maximum-effective-dose-per-session-doing-more-set",
      "domain": "recovery",
      "statement": "There is a maximum effective dose per session. Doing more sets beyond this point adds fatigue (and muscle damage) without adding proportional growth stimulus.",
      "rationale": "\"Junk volume\" is real; stimulus plateaus while fatigue climbs.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-is-the-maximum-number-of-stimulating-reps-that-we-can-do-in-a-workout-for-a-muscle-group-9379d91bf2c"
      ]
    },
    {
      "id": "volume-if-you-need-more-volume-to-progress-but-are-hitting-the-per-",
      "domain": "frequency",
      "statement": "If you need more volume to progress but are hitting the per-session ceiling (performance/quality drop), split the volume into more sessions (frequency).",
      "rationale": "High frequency works mainly by allowing more high-quality work to be performed across the week, avoiding the \"junk\" zone of mega-sessions.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-determines-training-frequency-62ec783f908f"
      ]
    },
    {
      "id": "volume-expect-different-muscles-e-g-quads-vs-side-delts-to-have-dif",
      "domain": "volume",
      "statement": "Expect different muscles (e.g., quads vs. side delts) to have different maximum recoverable/adaptive volumes.",
      "rationale": "Recovery rates and damage susceptibility vary by muscle group and fiber type composition.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/does-maximum-weekly-training-volume-differ-between-muscles-5d1e6d2def93"
      ]
    },
    {
      "id": "volume-if-training-a-muscle-frequently-e-g-3-times-week-prioritize-",
      "domain": "frequency",
      "statement": "If training a muscle frequently (e.g., 3+ times/week), prioritize exercises with low connective tissue stress and lower delayed-onset muscle soreness (DOMS).",
      "rationale": "You cannot recover from high-damage exercise (like heavy, deep stretch-biased compounds) frequently enough to train effectively.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-can-we-select-exercises-to-fit-different-training-frequencies-4211c847a5e1"
      ]
    },
    {
      "id": "volume-if-you-train-to-failure-0-rir-expect-to-do-fewer-total-sets-",
      "domain": "recovery",
      "statement": "If you train to failure (0 RIR), expect to do fewer total sets than if you train at 2-3 RIR. Both can work, but you must account for the higher systemic fatigue of failure.",
      "rationale": "Failure generates maximum stimulating reps but maximizes fatigue.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-does-training-volume-differ-between-training-to-failure-avoiding-failure-and-using-advanced-techniques-90e26d57bca9"
      ]
    },
    {
      "id": "volume-avoid-gaps-longer-than-4-5-days-between-stimulating-exposure",
      "domain": "frequency",
      "statement": "Avoid gaps longer than ~4–5 days between stimulating exposures for a target muscle, as the anabolic signal decays.",
      "rationale": "Muscle protein synthesis and other growth signals are transient; waiting a full week might leave a gap (though this is nuanced).",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/does-muscle-loss-happen-within-a-training-week-880a986350c4"
      ]
    },
    {
      "id": "volume-keep-weight-static-and-add-reps-until-you-hit-the-top-of-a-r",
      "domain": "progression",
      "statement": "Keep weight static and add reps until you hit the top of a range. Then add weight and drop reps. This is the default hypertrophy progression.",
      "rationale": "It ensures \"progressive overload\" happens via confirmed capacity increase, not just ego-loading.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/why-is-progressive-overload-essential-for-hypertrophy-68757329a82d"
      ]
    },
    {
      "id": "volume-do-not-add-weekly-volume-sets-unless-you-have-stopped-progre",
      "domain": "volume",
      "statement": "Do not add weekly volume (sets) unless you have stopped progressing with your current volume and are recovering well.",
      "rationale": "More volume is not better if you are already growing; it just adds fatigue risk.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-does-training-volume-affect-muscle-growth-204022c86eed"
      ]
    },
    {
      "id": "volume-do-not-panic-if-performance-dips-for-one-session-look-for-tr",
      "domain": "volume",
      "statement": "Do not panic if performance dips for one session. Look for trends.",
      "rationale": "Fatigue masks fitness. A bad session does not mean you lost muscle.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/why-does-progress-not-always-happen-from-one-workout-to-the-next-cab534f6042b"
      ]
    },
    {
      "id": "volume-if-performance-stalls-regresses-for-multiple-sessions-despit",
      "domain": "progression",
      "statement": "If performance stalls/regresses for multiple sessions despite effort, or if joint pain accumulates, take a deload (reduce volume/effort).",
      "rationale": "You need to dissipate fatigue to express (and realize) adaptations.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/do-you-really-need-a-deload-64e7b4a4eb4f"
      ]
    },
    {
      "id": "volume-a-set-ends-when-you-can-no-longer-perform-a-rep-with-the-tar",
      "domain": "volume",
      "statement": "A set ends when you can no longer perform a rep with the target muscle doing the work (technique failure), even if you could cheat out more reps.",
      "rationale": "Stimulating reps must stimulate the target. Cheating shifts load elsewhere.",
      "confidence": "speculative",
      "sources": [
        "https://sandcresearch.medium.com/why-is-technique-important-for-hypertrophy-8134062df923"
      ]
    },
    {
      "id": "selection-prefer-exercises-where-the-target-muscle-has-the-best-mechan",
      "domain": "rom",
      "statement": "Prefer exercises where the target muscle has the best mechanical advantage at the hardest point of the ROM.",
      "rationale": "When the task gets hardest, the CNS allocates neural drive toward muscles that can produce force most effectively in that position (neuromechanical matching). That is what decides which muscle gets the highest activation (and therefore high tension).",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab",
        "https://sandcresearch.medium.com/does-leverage-determine-muscle-force-and-does-that-matter-for-hypertrophy-476971eb569c"
      ]
    },
    {
      "id": "selection-if-an-exercise-does-not-strongly-activate-the-target-fibers-",
      "domain": "exercise_selection",
      "statement": "If an exercise does not strongly activate the target fibers, don’t expect much hypertrophy in that muscle (even if you “feel” work elsewhere).",
      "rationale": "Mechanical tension in a fiber requires activation; low activation → low tension → little growth stimulus.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/can-muscle-fibers-grow-without-being-activated-7c920e94e099"
      ]
    },
    {
      "id": "selection-use-setup-changes-stance-joint-angles-torso-angle-machine-al",
      "domain": "exercise_selection",
      "statement": "Use setup changes (stance, joint angles, torso angle, machine alignment) to alter joint moment arms, but don’t guess blindly—think in terms of perpendicular distance (moment arm).",
      "rationale": "Moment arms (internal/external) govern mechanical advantage; small geometry changes can meaningfully shift which muscles are favored.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/the-internal-moment-arm-is-always-calculated-as-the-perpendicular-distance-so-the-force-vector-is-taken-into-account-automatically-64c6fb299104"
      ]
    },
    {
      "id": "selection-favor-exercises-that-are-hard-when-the-target-is-long-if-the",
      "domain": "exercise_selection",
      "statement": "Favor exercises that are hard when the target is long if the target is also highly activated there.",
      "rationale": "Stretch-mediated hypertrophy (SMH) is most plausible when high tension occurs at long muscle lengths.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/when-is-strength-training-at-long-muscle-lengths-beneficial-226264fc4f96"
      ]
    },
    {
      "id": "selection-don-t-expect-passive-tension-methods-e-g-stretching-to-repla",
      "domain": "rom",
      "statement": "Don’t expect passive tension methods (e.g., stretching) to replace loaded training for CSA; treat them as a different lever.",
      "rationale": "Passive mechanical tension appears limited for increasing fiber cross-sectional area (CSA) compared to activated, high-tension contractions.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/can-passive-mechanical-tension-stimulate-increases-in-muscle-fiber-cross-sectional-area-a4b581ea9551"
      ]
    },
    {
      "id": "selection-use-joint-angle-variations-and-sometimes-different-exercises",
      "domain": "rom",
      "statement": "Use joint angle variations (and sometimes different exercises) to shift which regions are most loaded—especially when bringing up weak regions.",
      "rationale": "Different regions can experience different mechanical stimuli; varying the movement can alter regional growth.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/what-is-regional-hypertrophy-and-how-does-it-happen-c1dafe3ce0a9"
      ]
    },
    {
      "id": "selection-when-the-goal-is-hypertrophy-not-skill-prefer-stable-options",
      "domain": "exercise_selection",
      "statement": "When the goal is hypertrophy (not skill), prefer stable options (machines, supported variations) that reduce balance demands.",
      "rationale": "Stability reduces the need to “spend” neural drive on control/balancing and can allow higher effective effort for the target muscle.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/should-you-use-free-weights-or-machines-for-strength-training-bc5fa86d3e20"
      ]
    },
    {
      "id": "selection-use-controlled-eccentrics-for-technique-but-avoid-exaggerate",
      "domain": "exercise_selection",
      "statement": "Use controlled eccentrics for technique, but avoid exaggerated slow lowering if it reduces total effective reps / effort.",
      "rationale": "Slowing eccentrics can increase fatigue and reduce performance without increasing growth.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/why-slowing-down-the-eccentric-phase-does-not-cause-more-muscle-growth-9d4e6cb7dd83"
      ]
    },
    {
      "id": "selection-use-constant-tension-no-lockout-when-it-helps-you-keep-the-t",
      "domain": "exercise_selection",
      "statement": "Use constant tension (no lockout) when it helps you keep the target loaded, but don’t assume it automatically increases hypertrophy.",
      "rationale": "The hypertrophy benefit is not guaranteed; it can mainly change fatigue and where in the ROM work occurs.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/does-keeping-constant-tension-on-a-muscle-increase-hypertrophy-b8faf7903e78"
      ]
    },
    {
      "id": "selection-prefer-resistance-profiles-machines-cables-bands-that-keep-t",
      "domain": "rom",
      "statement": "Prefer resistance profiles (machines/cables/bands) that keep the target challenged where it is recruited and capable of producing high force.",
      "rationale": "If resistance is high where the muscle is weak (or not recruited), you limit performance and reduce high-quality reps.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-can-exercise-strength-curves-affect-hypertrophy-906bfb210a88"
      ]
    },
    {
      "id": "selection-use-as-much-rom-as-you-can-while-maintaining-target-loading-",
      "domain": "rom",
      "statement": "Use as much ROM as you can while maintaining target loading and joint tolerance; full ROM is not automatically superior in every case.",
      "rationale": "ROM changes muscle length and leverage; the hypertrophy outcome depends on where tension is placed.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/does-a-full-range-of-motion-always-produce-more-muscle-growth-5bf7fc6e4b55"
      ]
    },
    {
      "id": "selection-if-form-changes-shift-moment-arms-away-from-the-target-the-s",
      "domain": "rom",
      "statement": "If form changes shift moment arms away from the target, the set stops being a “target muscle” set.",
      "rationale": "Technique controls leverage and coordination; breakdown often reallocates loading to other muscles.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/why-is-technique-important-for-hypertrophy-8134062df923"
      ]
    },
    {
      "id": "selection-choose-exercises-you-can-take-to-0-3-rir-consistently-and-so",
      "domain": "rom",
      "statement": "Choose exercises you can take to ~0–3 RIR consistently (and sometimes closer) without compromising safety.",
      "rationale": "The last reps require higher-threshold motor unit recruitment and produce more “stimulating reps.”",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-many-stimulating-reps-are-there-in-each-set-to-failure-9d179f594dd"
      ]
    },
    {
      "id": "selection-if-you-train-a-muscle-more-frequently-bias-toward-exercises-",
      "domain": "frequency",
      "statement": "If you train a muscle more frequently, bias toward exercises that produce less lingering disruption (and are easy to repeat with consistent technique).",
      "rationale": "Exercise selection interacts with recovery, soreness, and within-week scheduling.",
      "confidence": "solid",
      "sources": [
        "https://sandcresearch.medium.com/how-can-we-select-exercises-to-fit-different-training-frequencies-4211c847a5e1"
      ]
    },
    {
      "id": "selection-when-in-doubt-lean-on-beardsley-s-muscle-specific-selection-",
      "domain": "exercise_selection",
      "statement": "When in doubt, lean on Beardsley’s muscle-specific selection logic (moment arms, fiber anatomy, likely recruitment patterns).",
      "rationale": "Generic rules get you 80%; muscle-specific anatomy and leverage often decide the last 20%.",
      "confidence": "speculative",
      "sources": [
        "https://sandcresearch.medium.com/how-should-we-train-the-quadriceps-31ad002d0ae4",
        "https://sandcresearch.medium.com/how-can-we-best-train-the-hamstrings-1307fc6be59c",
        "https://sandcresearch.medium.com/how-should-we-train-the-gluteus-maximus-ac35d1bd3c39",
        "https://sandcresearch.medium.com/should-you-use-free-weights-or-machines-for-strength-training-bc5fa86d3e20",
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/why-is-technique-important-for-hypertrophy-8134062df923",
        "https://sandcresearch.medium.com/how-many-stimulating-reps-are-there-in-each-set-to-failure-9d179f594dd"
      ]
    },
    {
      "id": "rom-if-you-want-smh-then-ensure-the-target-muscle-is-highly-acti",
      "domain": "rom",
      "statement": "IF you want SMH, THEN ensure the target muscle is highly activated at the long length.",
      "rationale": "Titin filaments only \"lock\" and produce passive tension when the muscle is active. Passive stretching alone doesn't drive fiber growth.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57"
      ]
    },
    {
      "id": "rom-if-a-muscle-has-poor-leverage-in-the-stretch-then-do-not-exp",
      "domain": "rom",
      "statement": "IF a muscle has poor leverage in the stretch, THEN do not expect SMH from that position.",
      "rationale": "The CNS optimizes for mechanics (neuromechanical matching). If a muscle can't produce force effectively in the hole, it won't be recruited high enough to trigger SMH.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab"
      ]
    },
    {
      "id": "rom-if-you-want-to-break-an-smh-plateau-then-you-must-progressiv",
      "domain": "rom",
      "statement": "IF you want to break an SMH plateau, THEN you must progressively increase the Range of Motion.",
      "rationale": "As you add sarcomeres in series, the muscle effectively becomes \"longer,\" reducing the passive tension at the old end-range. You must go deeper to find the new tension threshold.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/does-a-full-range-of-motion-always-produce-more-muscle-growth-5bf7fc6e4b55"
      ]
    },
    {
      "id": "rom-if-you-want-thickness-transverse-hypertrophy-then-prioritize",
      "domain": "rom",
      "statement": "IF you want \"thickness\" (transverse hypertrophy), THEN prioritize active mechanical tension (force).",
      "rationale": "SMH drives longitudinal growth (length). Standard high-tension lifting (concentric/short-length) is still the primary driver for cross-sectional area.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/why-is-longitudinal-hypertrophy-after-strength-training-more-limited-than-transverse-hypertrophy-4e610af05fba"
      ]
    },
    {
      "id": "rom-if-you-train-at-short-lengths-only-then-you-risk-active-insu",
      "domain": "rom",
      "statement": "IF you train at short lengths only, THEN you risk active insufficiency and reduced functional range.",
      "rationale": "Muscles adapted only to short lengths may lose sarcomeres in series, reducing their force potential at longer lengths.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/when-is-strength-training-at-long-muscle-lengths-beneficial-226264fc4f96"
      ]
    },
    {
      "id": "rom-if-you-use-lengthened-partials-then-you-maximize-time-under-",
      "domain": "rom",
      "statement": "IF you use lengthened partials, THEN you maximize time-under-tension in the SMH zone.",
      "rationale": "Spending the entire set in the lengthened portion (e.g., bottom half of a curl/extension) ensures every rep contributes to the titin-stimulus, avoiding the \"wasted\" short-range work.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab"
      ]
    },
    {
      "id": "rom-if-the-exercise-is-hardest-at-the-bottom-then-it-is-an-smh-c",
      "domain": "exercise_selection",
      "statement": "IF the exercise is hardest at the bottom, THEN it is an SMH candidate only if the target muscle drives that movement.",
      "rationale": "Just because it's hard at the bottom doesn't mean your target is working. Verify leverage (e.g., glutes vs. quads in a deep squat).",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab"
      ]
    },
    {
      "id": "rom-if-you-want-to-target-the-rectus-femoris-then-avoid-hip-exte",
      "domain": "rom",
      "statement": "IF you want to target the Rectus Femoris, THEN avoid hip-extension movements (squats) and use knee-extension only.",
      "rationale": "The RF acts as a hip flexor; extending the hip (squatting) shortens it at one end while lengthening at the other, preventing true long-length stimulus.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/how-should-we-train-the-quadriceps-31ad002d0ae4"
      ]
    },
    {
      "id": "rom-if-you-are-an-advanced-lifter-then-consider-static-stretchin",
      "domain": "rom",
      "statement": "IF you are an advanced lifter, THEN consider static stretching with activation (loaded stretching).",
      "rationale": "Once dynamic ROM is maxed out, loaded static holds may provide the only remaining avenue for further longitudinal growth.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab"
      ]
    },
    {
      "id": "rom-if-you-want-to-target-the-distal-joint-adjacent-region-then-",
      "domain": "rom",
      "statement": "IF you want to target the distal (joint-adjacent) region, THEN prioritize SMH.",
      "rationale": "Longitudinal growth often manifests physically as \"filling out\" the muscle near the tendon/joint.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/when-is-strength-training-at-long-muscle-lengths-beneficial-226264fc4f96"
      ]
    },
    {
      "id": "rom-if-you-slow-the-eccentric-excessively-then-you-likely-increa",
      "domain": "recovery",
      "statement": "IF you slow the eccentric excessively, THEN you likely increase fatigue without more growth.",
      "rationale": "While the eccentric is key for SMH, super-slow tempos reduce the total mechanical work you can perform and disproportionately increase central fatigue.",
      "confidence": "emerging",
      "sources": [
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab"
      ]
    },
    {
      "id": "rom-if-a-muscle-is-hard-to-activate-high-threshold-then-it-may-t",
      "domain": "frequency",
      "statement": "IF a muscle is hard to activate (high threshold), THEN it may tolerate higher frequency.",
      "rationale": "Muscles like the quads often have lower voluntary activation levels, meaning they sustain less internal damage per set than muscles like hamstrings.",
      "confidence": "speculative",
      "sources": [
        "https://sandcresearch.medium.com/how-should-we-train-the-quadriceps-31ad002d0ae4",
        "https://sandcresearch.medium.com/what-is-stretch-mediated-hypertrophy-and-how-does-it-work-e5d9cf5a0c57",
        "https://sandcresearch.medium.com/what-is-the-principle-of-neuromechanical-matching-6e214c299dab",
        "https://sandcresearch.medium.com/when-is-strength-training-at-long-muscle-lengths-beneficial-226264fc4f96",
        "https://sandcresearch.medium.com/why-is-longitudinal-hypertrophy-after-strength-training-more-limited-than-transverse-hypertrophy-4e610af05fba"
      ]
    }
  ]
};
