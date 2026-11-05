// You: body weight, targets, saved meals, connections and appearance. The
// rules come from ../src (the web You page uses the same ones); this file
// holds what the native screens share between them.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { getFoodAnalysisMode, saveFoodAnalysisMode } from '@/lib/foodTrial';
import { WEIGHT_TREND_WINDOW_DAYS } from '@/lib/bodyWeightSummary';
import {
  HEALTH_SYNC_STOPPED_MESSAGE,
  bodyWeightWindowStart,
  connectOrSyncHealthWeights,
  deleteManualBodyWeight,
  getAllBodyWeights,
  getBodyWeightHistorySince,
  healthSyncMessage,
  isHealthWeightSyncEnabled,
  recordManualBodyWeight,
  setHealthWeightSyncEnabled,
  type BodyWeightMeasurement,
} from '@/lib/healthWeights';
import { decodeMealComposition } from '@/lib/mealComposition';
import type { CoachRecommendation } from '@/lib/nutritionCoach';
import { getNutritionProfile } from '@/lib/nutritionProfile';
import { loadSavedMeals } from '@/lib/savedMeals';
import type { TargetDraft } from '@/lib/settingsUx';
import { supabase } from '@/lib/supabase';
import { getPreferredWeightUnit, setPreferredWeightUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import { mergeWeightHistory } from '@/lib/weightHistory';
import { whoopCallbackStatus } from '@/lib/whoopStatus';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { Food } from '@/types';
import { isPreviewActive } from '~/platform/previewFlag';

const currentUserId = () => useAuthStore.getState().user?.id ?? null;

// ── Pull to refresh ──────────────────────────────────────────────────────

/**
 * Pull to refresh for a You screen: the spinner shows only while the pull's
 * own reload runs (a reload started elsewhere never spins it), and a failed
 * reload leaves what is shown, as each loader does.
 */
export function usePullRefresh(load: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } catch {
      // Each loader keeps what is shown and says so itself.
    } finally {
      setRefreshing(false);
    }
  };
  return { refreshing, refresh };
}

/**
 * Everything the You page shows: weight, targets, saved meals and WHOOP. Every
 * weigh-in is read as well as the recent ones, so Body weight opens with its
 * whole history drawn, while the card still shows as soon as the short read
 * lands, however long the history.
 */
export async function loadYou(): Promise<void> {
  await Promise.allSettled([
    loadWeights(),
    loadWeights({ all: true }),
    loadTargets(),
    loadYouMeals(),
    useAppStore.getState().fetchWhoopConnection(),
  ]);
}

// ── Body weight ──────────────────────────────────────────────────────────

type WeightState = {
  /** The weigh-ins of the last WEIGHT_TREND_WINDOW_DAYS days, newest first. */
  history: BodyWeightMeasurement[];
  /** Where `history`'s window starts (an ISO time), from the read that brought it. */
  historySince: string | null;
  loading: boolean;
  failed: boolean;
  unit: WeightUnit;
  /**
   * Every weigh-in, newest first, from the last full read (Body weight and
   * All weigh-ins ask for one); null until one lands. Its recent part is
   * shown from `history`, which every log and sync reads again.
   */
  all: BodyWeightMeasurement[] | null;
  /** The last full read failed: only the recent weigh-ins can be shown. */
  allFailed: boolean;
};

export const useWeightStore = create<WeightState>(() => ({
  history: [],
  historySince: null,
  loading: true,
  failed: false,
  unit: getPreferredWeightUnit(),
  all: null,
  allFailed: false,
}));

// Reads can overlap (a log's read while the screen's full read runs). Each
// takes a number; an answer is shown only if no read started after it has
// been shown already, so a slow older read can't hide a weigh-in just logged.
let readsStarted = 0;
let recentShown = 0;
let allShown = 0;
/** The reads still running, each with its account's check. */
const readsRunning = new Map<number, () => boolean>();

/**
 * Weigh-ins deleted here, or being deleted. A read that started before a
 * delete landed still holds the row; it must not bring it back (nothing
 * would take it away again for one older than the recent window).
 */
const removedWeighIns = new Set<string>();
const withoutRemoved = (list: BodyWeightMeasurement[]) =>
  removedWeighIns.size === 0 ? list : list.filter((entry) => !removedWeighIns.has(entry.id));

/**
 * Reads the weigh-ins of the last WEIGHT_TREND_WINDOW_DAYS days, newest
 * first, or with `all` every weigh-in (which brings the recent ones too). A
 * failed read keeps what is shown.
 */
export async function loadWeights({ all = false }: { all?: boolean } = {}): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const isCurrent = captureAccountScope();
  const read = ++readsStarted;
  readsRunning.set(read, isCurrent);
  useWeightStore.setState({ loading: true });
  const now = new Date();
  const since = bodyWeightWindowStart(WEIGHT_TREND_WINDOW_DAYS, now);
  try {
    if (all) {
      const everything = withoutRemoved(await getAllBodyWeights(userId));
      if (!isCurrent()) return;
      const sinceMs = Date.parse(since);
      const recent = read >= recentShown ? everything.filter((entry) => Date.parse(entry.measured_at) >= sinceMs) : null;
      if (recent) recentShown = read;
      if (read >= allShown) allShown = read;
      useWeightStore.setState({
        ...(read === allShown ? { all: everything, allFailed: false } : null),
        ...(recent ? { history: recent, historySince: since, failed: false } : null),
      });
    } else {
      const history = withoutRemoved(await getBodyWeightHistorySince(userId, WEIGHT_TREND_WINDOW_DAYS, now));
      if (isCurrent() && read >= recentShown) {
        recentShown = read;
        useWeightStore.setState({ history, historySince: since, failed: false });
      }
    }
  } catch {
    // Said only while nothing newer is shown.
    if (isCurrent()) {
      useWeightStore.setState({
        ...(read >= recentShown ? { failed: true } : null),
        ...(all && read >= allShown ? { allFailed: true } : null),
      });
    }
  } finally {
    readsRunning.delete(read);
    // Loading while another read for this account still runs.
    if (isCurrent()) useWeightStore.setState({ loading: [...readsRunning.values()].some((current) => current()) });
  }
}

/**
 * Every weigh-in, newest first, once a full read has landed: the full read for
 * older ones joined to the recent read. After a failed full read, the recent
 * ones alone; before any, null.
 */
export function useAllWeighIns(): BodyWeightMeasurement[] | null {
  const history = useWeightStore((state) => state.history);
  const since = useWeightStore((state) => state.historySince);
  const all = useWeightStore((state) => state.all);
  const allFailed = useWeightStore((state) => state.allFailed);
  return useMemo(() => (all ? mergeWeightHistory(history, since, all) : allFailed ? history : null), [history, since, all, allFailed]);
}

export function setWeightUnit(unit: WeightUnit) {
  setPreferredWeightUnit(unit);
  useWeightStore.setState({ unit });
}

/** Records a typed weigh-in, then reloads the history. Returns an error message or null. */
export async function logWeighIn(kilograms: number): Promise<string | null> {
  const userId = currentUserId();
  if (!userId) return 'Sign in again to log your weight.';
  try {
    await recordManualBodyWeight(userId, kilograms);
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not save that weigh-in.';
  }
  await loadWeights();
  return null;
}

// ── Apple Health ─────────────────────────────────────────────────────────

type HealthState = { enabled: boolean; busy: boolean; message: { text: string; alert?: boolean } | null };

export const useHealthStore = create<HealthState>(() => ({
  enabled: isHealthWeightSyncEnabled(),
  busy: false,
  message: null,
}));

/** First tap: asks iOS for access and turns automatic sync on. Later taps sync now. */
export async function connectOrSyncHealth(): Promise<boolean> {
  const userId = currentUserId();
  const { enabled, busy } = useHealthStore.getState();
  if (!userId || busy) return false;
  useHealthStore.setState({ busy: true, message: null });
  try {
    const result = await connectOrSyncHealthWeights(userId, enabled);
    useHealthStore.setState({ enabled: true, message: { text: healthSyncMessage(result) } });
    // An import can bring years of older weigh-ins: once every weigh-in was read, read them all again.
    await loadWeights({ all: useWeightStore.getState().all !== null });
    return true;
  } catch (error) {
    useHealthStore.setState({
      // The switch follows the stored setting: once access was granted it is
      // on, even if that first sync failed, and automatic sync retries.
      enabled: isHealthWeightSyncEnabled(),
      message: { text: error instanceof Error ? error.message : 'Apple Health sync failed.', alert: true },
    });
    return false;
  } finally {
    useHealthStore.setState({ busy: false });
  }
}

/** Stops automatic sync on this phone; imported weigh-ins and iOS's permission stay. */
export function stopHealthSync() {
  setHealthWeightSyncEnabled(false);
  useHealthStore.setState({ enabled: false, message: { text: HEALTH_SYNC_STOPPED_MESSAGE } });
}

// ── Targets ──────────────────────────────────────────────────────────────

type TargetsState = {
  status: 'loading' | 'ready' | 'error';
  /**
   * Targets handed to the edit sheet by the calculator or the coach. The sheet
   * takes them when it opens; nothing is saved until Save there.
   */
  staged: { draft: TargetDraft; coach: CoachRecommendation | null; profileSaved: boolean } | null;
  message: { text: string; alert?: boolean } | null;
};

export const useTargetsStore = create<TargetsState>(() => ({ status: 'loading', staged: null, message: null }));

/**
 * Reads the saved targets and nutrition profile together, as the web You page
 * does. A successful empty read clears them; a failed one keeps what is shown.
 * True once they are read for this account.
 */
export async function loadTargets(): Promise<boolean> {
  const userId = currentUserId();
  if (!userId) return false;
  const isCurrent = captureAccountScope();
  useTargetsStore.setState({ status: 'loading' });
  try {
    const [target, profile] = await Promise.all([
      supabase.from('macro_targets').select('*').eq('user_id', userId).maybeSingle(),
      getNutritionProfile(userId),
    ]);
    if (target.error) throw target.error;
    if (!isCurrent()) return false;
    useAppStore.setState({
      macroTarget: target.data ?? null,
      nutritionProfile: profile,
      macroTargetLoadedForUserId: userId,
      nutritionProfileLoadedForUserId: userId,
    });
    useTargetsStore.setState({ status: 'ready' });
    return true;
  } catch {
    if (isCurrent()) useTargetsStore.setState({ status: 'error' });
    return false;
  }
}

/**
 * Whether the saved targets (or the nutrition profile) are read for the
 * signed-in account, reading them if not. The edit sheet and the calculator
 * start from them, so they wait: opened before the read (Fuel's figures on a
 * cold launch) they began at the defaults, and saving wrote those over the
 * real targets, or a profile without its learned burn.
 */
export function useTargetsLoaded(what: 'targets' | 'profile'): { loaded: boolean; failed: boolean; retry: () => void } {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const loaded = useAppStore((state) =>
    userId !== null
    && (what === 'targets' ? state.macroTargetLoadedForUserId : state.nutritionProfileLoadedForUserId) === userId);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadTargets().then((ok) => {
      if (live && !ok) setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [loaded, attempt]);
  const retry = () => {
    setFailed(false);
    setAttempt((count) => count + 1);
  };
  return { loaded, failed: !loaded && failed, retry };
}

export function stageTargets(draft: TargetDraft, extra: { coach?: CoachRecommendation; profileSaved?: boolean } = {}) {
  useTargetsStore.setState({
    staged: { draft, coach: extra.coach ?? null, profileSaved: extra.profileSaved ?? false },
  });
}

// ── Saved meals ──────────────────────────────────────────────────────────

type MealsState = { meals: Food[] | null; failed: boolean };

export const useYouMealsStore = create<MealsState>(() => ({ meals: null, failed: false }));

/** The saved meals, one per name, as Fuel's Saved tab lists them. */
export async function loadYouMeals(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const isCurrent = captureAccountScope();
  const { meals, error } = await loadSavedMeals(userId);
  if (!isCurrent()) return;
  if (error) useYouMealsStore.setState((state) => ({ failed: true, meals: state.meals ?? [] }));
  else useYouMealsStore.setState({ meals, failed: false });
}

// ── Food analysis ────────────────────────────────────────────────────────

export type AnalysisMode = 'gemini' | 'worker';

/** Gemini (hosted) or the Mac worker, kept on this phone as on the web. */
export const useAnalysisModeStore = create<{ mode: AnalysisMode }>(() => ({ mode: getFoodAnalysisMode() }));

export function chooseAnalysisMode(mode: AnalysisMode) {
  saveFoodAnalysisMode(mode);
  useAnalysisModeStore.setState({ mode });
}

/** Opens a saved meal for editing: its numbers, or the meal builder for a built meal. */
export function editSavedMeal(meal: Food) {
  if (decodeMealComposition(meal.description)) router.push({ pathname: '/log-food', params: { savedMeal: meal.id } });
  else router.push({ pathname: '/saved-meal', params: { id: meal.id } });
}

// ── WHOOP ────────────────────────────────────────────────────────────────

/**
 * The return address WHOOP's consent screen may send back to. The whoop-oauth
 * function accepts only the iPhone app's own address (or the web app), so this
 * app uses it too: iOS's sign-in sheet catches the return inside the sheet, so
 * it never reaches the other app. At cutover this app takes over that scheme.
 */
const WHOOP_RETURN = 'app.hyper.mobile://settings';

/** The first import; one that fails waits for Sync now or the next return to the app. */
function startWhoopImport() {
  useAppStore.getState().syncWhoop().catch(() => {});
}

/**
 * Connects WHOOP through iOS's sign-in sheet, then starts the first import
 * (the sheet never sends the app to the background, so the foreground sync
 * would wait for the next return). Null when the person closed the sheet.
 */
export async function connectWhoop(): Promise<{ ok: boolean; message: string } | null> {
  try {
    const authorizeUrl = await useAppStore.getState().connectWhoop(WHOOP_RETURN);
    if (!authorizeUrl) {
      // Sample data connects without a consent screen.
      if (!isPreviewActive()) return { ok: false, message: 'WHOOP connection failed. Try again.' };
      startWhoopImport();
      return { ok: true, message: 'WHOOP connected.' };
    }
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, WHOOP_RETURN, { preferEphemeralSession: false });
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success' || whoopCallbackStatus(result.url) !== 'connected') {
      return { ok: false, message: 'WHOOP connection failed. Try again.' };
    }
    await useAppStore.getState().fetchWhoopConnection();
    startWhoopImport();
    return { ok: true, message: 'WHOOP connected.' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not start the WHOOP connection. ${reason}`.trim() };
  }
}

// ── Appearance ───────────────────────────────────────────────────────────

export type AppearanceChoice = 'system' | 'light' | 'dark';

// The web app's key, so the choice reads the same way on both.
const THEME_KEY = 'hyper-theme';

function storedAppearance(): AppearanceChoice {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Unreadable storage follows the phone.
  }
  return 'system';
}

function applyAppearance(choice: AppearanceChoice) {
  Appearance.setColorScheme(choice === 'system' ? 'auto' : choice);
}

export const useAppearanceStore = create<{ choice: AppearanceChoice }>(() => ({ choice: storedAppearance() }));

/** Applies the saved choice; called once before the first screen draws. */
export function restoreAppearance() {
  const choice = useAppearanceStore.getState().choice;
  if (choice !== 'system') applyAppearance(choice);
}

export function chooseAppearance(choice: AppearanceChoice) {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, choice);
  } catch {
    // The choice still applies until the app closes.
  }
  applyAppearance(choice);
  useAppearanceStore.setState({ choice });
}

export const APPEARANCE_LABELS: Record<AppearanceChoice, string> = {
  system: 'Automatic',
  light: 'Light',
  dark: 'Dark',
};

// ── Sign-out ─────────────────────────────────────────────────────────────

/** Leaves nothing of this account in You's screens. */
export function resetYou() {
  useWeightStore.setState({ history: [], historySince: null, loading: true, failed: false, all: null, allFailed: false });
  useTargetsStore.setState({ status: 'loading', staged: null, message: null });
  useYouMealsStore.setState({ meals: null, failed: false });
  useHealthStore.setState({ busy: false, message: null });
}

/** Deletes a typed weigh-in; it leaves the list at once and comes back if the delete fails. */
export async function deleteWeighIn(measurement: BodyWeightMeasurement): Promise<boolean> {
  const userId = currentUserId();
  if (!userId || measurement.source !== 'manual') return false;
  const isCurrent = captureAccountScope();
  const before = useWeightStore.getState();
  const has = (list: BodyWeightMeasurement[] | null) => list?.some((entry) => entry.id === measurement.id) ?? false;
  const wasRecent = has(before.history);
  const wasInAll = has(before.all);
  const without = (list: BodyWeightMeasurement[]) => list.filter((entry) => entry.id !== measurement.id);
  // Kept out of any read that lands from now on, unless the delete fails.
  removedWeighIns.add(measurement.id);
  useWeightStore.setState((state) => ({ history: without(state.history), all: state.all ? without(state.all) : null }));
  try {
    await deleteManualBodyWeight(userId, measurement.id);
    return true;
  } catch {
    removedWeighIns.delete(measurement.id);
    // Back where it was, in each list it was in.
    const putBack = (list: BodyWeightMeasurement[]) =>
      [...without(list), measurement].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
    if (isCurrent()) {
      useWeightStore.setState((state) => ({
        history: wasRecent ? putBack(state.history) : state.history,
        all: wasInAll && state.all ? putBack(state.all) : state.all,
      }));
    }
    return false;
  }
}
