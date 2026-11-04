// The phone's copy of the last program, quick starts, week, targets and
// today's food, so a cold start opens onto them while the account load reads
// them again. Each part is its own key in expo-sqlite's localStorage
// (synchronous, so the first frame can use it). A part is saved only from this
// launch's own reads or the person's own edits, never from the copy itself,
// and no store's loaded marker is ever set from it. The live workout is never
// kept: only whether one was live. Nothing secret; sign-out, another account or
// a launch with no saved sign-in removes it all; preview never touches it.
// Rules: launchSnapshot.ts.
import { create } from 'zustand';

import { initialAppData, useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { isFuelMonthFromCopy, restoreFuelCopy, useFuelStore } from './fuel';
import {
  LAUNCH_SNAPSHOT_VERSION,
  PARTS,
  PART_LIMIT,
  partKey,
  planLaunchRestore,
  readEnvelope,
  serializeEnvelope,
  stableWeek,
  type Envelope,
  type LaunchRestore,
  type Part,
  type TodaySeed,
} from './launchSnapshot';

type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type AuthSnapshot = ReturnType<typeof useAuthStore.getState>;
type AppSnapshot = ReturnType<typeof useAppStore.getState>;
type FuelSnapshot = ReturnType<typeof useFuelStore.getState>;
export type LaunchCacheOptions = {
  preview: boolean;
  /** The backend's host (launchSnapshot's backendOf); empty turns the copy off. */
  backend: string;
  /** The app's version and build number: each new build drops the copy once. */
  build: string;
  storage?: KeyValue;
  now?: () => Date;
  /** Called once with the flush, for the app leaving the screen. */
  onLeave?: (save: () => void) => void;
};

/** What the copy says about Today's plan card (useTodayPlan). */
export const useLaunchHint = create<{ seed: TodaySeed | null; holdPlan: boolean }>(() => ({ seed: null, holdPlan: false }));

const SAVE_DELAY_MS = 1_000;
let installed = false;
let storage: KeyValue | null = null;
let stampBase = { backend: '', build: '' };
let clock = () => new Date();
let pending: Partial<Record<Part, Envelope>> | null = null;
let restoring = false;
// Parts with no loaded marker: what came from the copy, so it is never saved back as new.
let fromCopy: { flexTemplates?: unknown; weeklyVolume?: unknown; volumeLandmarks?: unknown } = {};
let volumeWeek: string | null = null;
let todaySeed: TodaySeed | null = null;
const dirty = new Set<Part>();
let timer: ReturnType<typeof setTimeout> | null = null;
const written = new Map<Part, string>();

export function installLaunchCache(options: LaunchCacheOptions) {
  if (installed || options.preview || !options.backend) return;
  installed = true;
  try {
    storage = options.storage ?? (globalThis as { localStorage?: KeyValue }).localStorage ?? null;
  } catch {
    storage = null;
  }
  stampBase = { backend: options.backend, build: options.build };
  if (options.now) clock = options.now;
  pending = readAll();
  useAuthStore.subscribe(onAuth);
  useAppStore.subscribe(onApp);
  useFuelStore.subscribe(onFuel);
  options.onLeave?.(flushLaunchCache);
  const auth = useAuthStore.getState();
  if (auth.user) onAuth(auth, { ...auth, user: null }); // defensive: sign-in already known
}

function readAll(): Partial<Record<Part, Envelope>> {
  const copies: Partial<Record<Part, Envelope>> = {};
  for (const part of PARTS) {
    try {
      const { envelope, remove } = readEnvelope(storage?.getItem(partKey(part)) ?? null, part, { ...stampBase, now: clock() });
      if (envelope) copies[part] = envelope;
      else if (remove) storage?.removeItem(partKey(part));
    } catch {
      // an unreadable part is a network launch for that part
    }
  }
  return copies;
}

function onAuth(state: AuthSnapshot, prev: AuthSnapshot) {
  try {
    const next = state.user?.id ?? null;
    const before = prev.user?.id ?? null;
    if (before && next !== before) {
      clearLaunchCache(); // sign-out or another account
      return;
    }
    if (!before && next) {
      const copies = pending;
      pending = null;
      if (copies) restore(copies, next);
      return;
    }
    // No saved sign-in on this phone (not just offline): nothing of the last
    // account stays. Leaving the offline wait sets reconnecting before the
    // user (TOKEN_REFRESHED brings one in the same tick), so that case waits a
    // microtask to see whether someone was signed in.
    if (!next && pending && state.initialized && !state.reconnecting) {
      if (!prev.reconnecting) clearLaunchCache();
      else void Promise.resolve().then(clearIfNobody);
    }
  } catch {
    // the copy never breaks sign-in
  }
}

function clearIfNobody() {
  const auth = useAuthStore.getState();
  if (pending && !auth.user && auth.initialized && !auth.reconnecting) clearLaunchCache();
}

function restore(copies: Partial<Record<Part, Envelope>>, userId: string) {
  const plan = planLaunchRestore(copies, userId, clock());
  if (plan.foreign) {
    clearLaunchCache();
    return;
  }
  if (!pristine()) return;
  restoring = true;
  try {
    apply(plan);
  } finally {
    restoring = false;
  }
}

/** Nothing has loaded yet: the copy never replaces a real read. */
function pristine() {
  const a = useAppStore.getState();
  const f = useFuelStore.getState();
  return a.hydratedForUserId === null && a.workoutLoadedForUserId === null
    && a.macroTargetLoadedForUserId === null && a.nutritionProfileLoadedForUserId === null
    && a.splits === initialAppData.splits && a.flexTemplates === initialAppData.flexTemplates
    && a.weeklyVolume === initialAppData.weeklyVolume
    && a.currentWorkout === null && a.macroTarget === null && a.nutritionProfile === null
    && f.loadedMonth === null && f.status === 'idle' && f.todayLoadedForUserId === null;
}

function apply(plan: LaunchRestore) {
  // Noted first, so nothing restored can ever pass for this launch's own read.
  fromCopy = {
    flexTemplates: plan.templates ?? undefined,
    weeklyVolume: plan.volume?.weeklyVolume,
    volumeLandmarks: plan.volume?.volumeLandmarks,
  };
  todaySeed = plan.seed;
  useAppStore.setState({
    ...(plan.program ?? {}),
    ...(plan.templates ? { flexTemplates: plan.templates } : {}),
    ...(plan.volume ?? {}),
    ...(plan.target ? { macroTarget: plan.target.value } : {}),
    ...(plan.profile ? { nutritionProfile: plan.profile.value } : {}),
  });
  if (plan.fuel) restoreFuelCopy(plan.fuel);
  useLaunchHint.setState({ seed: plan.seed, holdPlan: plan.holdPlan });
}

function onApp(state: AppSnapshot, prev: AppSnapshot) {
  if (restoring || !installed) return;
  try {
    if (state.splits !== prev.splits || state.workoutMode !== prev.workoutMode || state.hydratedForUserId !== prev.hydratedForUserId) mark('program');
    if (state.flexTemplates !== prev.flexTemplates) mark('templates');
    if (state.weeklyVolume !== prev.weeklyVolume || state.volumeLandmarks !== prev.volumeLandmarks) {
      volumeWeek = stableWeek(clock());
      mark('volume');
    }
    if (state.macroTarget !== prev.macroTarget || state.macroTargetLoadedForUserId !== prev.macroTargetLoadedForUserId) mark('target');
    if (state.nutritionProfile !== prev.nutritionProfile || state.nutritionProfileLoadedForUserId !== prev.nutritionProfileLoadedForUserId) {
      mark('profile');
    }
    const id = state.currentWorkout?.id ?? null;
    const idChanged = id !== (prev.currentWorkout?.id ?? null);
    if (idChanged) {
      // Starting or finishing a session changes today's plan.
      todaySeed = null;
      useLaunchHint.setState({ seed: null });
    }
    // Synchronous: a workout started or finished just before the app is closed is never lost.
    if (idChanged || state.workoutLoadedForUserId !== prev.workoutLoadedForUserId) save('training');
  } catch {
    // the copy never breaks a store write
  }
}

function onFuel(state: FuelSnapshot, prev: FuelSnapshot) {
  if (restoring || !installed) return;
  const dayChanged = state.todayLoadedForUserId !== prev.todayLoadedForUserId || state.todayLoadedKey !== prev.todayLoadedKey;
  if (dayChanged || state.todayTotals !== prev.todayTotals || state.todayKey !== prev.todayKey) mark('today');
  if (dayChanged || state.logs !== prev.logs || state.groups !== prev.groups || state.loadedMonth !== prev.loadedMonth) mark('month');
}

function mark(part: Part) {
  dirty.add(part);
  timer ??= setTimeout(saveDirty, SAVE_DELAY_MS);
}

function saveDirty() {
  timer = null;
  const parts = [...dirty];
  dirty.clear();
  for (const part of parts) save(part);
}

function save(part: Part) {
  const userId = useAuthStore.getState().user?.id;
  if (!installed || !storage || !userId) return;
  let body: unknown;
  try {
    body = freshBody(part, userId);
  } catch {
    return;
  }
  if (body === undefined) return; // nothing this launch has read or written: the saved copy stays as it is
  const stamp = { v: LAUNCH_SNAPSHOT_VERSION, part, userId, ...stampBase, savedAt: clock().getTime() };
  let out: ReturnType<typeof serializeEnvelope>;
  try {
    out = serializeEnvelope(stamp, body, PART_LIMIT[part]);
  } catch {
    out = null;
  }
  persist(part, out);
}

/** A part's body from this launch's own reads or edits, or undefined when nothing of it is fresh. */
function freshBody(part: Part, userId: string): unknown {
  const a = useAppStore.getState();
  const f = useFuelStore.getState();
  const own = (rows: readonly { user_id: string }[]) => rows.every((row) => row.user_id === userId);
  const dayFresh = f.todayLoadedForUserId === userId && f.todayLoadedKey === f.todayKey;
  switch (part) {
    case 'program':
      return a.hydratedForUserId === userId && own(a.splits) ? { splits: a.splits, workoutMode: a.workoutMode } : undefined;
    case 'templates':
      // No marker: a read that changed nothing keeps the copy's array (appStore's
      // sameData), so only a new array counts as this launch's.
      return a.flexTemplates !== initialAppData.flexTemplates && a.flexTemplates !== fromCopy.flexTemplates && own(a.flexTemplates)
        ? { templates: a.flexTemplates }
        : undefined;
    case 'volume': {
      // calculateWeeklyVolume sets only the half that changed, so a new array in
      // either half shows that this launch's read landed.
      const newVolume = a.weeklyVolume !== initialAppData.weeklyVolume && a.weeklyVolume !== fromCopy.weeklyVolume;
      const newLandmarks = a.volumeLandmarks !== initialAppData.volumeLandmarks && a.volumeLandmarks !== fromCopy.volumeLandmarks;
      return volumeWeek && (newVolume || newLandmarks) && own(a.volumeLandmarks)
        ? { weekStart: volumeWeek, weeklyVolume: a.weeklyVolume, volumeLandmarks: a.volumeLandmarks }
        : undefined;
    }
    case 'target':
      return a.macroTargetLoadedForUserId === userId && (!a.macroTarget || a.macroTarget.user_id === userId)
        ? { value: a.macroTarget }
        : undefined;
    case 'profile':
      return a.nutritionProfileLoadedForUserId === userId && (!a.nutritionProfile || a.nutritionProfile.user_id === userId)
        ? { value: a.nutritionProfile }
        : undefined;
    case 'today':
      return dayFresh ? { dayKey: f.todayKey, totals: f.todayTotals } : undefined;
    case 'month':
      return dayFresh && f.loadedMonth === f.todayKey.slice(0, 7) && !isFuelMonthFromCopy() && own(f.logs) && own(f.groups)
        ? { month: f.loadedMonth, dayKey: f.todayKey, logs: f.logs, groups: f.groups }
        : undefined;
    case 'training': {
      if (a.workoutLoadedForUserId !== userId) return undefined;
      const w = a.currentWorkout;
      if (w && w.user_id !== userId) return undefined;
      const live = w && !w.completed ? w : null;
      return {
        workout: live ? { id: live.id, created_at: live.created_at ?? null, date: live.date } : null,
        today: live ? null : todaySeed,
      };
    }
  }
}

function persist(part: Part, out: { json: string; body: string } | null) {
  if (!storage) return;
  const key = partKey(part);
  try {
    if (!out) {
      // Too big to keep: no copy rather than an older one.
      if (written.get(part) !== '') {
        storage.removeItem(key);
        written.set(part, '');
      }
      return;
    }
    if (written.get(part) === out.body) return;
    storage.setItem(key, out.json);
    written.set(part, out.body);
  } catch {
    written.delete(part);
    // An older copy must not outlive a failed save: that launch reads from the network instead.
    try {
      storage.removeItem(key);
    } catch {
      /* nothing more to do */
    }
  }
}

/** Today's plan as decided from this launch's own reads, kept for the next cold start and for screens mounted later. */
export function noteTodayPlan(seed: TodaySeed) {
  if (!installed) return;
  todaySeed = seed;
  if (JSON.stringify(useLaunchHint.getState().seed) !== JSON.stringify(seed)) useLaunchHint.setState({ seed });
  save('training');
}

/** Saves what is waiting now (the app is leaving the screen). */
export function flushLaunchCache() {
  if (!timer) return;
  clearTimeout(timer);
  saveDirty();
}

/** Removes every part (sign-out, another account, no saved sign-in). */
export function clearLaunchCache() {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty.clear();
  written.clear();
  pending = null;
  fromCopy = {};
  volumeWeek = null;
  todaySeed = null;
  for (const part of PARTS) {
    try {
      storage?.removeItem(partKey(part));
    } catch {
      /* the next launch's checks still apply */
    }
  }
  useLaunchHint.setState({ seed: null, holdPlan: false });
}
