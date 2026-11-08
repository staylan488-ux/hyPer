// Close-the-gap picks: when today is well short in the evening, the two or
// three of the person's own usual foods that together cover what is still to
// go, each at the amount they usually log. Read from the food log itself
// (Recent's ranking), so nothing has to be set up first. Pure, so tests can
// check it.
import {
  rankRecentFoods,
  recentFoodKey,
  RECENT_LIMIT,
  type HiddenRecentFoods,
  type RecentFood,
  type RecentLog,
} from '@/lib/recentFoods';

/** Foods in a set at most. */
export const GAP_PICKS_MAX = 3;
/** The usual foods weighed, the most eaten first; enough for real choice, few enough to try every set. */
export const GAP_CANDIDATES = 12;
/** A usual food: eaten on this many days of Recent's window or more, so a one-off never comes back as advice. */
export const GAP_MIN_DAYS = 2;
/** Calories: too small to help (a coffee, a sauce) below this, at the usual amount. */
export const GAP_MIN_KCAL = 80;
/** Protein: a food worth suggesting for protein has at least this much, at the usual amount. */
export const GAP_MIN_PROTEIN = 10;
/** A set that covers less than this share of the gap is not worth showing. */
export const GAP_MIN_SHARE = 1 / 3;
/** A set this close to the gap or past it covers it. */
export const GAP_COVERED_SHARE = 0.9;

/**
 * What is still to go, as the reminder measures it (fuelShortfall): calories
 * only while gaining, protein on any goal; null where that one is not short.
 */
export type GapNeed = { kcal: number | null; protein: number | null };

export type GapPick = RecentFood & {
  /** Calories and protein at the usual amount. */
  kcal: number;
  protein: number;
};

export type GapPlan = {
  /** What the picks are chosen for: the calories, or (calories fine or not counted) the protein. */
  aim: 'calories' | 'protein';
  picks: GapPick[];
  kcal: number;
  protein: number;
  /** The picks together reach the aim (or come within a tenth of it). */
  covers: boolean;
};

export type GapPicksInput = {
  /** Recent's window of logs (loadRecentLogs). */
  logs: readonly RecentLog[];
  todayKey: string;
  need: GapNeed;
  /**
   * Calories that still fit today, when going past the target is a warning
   * (cutting, maintaining, no goal): a protein set must stay within them.
   * Null while gaining, where past the target is a good day.
   */
  kcalRoom: number | null;
  /** Foods hidden from Recent stay out of the picks too. */
  hidden?: HiddenRecentFoods;
  /** Foods already eaten today, by recentFoodKey; by default read from today's logs in `logs`. */
  eatenToday?: ReadonlySet<string>;
};

const at = (value: number, servings: number) => (Number(value) || 0) * servings;

/** Every set of one to `max` of `count` items, as index lists, the smaller sets first. */
function* sets(count: number, max: number): Generator<number[]> {
  const pick: number[] = [];
  function* grow(start: number, size: number): Generator<number[]> {
    if (pick.length === size) {
      yield [...pick];
      return;
    }
    for (let index = start; index < count; index += 1) {
      pick.push(index);
      yield* grow(index + 1, size);
      pick.pop();
    }
  }
  for (let size = 1; size <= max; size += 1) yield* grow(0, size);
}

/**
 * The set of usual foods that best closes the gap, or null when nothing
 * sensible does (no usual foods, or none that would make a dent).
 *
 * Calories (gaining and short): the set that reaches the calories left,
 * going a little past freely (past the target is a win while gaining) and
 * far past only at a cost, helped by the protein it brings when protein is
 * short too. Protein (calories fine, or not counted on this goal): the set
 * that brings the protein left, within the calories that still fit when
 * going over would be a warning. Either way the usual foods come first, a
 * food already eaten today a little later, and a smaller set wins a tie.
 */
export function planGapPicks({ logs, todayKey, need, kcalRoom, hidden, eatenToday }: GapPicksInput): GapPlan | null {
  const kcalNeed = need.kcal !== null && need.kcal > 0 ? need.kcal : null;
  const proteinNeed = need.protein !== null && need.protein > 0 ? need.protein : null;
  const aim: GapPlan['aim'] | null = kcalNeed !== null ? 'calories' : proteinNeed !== null ? 'protein' : null;
  if (!aim) return null;
  if (aim === 'protein' && kcalRoom !== null && !(kcalRoom > 0)) return null;

  const eaten = eatenToday ?? new Set(logs.filter((log) => log.date === todayKey && log.food).map((log) => recentFoodKey(log.food!)));
  const candidates: GapPick[] = rankRecentFoods(logs, todayKey, { hidden, limit: RECENT_LIMIT })
    .map((recent) => ({ ...recent, kcal: at(recent.food.calories, recent.servings), protein: at(recent.food.protein, recent.servings) }))
    .filter((pick) => pick.days >= GAP_MIN_DAYS)
    .filter((pick) => (aim === 'calories' ? pick.kcal >= GAP_MIN_KCAL : pick.protein >= GAP_MIN_PROTEIN))
    .filter((pick) => aim === 'calories' || kcalRoom === null || pick.kcal <= kcalRoom)
    .slice(0, GAP_CANDIDATES);
  if (candidates.length === 0) return null;

  // Habit: the most eaten 1, each place after it a twelfth less.
  const habit = candidates.map((_, rank) => 1 - rank / GAP_CANDIDATES);
  const goal = aim === 'calories' ? kcalNeed! : proteinNeed!;
  let best: { score: number; set: number[]; share: number; kcal: number; protein: number } | null = null;
  for (const set of sets(candidates.length, GAP_PICKS_MAX)) {
    let kcal = 0;
    let protein = 0;
    let usual = 0;
    let again = 0;
    for (const index of set) {
      kcal += candidates[index].kcal;
      protein += candidates[index].protein;
      usual += habit[index];
      if (eaten.has(candidates[index].key)) again += 1;
    }
    let score: number;
    let share: number;
    if (aim === 'calories') {
      share = kcal / goal;
      // A little past the gap is free while gaining; well past costs as much as falling short.
      const slack = Math.max(150, goal * 0.2);
      const past = Math.max(0, kcal - goal - slack) / goal;
      const proteinShare = proteinNeed !== null ? Math.min(protein, proteinNeed) / proteinNeed : 0;
      score = Math.min(share, 1) - past + 0.3 * proteinShare;
    } else {
      if (kcalRoom !== null && kcal > kcalRoom) continue;
      share = protein / goal;
      // The leaner way to the protein, against the room left (or a big day's worth while gaining).
      const cost = kcal / (kcalRoom ?? 2000);
      score = Math.min(share, 1) - 0.15 * cost;
    }
    score += 0.1 * (usual / set.length) - 0.02 * set.length - 0.05 * again;
    if (!best || score > best.score + 1e-9) best = { score, set, share, kcal, protein };
  }
  if (!best || best.share < GAP_MIN_SHARE) return null;
  return {
    aim,
    picks: best.set.map((index) => candidates[index]),
    kcal: Math.round(best.kcal),
    protein: Math.round(best.protein),
    covers: best.share >= GAP_COVERED_SHARE,
  };
}

/** "A", "A and B", "A, B and C". */
export function gapPickNames(plan: Pick<GapPlan, 'picks'>): string {
  const names = plan.picks.map((pick) => pick.food.name.trim()).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The reminder's second line: which usual foods would close the gap. */
export function gapPicksLine(plan: GapPlan): string {
  const names = gapPickNames(plan);
  if (!plan.covers) return `${names} would get you closer.`;
  return plan.aim === 'calories' ? `${names} would cover it.` : `${names} would cover the protein.`;
}
