export interface AppSearchEntry {
  id: string;
  title: string;
  /** Human-readable breadcrumb, shown beneath the result title. */
  path: string;
  href: string;
  aliases: readonly string[];
  iosOnly?: boolean;
}

function setting(id: string, title: string, path: string, route: string, aliases: string[], anchor = false): AppSearchEntry {
  return { id, title, path: `You · ${path}`, href: `/settings/${route}${anchor ? `#search-${id}` : ''}`, aliases };
}

/** Curated destinations only: search never reads personal records or changes a setting. */
export const APP_SEARCH_ENTRIES: readonly AppSearchEntry[] = [
  setting('appearance', 'Appearance', 'Appearance · Theme', 'appearance', ['dark mode', 'light mode', 'theme', 'black', 'ivory', 'app color', 'follow system', 'system appearance', 'automatic dark mode'], true),
  setting('adaptive-scheduling', 'Adaptive split scheduling', 'Training', 'training', ['automatic workout scheduling', 'adjust rest days', 'reschedule workouts', 'adaptive schedule', 'keep saved schedule'], true),
  setting('weight-units', 'Weight units', 'Body weight', 'weight', ['pounds', 'kilograms', 'lbs', 'lb', 'kg', 'metric', 'imperial', 'change weight units'], true),
  setting('log-weight', 'Log weight', 'Body weight', 'weight', ['weigh in', 'weigh-in', 'record weight', 'manual weight', 'add body weight'], true),
  setting('body-weight', 'Body weight', 'Body weight', 'weight', ['weight history', 'weight trend', 'weigh ins', 'weight measurements']),
  setting('targets', 'Nutrition targets', 'Nutrition targets', 'targets', ['macro goals', 'daily macros', 'diet goals', 'nutrition goals']),
  setting('calories', 'Calorie target', 'Nutrition targets · Edit targets', 'targets/edit', ['calories', 'energy goal', 'daily calories', 'calorie goal'], true),
  setting('protein', 'Protein target', 'Nutrition targets · Edit targets', 'targets/edit', ['protein goal', 'protein grams', 'daily protein'], true),
  setting('carbs', 'Carb target', 'Nutrition targets · Edit targets', 'targets/edit', ['carbs', 'carbohydrates', 'carbohydrate goal', 'carb goal'], true),
  setting('fat', 'Fat target', 'Nutrition targets · Edit targets', 'targets/edit', ['fats', 'fat goal', 'fat grams'], true),
  setting('calculate-targets', 'Calculate targets', 'Nutrition targets', 'targets/calculate', ['nutrition calculator', 'calorie calculator', 'macro calculator', 'lose weight', 'gain muscle', 'cutting', 'bulking', 'maintenance']),
  setting('target-suggestions', 'Get target suggestions', 'Nutrition targets', 'targets/coach', ['nutrition coach', 'diet advice', 'macro recommendations', 'target recommendations']),
  setting('target-adaptation', 'How targets adapt', 'Nutrition targets', 'targets/adaptation', ['adaptive targets', 'automatic adjustments', 'automatically adjust calories', 'automatic updates', 'adaptation']),
  setting('saved-meals', 'Saved meals', 'Nutrition', 'meals', ['edit saved meals', 'delete saved meals', 'favorite foods', 'meal library', 'manage meals']),
  setting('food-analysis', 'Food analysis', 'Nutrition', 'analysis', ['food photo setup', 'meal photo setup', 'food recognition', 'photo analysis settings', 'check analysis usage', 'analysis limits']),
  setting('analysis-mode', 'Meal analysis method', 'Food analysis', 'analysis', ['hosted analysis', 'gemini', 'your mac', 'analysis mode', 'food analysis method'], true),
  setting('worker-setup', 'Mac worker setup', 'Food analysis', 'analysis/worker', ['food photo connection', 'local worker', 'connect mac', 'coach setup', 'test worker connection']),
  setting('worker-url', 'Worker URL', 'Food analysis · Mac worker setup', 'analysis/worker', ['server address', 'tailscale', 'https url', 'worker connection address'], true),
  setting('analysis-provider', 'Photo-analysis provider', 'Food analysis · Mac worker setup', 'analysis/worker', ['openai', 'codex', 'claude', 'anthropic', 'photo provider'], true),
  setting('whoop', 'WHOOP', 'Connections', 'connections/whoop', ['connect whoop', 'disconnect whoop', 'sync whoop', 'wearable', 'recovery connection']),
  { ...setting('apple-health', 'Apple Health', 'Connections', 'connections/health', ['sync my weight', 'automatic weight sync', 'healthkit', 'connect health', 'import weight', 'iphone health']), iosOnly: true },
  setting('display-name', 'Display name', 'Account', 'account', ['rename profile', 'change name', 'username', 'profile name'], true),
  setting('sign-out', 'Sign out', 'Account', 'account', ['log out', 'logout', 'signout', 'switch account'], true),
  setting('account', 'Account', 'Account', 'account', ['profile', 'account settings']),
  setting('about', 'About hyPer', 'About', 'about', ['app version', 'build number', 'haptics test']),
  { id: 'dashboard', title: 'Today', path: 'App · Today', href: '/', aliases: ['dashboard', 'home', 'daily overview'] },
  { id: 'training', title: 'Training', path: 'App · Training', href: '/train', aliases: ['start workout', 'log workout', 'lift weights', 'exercise', 'sets', 'reps'] },
  { id: 'program', title: 'Program', path: 'Training · Program', href: '/train/program', aliases: ['change my routine', 'workout split', 'training plan', 'edit program', 'delete program', 'workout templates'] },
  { id: 'run', title: 'Start a run', path: 'Training · Run', href: '/train/run', aliases: ['running', 'track run', 'gps', 'cardio'] },
  { id: 'nutrition', title: 'Food logging', path: 'App · Nutrition', href: '/nutrition', aliases: ['log food', 'log meal', 'add food', 'scan barcode', 'food photo', 'track nutrition', 'edit nutrition'] },
  { id: 'history', title: 'History', path: 'App · History', href: '/history', aliases: ['past workouts', 'edit workout', 'previous sessions', 'workout history'] },
  { id: 'progress', title: 'Analysis', path: 'App · Analysis', href: '/analysis', aliases: ['progress', 'training volume', 'muscle volume', 'volume recommendations', 'statistics', 'charts'] },
];

const STOP_WORDS = new Set(['a', 'an', 'the', 'my', 'me', 'i', 'to', 'of', 'for', 'and', 'is', 'it', 'in', 'on', 'how', 'do', 'can', 'where', 'please', 'want', 'find', 'change', 'set', 'settings']);
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (value: string) => normalize(value).split(' ').filter(Boolean);

// One edit, including transposed adjacent letters; short words must match exactly.
function isNear(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const different = [...a].map((letter, index) => letter === b[index] ? -1 : index).filter((index) => index >= 0);
    return different.length === 1 || (different.length === 2 && different[1] === different[0] + 1 && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index++;
  return shorter.slice(index) === longer.slice(index + 1);
}

const indexed = APP_SEARCH_ENTRIES.map((entry) => ({
  entry,
  title: normalize(entry.title),
  phrases: [entry.title, ...entry.aliases].map(normalize),
  tokens: [...new Set([entry.title, entry.path, ...entry.aliases].flatMap(words))],
}));
const SUGGESTIONS = ['appearance', 'weight-units', 'targets', 'saved-meals', 'program', 'history'];

export function searchApp(query: string, { nativeIOS }: { nativeIOS: boolean }): AppSearchEntry[] {
  const normalized = normalize(query.slice(0, 200));
  const available = indexed.filter(({ entry }) => !entry.iosOnly || nativeIOS);
  if (!normalized) return SUGGESTIONS.flatMap((id) => available.filter(({ entry }) => entry.id === id).map(({ entry }) => entry));
  const queryWords = [...new Set(words(normalized).filter((word) => !STOP_WORDS.has(word)))];
  if (!queryWords.length) return [];
  return available.map((item) => {
    const matches = queryWords.map((word) => Math.max(0, ...item.tokens.map((token) =>
      token === word ? 10 : word.length >= 3 && token.startsWith(word) ? 7 : isNear(word, token) ? 4 : 0,
    )));
    // Every meaningful word must be explained, so unsupported requests do not produce noise.
    if (matches.some((score) => score === 0)) return { entry: item.entry, score: 0 };
    const phraseBonus = item.title === normalized ? 100 : item.phrases.includes(normalized) ? 70 : item.phrases.some((phrase) => phrase.includes(normalized)) ? 30 : 0;
    const titleBonus = queryWords.filter((word) => words(item.title).includes(word)).length * 5;
    return { entry: item.entry, score: matches.reduce((sum, score) => sum + score, 0) + phraseBonus + titleBonus };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, 12).map(({ entry }) => entry);
}
