/**
 * How to do a movement, in three short lines: the setup, each rep, and why.
 *
 * Written per kind of movement (the pattern its profile gives it,
 * src/lib/movementProfiles.ts) and, where the technique differs, per
 * equipment or named variant. So the lines cover the shared library, the
 * movements production holds that the repo does not, and the ones people
 * type in, as far as their names can be placed. A name no rule knows, or a
 * skill these lines would be wrong for, gets nothing: better no row than a
 * guess.
 *
 * A study is named in a "why" only when its finding is the reason for a cue
 * in the same entry. Everything else is coaching judgment and says so by
 * naming no study. The references, what each study found and its limits are
 * in docs/movement-how-to.md.
 */
import { movementProfile, type EquipmentKind, type MovementPattern } from '@/lib/movementProfiles';
import type { Exercise } from '@/types';

/** The studies a "why" may name. `label` is how the app shows it. */
export const HOW_TO_STUDIES = {
  kubo2019: { label: 'Kubo 2019', url: 'https://doi.org/10.1007/s00421-019-04181-y' },
  haugen2023: { label: 'Haugen 2023', url: 'https://doi.org/10.1186/s13102-023-00713-4' },
  larsen2025hip: { label: 'Larsen 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/39699974/' },
  maeo2021: { label: 'Maeo 2021', url: 'https://pubmed.ncbi.nlm.nih.gov/33009197/' },
  maeo2023: { label: 'Maeo 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/35819335/' },
  kinoshita2023: { label: 'Kinoshita 2023', url: 'https://doi.org/10.3389/fphys.2023.1272106' },
  kassiano2023: { label: 'Kassiano 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/37015016/' },
  chaves2020: { label: 'Chaves 2020', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7449336/' },
  larsen2025raise: { label: 'Larsen 2025', url: 'https://doi.org/10.3389/fphys.2025.1611468' },
  pedrosa2023: { label: 'Pedrosa 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36828324/' },
  plotkin2023: { label: 'Plotkin 2023', url: 'https://doi.org/10.3389/fphys.2023.1279170' },
  mannarino2021: { label: 'Mannarino 2021', url: 'https://doi.org/10.1519/JSC.0000000000003234' },
} as const satisfies Record<string, { label: string; url: string }>;

export type HowToStudy = keyof typeof HOW_TO_STUDIES;

export interface HowTo {
  /** Where the body and the equipment go before the first rep. */
  setup: string;
  /** What one rep is. */
  rep: string;
  /** The reason behind a cue above, with its study in brackets when it has one. */
  why: string;
  /** The study the why names. */
  study?: HowToStudy;
}

/** One way a pattern is done. With no `name` and no `equipment` it is the pattern's standard form. */
type Variant = HowTo & {
  /** Matches the name in lower case with punctuation as spaces. */
  name?: RegExp;
  equipment?: EquipmentKind | readonly EquipmentKind[];
};

const HAUGEN = 'Machines build as much muscle as free weights (Haugen 2023).';
const MAEO_TRICEPS = 'Arms overhead stretch the triceps, and it grew more this way than with the arms by the sides (Maeo 2023).';
const MANNARINO = 'Curls grew the biceps more than rows did (Mannarino 2021), so rows alone do not cover them.';
const PLOTKIN = 'Hip thrusts grew the glutes as much as squats did and the thighs less (Plotkin 2023), so they add glute work without more leg work.';
const AB_CURL = 'Your abs bend your spine. If your hips fold instead, your hip flexors are doing the work.';
const HIP_CURL = 'The curl of the hips at the top is the ab part. Below that it is mostly hip flexors.';

/**
 * First match wins. A pattern whose last entry has a condition has no
 * standard form: its other variants get nothing.
 */
export const HOW_TO: Record<MovementPattern, readonly Variant[]> = {
  squat: [
    {
      name: /\b(hack|pendulum)\b/,
      setup: 'Feet shoulder width in the middle of the plate. Back and hips flat on the pad.',
      rep: 'Lower until your hips are below your knees with your heels down. Drive up without snapping your knees straight.',
      why: `The pad holds your back, so your legs are the limit. ${HAUGEN}`,
      study: 'haugen2023',
    },
    {
      name: /\bbelt\b/,
      setup: 'Belt low on your hips, not your waist. Feet shoulder width, hands on the rail for balance only.',
      rep: 'Sit straight down as deep as your heels stay flat. Stand without pulling on the rail.',
      why: 'The load hangs from your hips, so your back carries none of it.',
    },
    {
      name: /\bgoblet\b/,
      setup: 'Hold one dumbbell upright against your chest, elbows under it. Feet a little wider than your hips.',
      rep: 'Sit straight down between your heels until your elbows touch the inside of your knees. Stand without your chest dropping.',
      why: 'The weight in front keeps you upright, which makes depth easy. Once it is heavy, your arms give out before your legs.',
    },
    {
      name: /\bfront\b/,
      setup: 'Bar on the front of your shoulders, close to your throat, elbows high. Feet shoulder width.',
      rep: 'Sit straight down and keep your elbows up the whole way. Go as deep as your chest stays tall.',
      why: 'The bar in front keeps your back upright, so the quads do more of the work and the lower back less.',
    },
    {
      equipment: 'smith',
      setup: 'Bar across your upper back, feet a little ahead of the bar and shoulder width, toes slightly out.',
      rep: 'Sit down until your hips pass your knees. Stand without bouncing out of the bottom.',
      why: 'Depth is what counts. Deep squats grew the glutes and inner thighs more than twice as much as half squats (Kubo 2019).',
      study: 'kubo2019',
    },
    {
      equipment: 'bodyweight',
      setup: 'Feet shoulder width, toes slightly out, arms out in front for balance.',
      rep: 'Sit as deep as you can with your heels down. Take three seconds on the way down.',
      why: 'With no load, depth and a slow way down are what make the set hard.',
    },
    {
      setup: 'Bar on your upper back, not your neck. Feet shoulder width, toes slightly out. Big breath and brace before each rep.',
      rep: 'Bend hips and knees together. Go below parallel if your heels stay down, then stand without your hips rising first.',
      why: 'Depth is what counts. Deep squats grew the glutes and inner thighs more than twice as much as half squats (Kubo 2019).',
      study: 'kubo2019',
    },
  ],
  leg_press: [
    {
      setup: 'Feet shoulder width in the middle of the plate. Hips and lower back stay on the pad.',
      rep: 'Lower until your knees are near your chest, stopping before your hips roll off the pad. Push through the whole foot.',
      why: `It trains what a squat trains with your back supported. ${HAUGEN}`,
      study: 'haugen2023',
    },
  ],
  lunge: [
    {
      name: /\bsplit squat\b/,
      setup: 'Back foot on a bench, laces down. Front foot far enough ahead that its heel stays down at the bottom.',
      rep: 'Drop your back knee straight down. Keep nearly all your weight on the front leg.',
      why: 'One leg at a time works the legs hard with much less weight on your back.',
    },
    {
      name: /\bstep ups?\b/,
      setup: 'Whole foot on a box about knee height.',
      rep: 'Stand up with the top leg only, without pushing off the floor. Lower for a count of two.',
      why: 'The slow way down is the part the other leg cannot help with.',
    },
    {
      setup: 'Feet hip width, weights at your sides if you use them.',
      rep: 'Take a long step and lower your back knee to just above the floor. Push through the front heel.',
      why: 'A longer step puts more of the work on the glutes, a shorter one on the quads.',
    },
  ],
  knee_extension: [
    {
      equipment: 'machine',
      setup: "Knees in line with the machine's pivot, pad just above your ankles. If the seat back moves, lean it back.",
      rep: 'Straighten your legs fully and hold for a moment. Lower slowly, all the way.',
      why: 'Leaning back stretches the one quad muscle squats miss, and it grew more that way (Larsen 2025).',
      study: 'larsen2025hip',
    },
  ],
  hinge: [
    {
      name: /\bgood morning\b/,
      setup: 'Bar on your upper back as for a squat. Feet hip width, knees soft.',
      rep: 'Push your hips back until your chest is near level with the floor, back flat. Stand by driving your hips forward.',
      why: 'Start very light. The bar sits far from your hips, so a small weight is a lot.',
    },
    {
      name: /\bpull through\b/,
      setup: 'Face away from a low cable with the rope between your legs, a step or two out.',
      rep: 'Push your hips back and let the rope travel through your legs. Stand tall by squeezing your glutes, arms just hanging on.',
      why: 'It is a hinge with almost no load on the lower back.',
    },
    {
      equipment: ['dumbbell', 'kettlebell'],
      setup: 'Dumbbells in front of your thighs, feet hip width, knees slightly bent and kept there.',
      rep: 'Push your hips back and slide the dumbbells down your legs, back flat. Stand when your hips stop moving back.',
      why: 'It is a hamstring stretch under load. Going lower by rounding your back adds nothing.',
    },
    {
      setup: 'Bar at your thighs, feet hip width, knees slightly bent and kept there.',
      rep: 'Push your hips back and keep the bar against your legs. Stand when your hips stop moving back, usually just below the knee.',
      why: 'It is a hamstring stretch under load. Going lower by rounding your back adds nothing.',
    },
  ],
  deadlift: [
    {
      name: /\bsumo\b/,
      setup: 'Feet wide, toes turned out, shins against the bar. Grip inside your knees, chest up.',
      rep: 'Push your knees out and the floor away. Keep the bar against your legs both ways.',
      why: 'The wide stance keeps your back more upright, so the hips and legs do more of the lift.',
    },
    {
      name: /\btrap bar\b/,
      setup: 'Stand in the middle of the bar, feet hip width. Hips back, chest up, grip the handles.',
      rep: 'Push the floor away and stand tall. Lower it the same way.',
      why: 'The handles at your sides keep the load in line with you, so your back leans less than with a straight bar.',
    },
    {
      setup: 'Bar over the middle of your foot. Grip just outside your legs, shins to the bar, chest up, back flat.',
      rep: 'Push the floor away and keep the bar against your legs. Set it down the same way, with no bounce.',
      why: 'It builds the whole back of the body at once. Reps that stay clean count for more than one extra ugly one.',
    },
  ],
  swing: [
    {
      setup: 'Kettlebell a foot in front of you. Hinge down, grip it and hike it back between your legs.',
      rep: 'Snap your hips forward and let the bell float to chest height. Your arms are ropes.',
      why: 'It is done fast and far from failure, so it is conditioning more than muscle building.',
    },
  ],
  back_extension: [
    {
      name: /\breverse hyper/,
      setup: 'Chest and hips on the pad, hands on the handles, legs hanging with the strap round your ankles.',
      rep: 'Swing your legs back until they are level with your body. Lower under control.',
      why: 'Your legs move and your back stays still, so the glutes and hamstrings do the work.',
    },
    {
      setup: 'Pad just below your hip bones so you can fold over it. Feet locked in.',
      rep: 'Lower until your hamstrings stretch, then come up until your body is one straight line. No higher.',
      why: 'Stopping at a straight line keeps the work in the glutes and hamstrings and out of the lower back.',
    },
  ],
  hip_thrust: [
    {
      name: /\bbridge\b/,
      setup: 'On your back, knees bent, feet flat and close to your hips. Weight across your hip bones.',
      rep: 'Drive your hips up until your body is straight from knees to shoulders. Pause, then lower.',
      why: PLOTKIN,
      study: 'plotkin2023',
    },
    {
      equipment: 'machine',
      setup: 'Upper back on the pad, belt low across your hips. Feet so your shins are upright at the top.',
      rep: 'Drive your hips up until they are level with your knees and shoulders, chin tucked. Pause, then lower.',
      why: PLOTKIN,
      study: 'plotkin2023',
    },
    {
      setup: 'Bottom of your shoulder blades on a bench, bar with a pad over your hip bones. Feet so your shins are upright at the top.',
      rep: 'Drive your hips up until they are level with your knees and shoulders, chin tucked. Pause, then lower.',
      why: PLOTKIN,
      study: 'plotkin2023',
    },
  ],
  glute_kickback: [
    {
      equipment: 'cable',
      setup: 'Strap on your ankle, hands on the frame, leaning forward a little.',
      rep: 'Kick straight back with a nearly straight leg until your glute squeezes. Lower slowly.',
      why: 'If your back arches to get the leg higher, the glute has already finished its part.',
    },
  ],
  hip_abduction: [
    {
      equipment: 'machine',
      setup: 'Sit tall with your back on the pad, pads on the outside of your knees.',
      rep: 'Push your knees apart as far as they go and hold a second. Come back slowly without the stack touching down.',
      why: 'It trains the side glutes, which squats and hip thrusts mostly leave out.',
    },
  ],
  hip_adduction: [
    {
      equipment: 'machine',
      setup: 'Set the pads as wide as is comfortable. That stretch is where each rep starts.',
      rep: 'Squeeze your knees together and hold a second. Open slowly, back to the full stretch.',
      why: 'Start lighter than you think. The inner thigh strains easily when it is new to this.',
    },
  ],
  leg_curl: [
    {
      name: /\bseated\b/,
      setup: "Thigh pad snug above your knees. Knees in line with the machine's pivot.",
      rep: 'Lean forward a little and stay there. Let your legs go all the way straight, then curl.',
      why: 'Leaning forward stretches the hamstrings, and seated curls grew them more than lying ones for that reason (Maeo 2021).',
      study: 'maeo2021',
    },
    {
      name: /\b(nordic|glute ham)\b/,
      setup: 'Kneel with your ankles locked under something solid, body straight from knees to shoulders.',
      rep: 'Lower yourself as slowly as you can. Catch yourself with your hands and push back up.',
      why: 'The way down is the exercise. Few people can come back up without their hands, and that is fine.',
    },
    {
      name: /\b(lying|prone)\b/,
      setup: "Knees just off the edge of the pad and in line with the machine's pivot. Roller just above your heels.",
      rep: 'Curl as far as you can without your hips lifting. Lower slowly until your legs are straight.',
      why: 'Hips lifting off the pad shortens the hamstrings and takes the work off them.',
    },
    {
      equipment: 'machine',
      setup: "Knees in line with the machine's pivot, roller just above your heels.",
      rep: 'Curl as far as you can, then lower slowly until your legs are fully straight.',
      why: 'Seated leg curls grew the hamstrings more than lying ones (Maeo 2021). If your gym has both, take the seated one.',
      study: 'maeo2021',
    },
  ],
  calf_raise: [
    {
      name: /\bleg press\b/,
      setup: 'Balls of your feet on the bottom edge of the plate, legs straight but not locked hard.',
      rep: 'Let your heels sink as far as they go and pause there. Then push up onto your toes.',
      why: 'The stretch at the bottom is the part that counts. Reps kept to the bottom half grew the calves more than full ones (Kassiano 2023).',
      study: 'kassiano2023',
    },
    {
      setup: 'Balls of your feet on the edge of the step, knees straight.',
      rep: 'Lower your heels as far as they go and pause a full second. Then rise as high as you can.',
      why: 'With straight knees the big calf muscle works at length. Standing raises grew it and seated ones barely did (Kinoshita 2023).',
      study: 'kinoshita2023',
    },
  ],
  calf_raise_seated: [
    {
      setup: 'Pad on your lower thighs, balls of your feet on the edge.',
      rep: 'Heels all the way down and pause. Then all the way up.',
      why: 'Bent knees take the big calf muscle out of it. Standing raises grew the calves more than seated ones (Kinoshita 2023).',
      study: 'kinoshita2023',
    },
  ],
  press_flat: [
    {
      name: /\b(push ?ups?|press ups?)\b/,
      setup: 'Hands a little wider than your shoulders, body one straight line from head to heels.',
      rep: 'Chest to the floor, elbows about 45 degrees from your sides. Push up without your hips sagging.',
      why: 'When sets pass 20 reps, raise your feet or put weight on your back to keep them shorter.',
    },
    {
      equipment: 'machine',
      setup: 'Seat height so the handles line up with the middle of your chest. Shoulder blades back against the pad.',
      rep: 'Press until your arms are nearly straight. Come back until your chest stretches.',
      why: `Nothing to balance, so your chest is the limit. ${HAUGEN}`,
      study: 'haugen2023',
    },
    {
      equipment: ['dumbbell', 'kettlebell'],
      setup: 'Kick the dumbbells up as you lie back. Shoulder blades pulled back and down, feet flat.',
      rep: 'Lower until the dumbbells are beside your chest, elbows about 45 degrees out. Press up and slightly in.',
      why: 'Dumbbells go lower than a bar can, which stretches the chest more at the bottom.',
    },
    {
      equipment: 'smith',
      setup: 'Bench placed so the bar comes down on your lower chest. Shoulder blades pulled back and down, feet flat.',
      rep: 'Lower the bar to a light touch on your chest. Press until your arms are nearly straight.',
      why: 'The fixed path lets you push close to failure without having to balance the bar.',
    },
    {
      setup: 'Eyes under the bar. Shoulder blades pulled back and down, feet flat. Grip a little wider than your shoulders.',
      rep: 'Lower the bar to your lower chest and touch lightly. Press back up to over your shoulders.',
      why: 'Shoulder blades pinned back keep the chest doing the work and not the front of the shoulders.',
    },
  ],
  press_incline: [
    {
      name: /\bpush ?ups?\b/,
      setup: 'Hands on a bench or a bar, a little wider than your shoulders. Body one straight line.',
      rep: 'Chest to the bench, elbows about 45 degrees out. Push up without your hips sagging.',
      why: 'Raised hands make a push-up lighter. Use a lower bench as it gets easy.',
    },
    {
      equipment: 'machine',
      setup: 'Seat height so the handles start level with your upper chest. Shoulder blades back against the pad.',
      rep: 'Press up until your arms are nearly straight. Come back until your chest stretches.',
      why: 'The incline press grew the upper chest more than the flat press (Chaves 2020).',
      study: 'chaves2020',
    },
    {
      equipment: ['dumbbell', 'kettlebell'],
      setup: 'Bench at 30 to 45 degrees. Shoulder blades pulled back and down.',
      rep: 'Lower the dumbbells to the sides of your upper chest. Press up and slightly in.',
      why: 'The incline press grew the upper chest more than the flat press (Chaves 2020). A steeper bench turns it into a shoulder press.',
      study: 'chaves2020',
    },
    {
      setup: 'Bench at 30 to 45 degrees. Shoulder blades pulled back and down, grip a little wider than your shoulders.',
      rep: 'Lower the bar to your upper chest, just under your collarbones. Press straight up.',
      why: 'The incline press grew the upper chest more than the flat press (Chaves 2020). A steeper bench turns it into a shoulder press.',
      study: 'chaves2020',
    },
  ],
  press_decline: [
    {
      setup: 'Feet hooked in, shoulder blades pulled back and down.',
      rep: 'Lower to your lower chest. Press straight up.',
      why: 'It trains the same chest as a flat press over a shorter path, so expect to move a little more weight.',
    },
  ],
  press_close_grip: [
    {
      name: /\bpush\b/,
      setup: 'Hands under your chest, thumbs and first fingers touching. Body one straight line.',
      rep: 'Chest to your hands with your elbows brushing your sides. Push back up.',
      why: 'Hands together and elbows tucked move the work from the chest to the triceps.',
    },
    {
      setup: 'Hands shoulder width and no narrower. Shoulder blades pulled back and down.',
      rep: 'Lower to your lower chest with your elbows tucked close to your sides. Press up.',
      why: 'A narrow grip and tucked elbows move the work from the chest to the triceps.',
    },
  ],
  dip: [
    {
      equipment: 'machine',
      setup: 'Seat low enough that your elbows start above your hands. Belt on if it has one.',
      rep: 'Push down until your arms are straight. Let the handles rise until your upper arms pass level.',
      why: 'Sitting upright keeps the work on the triceps.',
    },
    {
      setup: 'Arms straight on the bars, shoulders pushed down away from your ears.',
      rep: 'Lean forward a little and lower until your shoulders are just below your elbows. Press up without swinging.',
      why: 'Leaning forward makes it more chest. Staying upright makes it more triceps.',
    },
  ],
  fly: [
    {
      equipment: 'machine',
      setup: 'Seat so your hands are level with your chest. Elbows slightly bent and kept that way.',
      rep: 'Bring the handles together in a wide arc. Open slowly until your chest stretches.',
      why: 'The stretch at the open end is where a fly does its work, so do not cut it short.',
    },
    {
      equipment: 'cable',
      setup: 'Pulleys at shoulder height. Step forward with one foot ahead so the weight pulls your arms back.',
      rep: 'Hug a wide arc until your hands meet, elbows slightly bent. Open slowly into the stretch.',
      why: 'A cable keeps pulling when your hands meet, where a dumbbell fly goes slack.',
    },
    {
      setup: 'Lie as for a bench press with the dumbbells over your chest, palms facing, elbows slightly bent.',
      rep: 'Open your arms in a wide arc until your chest stretches. Bring them back the same way.',
      why: 'It is hardest at the bottom, in the stretch. Go light enough to pause there.',
    },
  ],
  fly_incline: [
    {
      equipment: 'cable',
      setup: 'Pulleys at their lowest. Step forward with one foot ahead, arms down and out to your sides.',
      rep: 'Sweep your hands up and in until they meet at chin height. Lower slowly into the stretch.',
      why: 'The upward line aims the fly at the upper chest.',
    },
    {
      setup: 'Bench at about 30 degrees, dumbbells over your upper chest, elbows slightly bent.',
      rep: 'Open your arms in a wide arc until your chest stretches. Bring them back the same way.',
      why: 'The incline aims the fly at the upper chest. Go light enough to pause in the stretch.',
    },
  ],
  pullover: [
    {
      equipment: ['machine', 'cable'],
      setup: 'Elbows on the pads or hands on the bar, arms up by your ears. Belt on if it has one.',
      rep: 'Pull down in an arc until your hands reach your hips. Let it rise until your lats stretch.',
      why: 'It trains the lats without the biceps, which often give out first on rows.',
    },
    {
      setup: 'Lie on a bench holding one dumbbell over your chest in both hands, elbows slightly bent.',
      rep: 'Lower it behind your head until your lats stretch. Pull it back over your chest without bending your elbows more.',
      why: 'It trains the lats without the biceps, which often give out first on rows.',
    },
  ],
  press_overhead: [
    {
      name: /\bpike\b/,
      setup: 'Hands shoulder width, hips high so your body makes an upside-down V.',
      rep: 'Lower the top of your head to the floor just ahead of your hands. Press back up.',
      why: 'Raising your feet puts more of your weight on your shoulders.',
    },
    {
      name: /\barnold\b/,
      setup: 'Bench one notch back from upright. Dumbbells in front of your shoulders, palms toward you.',
      rep: 'Turn your palms forward as you press up. Reverse the turn on the way down.',
      why: 'The turn adds range at the bottom. Expect to use less weight than on a normal press.',
    },
    {
      equipment: 'machine',
      setup: 'Seat height so the handles start level with your chin. Back against the pad.',
      rep: 'Press until your arms are nearly straight. Lower to chin height.',
      why: `Nothing to balance, so your shoulders are the limit. ${HAUGEN}`,
      study: 'haugen2023',
    },
    {
      equipment: 'smith',
      setup: 'Bench one notch back from upright, placed so the bar comes down just in front of your face.',
      rep: 'Lower the bar to chin height. Press until your arms are nearly straight.',
      why: 'The fixed path lets you push close to failure without having to balance the bar.',
    },
    {
      equipment: ['dumbbell', 'kettlebell'],
      setup: 'Bench one notch back from upright. Dumbbells at ear height, elbows a little in front of your body.',
      rep: 'Press up and slightly in. Lower until the dumbbells are level with your ears.',
      why: 'Elbows a little forward give the shoulder more room than elbows flared straight out.',
    },
    {
      setup: 'Bar on your collarbones, grip just outside your shoulders. Squeeze your glutes.',
      rep: 'Press straight up and bring your head through once the bar passes it. Lower to your collarbones.',
      why: 'Squeezed glutes stop you leaning back and turning it into an incline press.',
    },
  ],
  raise_lateral: [
    {
      equipment: 'cable',
      setup: 'Pulley at its lowest. Stand side-on and hold the handle in the far hand, across your body.',
      rep: 'Raise your arm out to the side to shoulder height, elbow slightly bent. Lower slowly.',
      why: 'Cable and dumbbell raises grew the side delts equally (Larsen 2025), so use the one that feels smoother.',
      study: 'larsen2025raise',
    },
    {
      equipment: 'machine',
      setup: 'Seat so your shoulders line up with the pivots. Pads on your forearms or elbows.',
      rep: 'Lift with your elbows to shoulder height. Lower slowly.',
      why: 'The pads take your grip and wrists out of it, so only the side delts can give out.',
    },
    {
      setup: 'Dumbbells at your sides, leaning forward a touch, elbows slightly bent.',
      rep: 'Raise out to the sides to shoulder height, leading with your elbows. Lower slower than you lifted.',
      why: 'If you have to swing, it is too heavy. Cable and dumbbell raises grew the side delts equally (Larsen 2025).',
      study: 'larsen2025raise',
    },
  ],
  raise_front: [
    {
      setup: 'Weight in front of your thighs, standing tall.',
      rep: 'Raise it to eye level with nearly straight arms. Lower slowly.',
      why: 'Every press already trains the front delts, so this needs few sets.',
    },
  ],
  upright_row: [
    {
      setup: 'Grip a little wider than your shoulders. A cable or an EZ bar is easier on the wrists than a straight bar.',
      rep: 'Pull your elbows up and out to shoulder height. Keep the bar close to your body.',
      why: 'The wide grip makes it a side delt movement. A narrow one turns it into a trap exercise.',
    },
  ],
  rear_fly: [
    {
      equipment: 'machine',
      setup: 'Face the pad, seat so your hands are at shoulder height. Arms nearly straight.',
      rep: 'Sweep your arms out and back until they are level with your shoulders. Return slowly.',
      why: 'Push your hands apart and do not pinch your shoulder blades. That keeps it in the rear delts.',
    },
    {
      equipment: 'cable',
      setup: 'Pulleys at shoulder height. Take the left cable in your right hand and the right in your left.',
      rep: 'Sweep your arms out and back until you make a T. Return slowly until your arms cross.',
      why: 'The cable keeps pulling when your arms are in front of you, where dumbbells weigh nothing.',
    },
    {
      setup: 'Hinge forward until your chest is near level, or lie chest-down on an incline bench. Arms hanging.',
      rep: 'Raise your arms out to the sides to shoulder height, elbows slightly bent. Lower slowly.',
      why: 'Reach wide and do not pinch your shoulder blades together, or the upper back takes over.',
    },
  ],
  face_pull: [
    {
      setup: 'Rope at face height, thumbs toward you. Step back until your arms are straight.',
      rep: 'Pull the rope toward your eyes with your hands apart and elbows high. Finish with your hands beside your ears.',
      why: 'Elbows high and hands apart are what make it a rear delt movement and not a row.',
    },
  ],
  shrug: [
    {
      setup: 'Dumbbells at your sides or a bar in front of you, arms straight.',
      rep: 'Lift your shoulders straight up toward your ears and hold a second. Lower all the way.',
      why: 'Straight up and down is the whole movement. Rolling your shoulders adds nothing.',
    },
  ],
  pull_vertical: [
    {
      name: /\bchin ?ups?\b/,
      setup: 'Palms toward you, hands shoulder width. Start from a dead hang.',
      rep: 'Pull your chest to the bar, driving your elbows down. Lower all the way to straight arms.',
      why: 'If you cannot do 5, use a band or the assisted machine. Once you can do 12, add weight.',
    },
    {
      name: /\bpull ?ups?\b/,
      setup: 'Palms away, hands a little wider than your shoulders. Start from a dead hang.',
      rep: 'Pull your chest to the bar, driving your elbows down. Lower all the way to straight arms.',
      why: 'If you cannot do 5, use a band or the assisted machine. Once you can do 12, add weight.',
    },
    {
      name: /\b(one|single) arm\b/,
      setup: 'Thigh pad snug. One handle, palm facing in, arm straight up.',
      rep: 'Pull your elbow down to your side. Let your arm go fully straight until the lat stretches.',
      why: 'One side at a time reaches higher at the top than a bar allows.',
    },
    {
      name: /\b(close|neutral|v bar)\b/,
      equipment: ['cable', 'machine'],
      setup: 'Thigh pad snug so you cannot lift off. Palms facing each other, leaning back slightly.',
      rep: 'Pull the handle to your upper chest, elbows down past your sides. Let it rise until your arms are straight.',
      why: 'The stretch at the top is half the rep. Leaning far back turns it into a row.',
    },
    {
      equipment: ['cable', 'machine'],
      setup: 'Thigh pad snug so you cannot lift off. Grip a little wider than your shoulders, leaning back slightly.',
      rep: 'Pull the bar to your upper chest by driving your elbows down. Let it rise all the way until your lats stretch.',
      why: 'The stretch at the top is half the rep. Leaning far back turns it into a row.',
    },
  ],
  row: [
    {
      name: /\b(inverted|australian)\b/,
      setup: 'Bar at waist height. Hang under it with a straight body, heels on the floor.',
      rep: 'Pull your chest to the bar. Lower to straight arms.',
      why: 'Walking your feet forward, or raising them, makes it harder.',
    },
    {
      name: /\bpendlay\b/,
      setup: 'Bar on the floor, chest level with the floor, back flat.',
      rep: 'Pull the bar to your lower chest. Set it back on the floor every rep.',
      why: 'Starting each rep from a dead stop removes any bounce.',
    },
    {
      equipment: 'machine',
      setup: 'Chest on the pad, seat so the handles are level with your lower chest.',
      rep: 'Pull your elbows back past your body. Reach all the way forward again.',
      why: 'The pad holds you still, so your back does all of the work and your lower back none.',
    },
    {
      name: /\b(chest supported|seal)\b/,
      setup: 'Lie chest-down on the bench, arms hanging straight.',
      rep: 'Pull your elbows back past your body. Lower to straight arms.',
      why: 'The bench holds you still, so your back does all of the work and your lower back none.',
    },
    {
      name: /\b(one|single) arm\b/,
      equipment: 'cable',
      setup: 'Face the pulley with one handle, arm straight and shoulder reaching forward.',
      rep: 'Pull your elbow back past your side. Reach all the way forward again.',
      why: 'One arm at a time lets the shoulder blade travel further at both ends.',
    },
    {
      equipment: 'cable',
      setup: 'Feet on the plate, knees soft. Sit tall with your arms straight and shoulders reaching forward.',
      rep: 'Pull the handle to your stomach, elbows past your sides. Reach all the way forward again.',
      why: 'The reach forward stretches the upper back. Rocking your body only moves the weight with your hips.',
    },
    {
      equipment: ['dumbbell', 'kettlebell'],
      setup: 'One hand and one knee on a bench, back flat. Dumbbell hanging straight down.',
      rep: 'Pull the dumbbell toward your hip. Lower until your shoulder blade stretches forward.',
      why: 'Pulling to the hip keeps it in the back. Pulling to the chest makes it a biceps movement.',
    },
    {
      setup: "Hinge forward until your chest is near level, back flat, knees soft. Bar hanging at arm's length.",
      rep: 'Pull the bar to your lower stomach. Lower to straight arms without standing up.',
      why: 'If your chest rises as you pull, the weight is too heavy for your back to do the work.',
    },
  ],
  straight_arm_pulldown: [
    {
      setup: 'Bar or rope on a high pulley. Step back, lean forward slightly, arms straight.',
      rep: 'Sweep the bar down to your thighs in an arc. Let it rise until your lats stretch.',
      why: 'Straight arms take the biceps out of it, so the lats do all of the work.',
    },
  ],
  curl: [
    {
      name: /\bpreacher\b/,
      setup: 'Armpits snug on top of the pad, upper arms flat on it.',
      rep: 'Lower until your arms are nearly straight. Curl up and stop before the weight goes slack at the top.',
      why: 'The bottom half is the hard part and the useful one. It grew the lower biceps more than the top half did (Pedrosa 2023).',
      study: 'pedrosa2023',
    },
    {
      name: /\bbayesian\b/,
      setup: 'Face away from a low cable and step forward until your arm is pulled back behind you.',
      rep: 'Curl without your elbow coming forward. Lower to a straight arm.',
      why: 'An arm behind you stretches the biceps at the shoulder, and the cable keeps pulling through the whole rep.',
    },
    {
      name: /\bincline\b/,
      setup: 'Bench at about 60 degrees. Lie back with your arms hanging straight down behind your body.',
      rep: 'Curl without your elbows drifting forward. Lower all the way to straight arms.',
      why: 'Arms behind you stretch the biceps at the shoulder. Expect to use less weight than on a standing curl.',
    },
    {
      name: /\bspider\b/,
      setup: 'Lie chest-down on an incline bench, arms hanging straight down.',
      rep: 'Curl without your elbows swinging back. Squeeze at the top, then lower fully.',
      why: 'Hanging arms cannot swing, and the top of the curl stays hard.',
    },
    {
      name: /\bconcentration\b/,
      setup: 'Sit with your elbow braced against the inside of your thigh, arm hanging straight.',
      rep: 'Curl toward your shoulder without your elbow leaving your thigh. Lower fully.',
      why: 'The braced elbow takes out any swing, so the biceps does all of it.',
    },
    {
      equipment: 'machine',
      setup: 'Armpits snug on top of the pad, upper arms flat on it.',
      rep: 'Lower until your arms are nearly straight. Curl up and stop before the weight goes slack at the top.',
      why: 'The bottom half is the hard part and the useful one. It grew the lower biceps more than the top half did (Pedrosa 2023).',
      study: 'pedrosa2023',
    },
    {
      equipment: 'cable',
      setup: 'Low pulley, elbows at your sides, a small step back.',
      rep: 'Curl to your shoulders with your elbows still. Lower to straight arms.',
      why: MANNARINO,
      study: 'mannarino2021',
    },
    {
      setup: 'Stand tall, elbows at your sides, palms forward.',
      rep: 'Curl to your shoulders without your elbows drifting forward. Lower all the way, slower than you lifted.',
      why: MANNARINO,
      study: 'mannarino2021',
    },
  ],
  curl_hammer: [
    {
      name: /\b(reverse|zottman)\b/,
      setup: 'Palms down, grip shoulder width, elbows at your sides.',
      rep: 'Curl to your shoulders with your wrists straight. Lower fully.',
      why: 'Palms down moves the work to the muscles on top of the forearm.',
    },
    {
      setup: 'Palms facing each other, elbows at your sides.',
      rep: 'Curl to your shoulders with your thumbs up the whole way. Lower fully.',
      why: 'The thumbs-up grip works the muscle under the biceps and the forearm more than a normal curl.',
    },
  ],
  triceps_overhead: [
    {
      equipment: 'cable',
      setup: 'Rope on a low or middle pulley. Face away with the rope behind your head, elbows by your ears, one foot forward.',
      rep: 'Straighten your arms overhead. Let the rope pull your hands back down behind your head as far as they go.',
      why: MAEO_TRICEPS,
      study: 'maeo2023',
    },
    {
      setup: 'Weight held behind your head in both hands, elbows pointing up.',
      rep: 'Straighten your arms. Lower behind your head until your forearms meet your biceps.',
      why: MAEO_TRICEPS,
      study: 'maeo2023',
    },
  ],
  triceps_lying: [
    {
      setup: 'Lie on a bench with the weight over your forehead, upper arms tilted slightly back toward your head.',
      rep: 'Bend only at the elbows, lowering the weight to just behind your head. Straighten without your elbows flaring.',
      why: 'Upper arms tilted back keep the triceps loaded at the top and add stretch at the bottom.',
    },
  ],
  triceps_pushdown: [
    {
      name: /\bkickbacks?\b/,
      setup: 'Hinge forward with your upper arm level with your body and held there.',
      rep: 'Straighten your arm behind you and hold a second. Lower slowly.',
      why: 'It is only hard at the very top, so it needs a light weight and a pause.',
    },
    {
      equipment: 'cable',
      setup: 'High pulley. Elbows pinned to your sides, leaning forward slightly.',
      rep: 'Push down until your arms are straight. Let your hands rise to chest height without your elbows lifting.',
      why: 'Overhead extensions grew the triceps more than pushdowns (Maeo 2023), so do both across the week.',
      study: 'maeo2023',
    },
  ],
  crunch: [
    {
      equipment: 'cable',
      setup: 'Kneel facing a high pulley, rope held at the sides of your head.',
      rep: 'Curl your ribs toward your hips, rounding your back. Keep your hips still.',
      why: AB_CURL,
    },
    {
      equipment: 'machine',
      setup: 'Pad on your upper chest or hands on the handles, feet hooked in.',
      rep: 'Curl your ribs toward your hips, rounding your back. Return slowly until your abs stretch.',
      why: AB_CURL,
    },
    {
      name: /\bsit ups?\b/,
      setup: 'Feet hooked in, weight held high on your chest if you use one.',
      rep: 'Curl up by rounding your back first, then sit up. Lower slowly, unrolling the same way.',
      why: 'Rounding first keeps your abs working. Sitting up with a flat back is mostly hip flexors.',
    },
    {
      name: /\bcrunch(es)?\b/,
      setup: 'On your back, knees bent, hands at your temples.',
      rep: 'Curl your shoulders off the floor by rounding your back. Lower slowly.',
      why: 'It is a short movement. Once 20 is easy, hold a weight on your chest.',
    },
  ],
  leg_raise: [
    {
      name: /\b(hanging|toes to bar)\b/,
      setup: 'Hang from a bar with your shoulders pulled down.',
      rep: 'Raise your knees or straight legs and curl your hips up at the top. Lower without swinging.',
      why: HIP_CURL,
    },
    {
      name: /\b(lying|leg raises?|reverse crunch)\b/,
      setup: 'On your back, hands under your hips, legs straight or knees bent.',
      rep: 'Raise your legs to vertical, then lift your hips an inch off the floor. Lower slowly without your back arching.',
      why: HIP_CURL,
    },
  ],
  anti_extension: [
    {
      name: /\b(rollout|ab wheel)\b/,
      setup: 'Kneel with the wheel under your shoulders and your hips tucked.',
      rep: 'Roll out as far as you can without your lower back sagging. Pull back with your abs.',
      why: 'The moment your back sags, your abs have let go. That is the end of your range for now.',
    },
    {
      name: /\bplank\b/,
      setup: 'Elbows under your shoulders, body one straight line.',
      rep: 'Squeeze your glutes, pull your ribs toward your hips, and hold.',
      why: 'Once you can hold a minute, make it harder, not longer.',
    },
  ],
  rotation: [
    {
      name: /\bpallof\b/,
      setup: 'Stand side-on to a cable at chest height, handle held at your chest.',
      rep: 'Press your hands straight out and hold a second without the cable turning you. Bring them back.',
      why: 'Not turning is the work. Step further from the stack to make it harder.',
    },
    {
      name: /\bside plank\b/,
      setup: 'Elbow under your shoulder, feet stacked, body one straight line.',
      rep: 'Lift your hips and hold, without letting them sag or fold.',
      why: 'Once a minute is easy, raise your top leg.',
    },
    {
      name: /\brussian twist\b/,
      setup: 'Sit leaning back about 45 degrees with your hands together.',
      rep: 'Turn your shoulders to each side, not only your arms.',
      why: 'If only your hands move, your abs are not turning anything.',
    },
  ],
};

/**
 * Names these lines would be wrong for: skills and odd variants that share a
 * pattern's words and little of its technique. The list errs wide; a name on
 * it only loses the row.
 */
const NOT_COVERED = /\b(pistol|shrimp|skater|cossack|sissy|reverse nordic|muscle ?ups?|l sit|v sit|dragon flag|hollow|dead bug|archer|typewriter|planche|lever|jefferson|zercher|overhead squat|landmine|band|banded|wood ?chop|windshield|side bend|v ups?|jm press|rack pull|floor press|behind the neck|bicycle|jump|box|bench dips?|handstand|eccentric|negatives?)\b/;

/** Patterns whose lines describe both legs working at once: a one-leg version is a different movement. */
const TWO_SIDED_ONLY: ReadonlySet<MovementPattern> = new Set(['squat', 'leg_press', 'hinge', 'deadlift', 'hip_thrust']);

function plain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fits(variant: Variant, name: string, equipment: EquipmentKind): boolean {
  if (variant.name && !variant.name.test(name)) return false;
  if (variant.equipment === undefined) return true;
  return typeof variant.equipment === 'string' ? variant.equipment === equipment : variant.equipment.includes(equipment);
}

/** How to do a movement, or null when its name says too little to be sure. */
export function movementHowTo(exercise: Pick<Exercise, 'name' | 'equipment'>): HowTo | null {
  const profile = movementProfile(exercise);
  if (!profile) return null;
  const name = plain(exercise.name);
  if (NOT_COVERED.test(name)) return null;
  if (profile.unilateral && TWO_SIDED_ONLY.has(profile.pattern)) return null;
  const found = HOW_TO[profile.pattern].find((variant) => fits(variant, name, profile.equipment));
  if (!found) return null;
  return { setup: found.setup, rep: found.rep, why: found.why, ...(found.study ? { study: found.study } : null) };
}
