// You: body weight, targets, saved meals, connections and appearance. The
// rules come from ../src (the web You page uses the same ones); this file
// holds what the native screens share between them.
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Appearance } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { getFoodAnalysisMode, saveFoodAnalysisMode } from '@/lib/foodTrial';
import { WEIGHT_TREND_WINDOW_DAYS } from '@/lib/bodyWeightSummary';
import {
  HEALTH_SYNC_STOPPED_MESSAGE,
  connectOrSyncHealthWeights,
  deleteManualBodyWeight,
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
import { whoopCallbackStatus } from '@/lib/whoopStatus';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { Food } from '@/types';

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

/** Everything the You page shows: weight, targets, saved meals and WHOOP. */
export async function loadYou(): Promise<void> {
  await Promise.allSettled([loadWeights(), loadTargets(), loadYouMeals(), useAppStore.getState().fetchWhoopConnection()]);
}

// ── Body weight ──────────────────────────────────────────────────────────

type WeightState = {
  history: BodyWeightMeasurement[];
  loading: boolean;
  failed: boolean;
  unit: WeightUnit;
};

export const useWeightStore = create<WeightState>(() => ({
  history: [],
  loading: true,
  failed: false,
  unit: getPreferredWeightUnit(),
}));

/** The last 60 days of weigh-ins, newest first. A failed read keeps what is shown. */
export async function loadWeights(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const isCurrent = captureAccountScope();
  useWeightStore.setState({ loading: true });
  try {
    const history = await getBodyWeightHistorySince(userId, WEIGHT_TREND_WINDOW_DAYS);
    if (isCurrent()) useWeightStore.setState({ history, failed: false });
  } catch {
    if (isCurrent()) useWeightStore.setState({ failed: true });
  } finally {
    if (isCurrent()) useWeightStore.setState({ loading: false });
  }
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
    await loadWeights();
    return true;
  } catch (error) {
    useHealthStore.setState({
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
 */
export async function loadTargets(): Promise<void> {
  const userId = currentUserId();
  if (!userId) return;
  const isCurrent = captureAccountScope();
  useTargetsStore.setState({ status: 'loading' });
  try {
    const [target, profile] = await Promise.all([
      supabase.from('macro_targets').select('*').eq('user_id', userId).maybeSingle(),
      getNutritionProfile(userId),
    ]);
    if (target.error) throw target.error;
    if (!isCurrent()) return;
    useAppStore.setState({ macroTarget: target.data ?? null, nutritionProfile: profile });
    useTargetsStore.setState({ status: 'ready' });
  } catch {
    if (isCurrent()) useTargetsStore.setState({ status: 'error' });
  }
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

/** Connects WHOOP through iOS's sign-in sheet. Null when the person closed the sheet. */
export async function connectWhoop(): Promise<{ ok: boolean; message: string } | null> {
  try {
    const authorizeUrl = await useAppStore.getState().connectWhoop(WHOOP_RETURN);
    // Sample data connects without a consent screen.
    if (!authorizeUrl) return { ok: true, message: 'WHOOP connected.' };
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, WHOOP_RETURN, { preferEphemeralSession: false });
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success' || whoopCallbackStatus(result.url) !== 'connected') {
      return { ok: false, message: 'WHOOP connection failed. Try again.' };
    }
    await useAppStore.getState().fetchWhoopConnection();
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
  useWeightStore.setState({ history: [], loading: true, failed: false });
  useTargetsStore.setState({ status: 'loading', staged: null, message: null });
  useYouMealsStore.setState({ meals: null, failed: false });
  useHealthStore.setState({ busy: false, message: null });
}

/** Deletes a typed weigh-in; it leaves the list at once and comes back if the delete fails. */
export async function deleteWeighIn(measurement: BodyWeightMeasurement): Promise<boolean> {
  const userId = currentUserId();
  if (!userId || measurement.source !== 'manual') return false;
  const before = useWeightStore.getState().history;
  useWeightStore.setState({ history: before.filter((entry) => entry.id !== measurement.id) });
  try {
    await deleteManualBodyWeight(userId, measurement.id);
    return true;
  } catch {
    useWeightStore.setState((state) => ({
      history: [...state.history, measurement].sort((a, b) => b.measured_at.localeCompare(a.measured_at)),
    }));
    return false;
  }
}
