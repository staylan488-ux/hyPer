import { useCallback, useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react';
import { ArrowLeft, LogOut, Pencil, Search, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams, useLocation, useBlocker } from 'react-router-dom';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Button, Input, Modal, Screen, SelectSheet, ThemeToggle } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useThemeStore } from '@/stores/themeStore';
import { supabase } from '@/lib/supabase';
import { normalizeFoodName, shouldDropColumn } from '@/components/nutrition/foodLoggerUtils';
import { MealLogger } from '@/components/nutrition/MealLogger';
import { decodeMealComposition } from '@/lib/mealComposition';
import {
  NutritionWizard,
  type NutritionWizardOutcome,
} from '@/components/nutrition/NutritionWizard';
import { GoalsCoach } from '@/components/nutrition/GoalsCoach';
import type { CoachRecommendation } from '@/lib/nutritionCoach';
import { DEFAULT_MACRO_TARGET, type Food, type MacroTargetSource } from '@/types';
import { SettingsSearch } from '@/components/settings/SettingsSearch';
import { SettingsRow, SettingsSection } from '@/components/settings/SettingsRow';
import { AdaptiveSplitSchedulingSetting } from '@/components/settings/AdaptiveSplitSchedulingSetting';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { shouldBlockSettingsExit, targetModeLabel } from '@/lib/settingsUx';
import { getNutritionProfile } from '@/lib/nutritionProfile';
import { isPreviewActive, isAppSandboxActive } from '@/preview/flag';
import '@/components/settings/settings.css';
import { tapHaptic } from '@/lib/haptics';
import { summarizeFoodTrialStatus } from '@/lib/foodTrialUsage';
import { getFoodAnalysisMode, saveFoodAnalysisMode, getFoodTrialStatus } from '@/lib/foodTrial';
import {
  checkPhotoWorker,
  getPhotoWorkerSettings,
  savePhotoWorkerSettings,
  type PhotoWorkerSettings,
} from '@/lib/photoAnalysis';
import {
  enableNativeBodyWeightSync,
  getBodyWeightHistorySince,
  isHealthWeightSyncEnabled,
  recordManualBodyWeight,
  setHealthWeightSyncEnabled,
  syncNativeBodyWeights,
  type BodyWeightMeasurement,
} from '@/lib/healthWeights';
import {
  formatWeight,
  getPreferredWeightUnit,
  kgToUnit,
  setPreferredWeightUnit,
  type WeightUnit,
} from '@/lib/weightDisplayCore';
import { buildWeightTrend } from '@/lib/weightTrend';
import { lbsToKg } from '@/lib/nutritionCalculator';
import { NATIVE_AUTH_CALLBACK_SCHEME, NativeAuth, isNativeIOS } from '@/lib/nativeBridge';

/** Enough history for a stable trend without pulling a year of rows. */
const WEIGHT_TREND_WINDOW_DAYS = 60;

interface SavedMeal {
  id: string;
  user_id: string | null;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: string;
  description?: string | null;
  serving_size?: number;
  serving_unit?: string;
}

export function Settings() {
  const adaptiveSchedulingEnabled = useAdaptiveSplitScheduling();
  const navigate = useNavigate();
  const location = useLocation();
  const page = location.pathname.replace(/^\/settings\/?/, '') || 'home';
  const preview = isPreviewActive() && !isAppSandboxActive();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [weighInOpen, setWeighInOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const allowNavigation = useRef(false);
  const [coachRecommendation, setCoachRecommendation] = useState<CoachRecommendation | null>(null);
  const [calculatorVisited, setCalculatorVisited] = useState(false);
  const [calculatorDirty, setCalculatorDirty] = useState(false);
  const [calculatorKey, setCalculatorKey] = useState(0);
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachVisited, setCoachVisited] = useState(false);
  const [coachDirty, setCoachDirty] = useState(false);
  const [coachKey, setCoachKey] = useState(0);
  const [calculatorSaving, setCalculatorSaving] = useState(false);
  const [calculatorSavedProfile, setCalculatorSavedProfile] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<typeof macroDraft>(null);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [targetLoadState, setTargetLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [weightLoading, setWeightLoading] = useState(true);
  const [workerSaved, setWorkerSaved] = useState<PhotoWorkerSettings>(() =>
    preview ? { url: 'https://your-mac.example', provider: 'openai' } : getPhotoWorkerSettings(),
  );
  const lastPath = useRef(location.pathname);
  const returnFocus = useRef(new Map<string, string>());
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const go = (path: string, skipGuard = false) => {
    allowNavigation.current = skipGuard;
    if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.youFocus)
      returnFocus.current.set(location.pathname, document.activeElement.dataset.youFocus);
    navigate(path);
  };
  useLayoutEffect(() => {
    if (lastPath.current !== location.pathname) {
      const key = returnFocus.current.get(location.pathname);
      const focus = key
        ? document.querySelector<HTMLElement>(`[data-you-focus="${CSS.escape(key)}"]`)
        : null;
      if (focus) focus.focus({ preventScroll: true });
      else pageHeading.current?.focus({ preventScroll: true });
      lastPath.current = location.pathname;
    }
  }, [location.pathname]);
  useEffect(() => {
    if (!location.hash.startsWith('#search-') || searchOpen) return;
    let target: HTMLElement | null = null;
    // Wait until the search sheet has released background isolation and focus.
    const timer = window.setTimeout(() => {
      target = document.getElementById(location.hash.slice(1)) ?? pageHeading.current;
      if (!target) return;
      if (!target.hasAttribute('tabindex') && !target.matches('button, input')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      target.classList.add('you-search-highlight');
    }, 300);
    const clear = window.setTimeout(() => target?.classList.remove('you-search-highlight'), 2400);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
      target?.classList.remove('you-search-highlight');
    };
  }, [location.key, location.hash, searchOpen]);
  useEffect(() => {
    if (page === 'targets/coach') setCoachVisited(true);
    if (page === 'targets/calculate') setCalculatorVisited(true);
  }, [page]);
  const { user, profile, signOut, updateDisplayName } = useAuthStore();
  const {
    macroTarget,
    updateMacroTarget,
    nutritionProfile,
    updateNutritionProfile,
    refreshAdaptiveTargets,
    whoopConnection,
    fetchWhoopConnection,
    connectWhoop,
    disconnectWhoop,
    syncWhoop,
  } = useAppStore();
  const theme = useThemeStore((state) => state.theme);
  const themePreference = useThemeStore((state) => state.preference);
  const appearanceLabel = `${themePreference === 'system' ? 'Follow system · ' : ''}${theme === 'light' ? 'Ivory' : 'Black'}`;
  const [searchParams] = useSearchParams();

  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [macroDraft, setMacroDraft] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    source: MacroTargetSource;
  } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [savingMacros, setSavingMacros] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [macroMessage, setMacroMessage] = useState<string | null>(null);
  const [macroError, setMacroError] = useState<string | null>(null);
  const [savedMeals, setSavedMeals] = useState<SavedMeal[]>([]);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
  const [editingComposedMeal, setEditingComposedMeal] = useState<Food | null>(null);
  const [editingMealDraft, setEditingMealDraft] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [savingMealEdit, setSavingMealEdit] = useState(false);
  const [mealManagerMessage, setMealManagerMessage] = useState<string | null>(null);
  const [mealManagerError, setMealManagerError] = useState<string | null>(null);
  const [whoopAction, setWhoopAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [whoopMessage, setWhoopMessage] = useState<string | null>(null);
  const [whoopError, setWhoopError] = useState<string | null>(null);
  const [foodAnalysisMode, setFoodAnalysisMode] = useState(getFoodAnalysisMode);
  const [foodTrialBusy, setFoodTrialBusy] = useState(false);
  const [foodTrialMessage, setFoodTrialMessage] = useState<string | null>(null);
  const [photoWorkerDraft, setPhotoWorkerDraft] = useState<PhotoWorkerSettings>(() => ({
    ...workerSaved,
  }));
  const [photoWorkerBusy, setPhotoWorkerBusy] = useState(false);
  const [photoWorkerMessage, setPhotoWorkerMessage] = useState<string | null>(null);
  const [healthWeightBusy, setHealthWeightBusy] = useState(false);
  const [healthWeightEnabled, setHealthWeightEnabled] = useState(
    () => isNativeIOS() && isHealthWeightSyncEnabled(),
  );
  const [latestBodyWeight, setLatestBodyWeight] = useState<BodyWeightMeasurement | null>(null);
  const [healthWeightMessage, setHealthWeightMessage] = useState<string | null>(null);
  const [bodyWeightHistory, setBodyWeightHistory] = useState<BodyWeightMeasurement[]>([]);
  const [bodyWeightError, setBodyWeightError] = useState<string | null>(null);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getPreferredWeightUnit());
  const [weighInDraft, setWeighInDraft] = useState('');
  const [weighInBusy, setWeighInBusy] = useState(false);
  const [resumingAdaptive, setResumingAdaptive] = useState(false);

  // A smoothed rate of change, not a diff against yesterday's water weight.
  const weightTrend = useMemo(() => buildWeightTrend(bodyWeightHistory), [bodyWeightHistory]);

  const handleToggleWeightUnit = () => {
    const next: WeightUnit = weightUnit === 'lb' ? 'kg' : 'lb';
    const entered = Number(weighInDraft);
    if (weighInDraft.trim() && Number.isFinite(entered)) {
      const kilograms = weightUnit === 'lb' ? lbsToKg(entered) : entered;
      setWeighInDraft(String(Math.round(kgToUnit(kilograms, next) * 10) / 10));
    }
    setWeightUnit(next);
    setPreferredWeightUnit(next);
  };

  const refreshBodyWeightHistory = useCallback(async (userId: string) => {
    setWeightLoading(true);
    try {
      const history = await getBodyWeightHistorySince(userId, WEIGHT_TREND_WINDOW_DAYS);
      setBodyWeightHistory(history);
      setLatestBodyWeight(history[0] ?? null);
      setBodyWeightError(null);
    } catch {
      setBodyWeightError('Could not load weight history. Your previous measurements are kept.');
    } finally {
      setWeightLoading(false);
    }
  }, []);

  const handleRecordWeighIn = async () => {
    if (!user?.id || weighInBusy) return;

    const entered = parseFloat(weighInDraft);
    if (!Number.isFinite(entered) || entered <= 0) {
      setHealthWeightMessage('Enter a weight first.');
      return;
    }

    setWeighInBusy(true);
    setHealthWeightMessage(null);
    try {
      await recordManualBodyWeight(user.id, weightUnit === 'lb' ? lbsToKg(entered) : entered);
      await refreshBodyWeightHistory(user.id);
      setWeighInDraft('');
      setHealthWeightMessage('Weigh-in recorded.');
      setWeighInOpen(false);
    } catch (error) {
      setHealthWeightMessage(
        error instanceof Error ? error.message : 'Could not save that weigh-in.',
      );
    } finally {
      setWeighInBusy(false);
    }
  };

  const loadTargets = useCallback(async () => {
    if (!user?.id) return;
    setTargetLoadState('loading');
    try {
      const [target, loadedProfile] = await Promise.all([
        supabase.from('macro_targets').select('*').eq('user_id', user.id).maybeSingle(),
        getNutritionProfile(user.id),
      ]);
      if (target.error) throw target.error;
      useAppStore.setState({ macroTarget: target.data ?? null, nutritionProfile: loadedProfile });
      setTargetLoadState('ready');
    } catch {
      setTargetLoadState('error');
    }
  }, [user?.id]);
  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void fetchWhoopConnection();
  }, [fetchWhoopConnection]);

  useEffect(() => {
    if (!user?.id) return;
    void refreshBodyWeightHistory(user.id);
  }, [refreshBodyWeightHistory, user?.id]);

  const handleHealthWeightSync = async () => {
    if (!user?.id || healthWeightBusy) return;
    setHealthWeightBusy(true);
    setHealthWeightMessage(null);
    try {
      const result = healthWeightEnabled
        ? await syncNativeBodyWeights(user.id)
        : await enableNativeBodyWeightSync(user.id);
      setHealthWeightEnabled(true);
      setLatestBodyWeight(result.latest);
      await refreshBodyWeightHistory(user.id);
      setHealthWeightMessage(
        result.imported > 0
          ? `Imported ${result.imported} Apple Health weight entr${result.imported === 1 ? 'y' : 'ies'}.`
          : 'Apple Health weight is up to date.',
      );
    } catch (error) {
      setHealthWeightMessage(error instanceof Error ? error.message : 'Apple Health sync failed.');
    } finally {
      setHealthWeightBusy(false);
    }
  };

  const handleDisableHealthWeightSync = () => {
    setHealthWeightSyncEnabled(false);
    setHealthWeightEnabled(false);
    setHealthWeightMessage('Automatic weight sync stopped. Existing measurements were kept.');
  };

  const handleFoodTrialStatus = async () => {
    if (foodTrialBusy) return;
    if (preview) {
      setFoodTrialMessage('Preview: 3 of 20 daily analyses used. No requests were sent.');
      return;
    }
    setFoodTrialBusy(true);
    setFoodTrialMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error('Sign in again to check analysis usage.');
      const status = await getFoodTrialStatus(data.session.access_token);
      setFoodTrialMessage(summarizeFoodTrialStatus(status));
    } catch (error) {
      setFoodTrialMessage(
        error instanceof Error ? error.message : 'Could not check analysis usage.',
      );
    } finally {
      setFoodTrialBusy(false);
    }
  };

  const handlePhotoWorkerSave = async () => {
    if (preview) {
      const saved = { ...photoWorkerDraft, url: photoWorkerDraft.url.trim().replace(/\/+$/, '') };
      setWorkerSaved(saved);
      setPhotoWorkerDraft(saved);
      setPhotoWorkerMessage('Preview connection saved. No connection was made to a Mac worker.');
      return;
    }
    savePhotoWorkerSettings(photoWorkerDraft);
    const savedSettings = getPhotoWorkerSettings();
    setWorkerSaved(savedSettings);
    setPhotoWorkerDraft(savedSettings);
    setPhotoWorkerBusy(true);
    setPhotoWorkerMessage(null);
    const status = await checkPhotoWorker(photoWorkerDraft);
    setPhotoWorkerMessage(
      status.ok
        ? `Worker connected. Signed in: ${status.authenticatedProviders.join(', ') || 'none'}. Models: OpenAI ${status.models.openai || 'default'} (${status.efforts.openai || 'default'} effort), Claude ${status.models.anthropic || 'default'} (${status.efforts.anthropic || 'default'} effort).`
        : `Saved, but the worker is offline: ${status.error || 'connection failed'}`,
    );
    setPhotoWorkerBusy(false);
  };

  // landing back from WHOOP's consent screen: /settings?whoop=…
  useEffect(() => {
    const whoopParam = searchParams.get('whoop');
    if (!whoopParam) return;

    if (whoopParam === 'connected') {
      setWhoopMessage('WHOOP connected.');
      void fetchWhoopConnection();
    } else if (whoopParam) {
      setWhoopError('WHOOP connection failed. Try again.');
    }

    const next = new URLSearchParams(searchParams);
    next.delete('whoop');
    navigate(`/settings/connections/whoop${next.size ? `?${next}` : ''}`, { replace: true });
  }, [fetchWhoopConnection, searchParams, navigate]);

  const clearWhoopFeedback = () => {
    setWhoopMessage(null);
    setWhoopError(null);
  };

  const handleWhoopConnect = async () => {
    clearWhoopFeedback();
    setWhoopAction('connect');
    try {
      const nativeReturnTo = isNativeIOS()
        ? `${NATIVE_AUTH_CALLBACK_SCHEME}://settings`
        : undefined;
      const authorizeUrl = await connectWhoop(nativeReturnTo);
      if (authorizeUrl) {
        if (isNativeIOS()) {
          const { callbackUrl } = await NativeAuth.openOAuth({
            url: authorizeUrl,
            callbackScheme: NATIVE_AUTH_CALLBACK_SCHEME,
            callbackHost: 'settings',
            callbackPath: '',
          });
          const status = new URL(callbackUrl).searchParams.get('whoop');
          if (status !== 'connected') throw new Error('WHOOP connection failed.');
          await fetchWhoopConnection();
          setWhoopMessage('WHOOP connected.');
          return;
        }
        // production: hand the browser to WHOOP's consent screen
        window.location.href = authorizeUrl;
        return;
      }
      setWhoopMessage('WHOOP connected.');
    } catch (error) {
      console.error('Error connecting WHOOP:', error);
      // Surface the real reason — a generic message is undebuggable on a phone.
      const reason = error instanceof Error ? error.message : String(error);
      setWhoopError(`Could not start the WHOOP connection. ${reason}`.trim());
    } finally {
      setWhoopAction(null);
    }
  };

  const handleWhoopDisconnect = async () => {
    clearWhoopFeedback();
    setWhoopAction('disconnect');
    try {
      await disconnectWhoop();
      setWhoopMessage('WHOOP disconnected.');
    } catch (error) {
      console.error('Error disconnecting WHOOP:', error);
      setWhoopError('Could not disconnect WHOOP.');
    } finally {
      setWhoopAction(null);
    }
  };

  const handleWhoopSyncNow = async () => {
    clearWhoopFeedback();
    setWhoopAction('sync');
    try {
      const result = await syncWhoop();
      if (!result) {
        setWhoopError('Sync unavailable.');
        return;
      }
      const changes = result.created + result.updated;
      setWhoopMessage(
        changes > 0 ? `Synced — ${result.created} new, ${result.updated} updated.` : 'Up to date.',
      );
    } catch (error) {
      console.error('Error syncing WHOOP:', error);
      setWhoopError('Sync failed. Try again later.');
    } finally {
      setWhoopAction(null);
    }
  };

  const whoopStatusLabel =
    whoopAction === 'sync'
      ? 'Syncing recent WHOOP data…'
      : whoopAction === 'connect'
        ? 'Opening WHOOP authorization…'
        : whoopAction === 'disconnect'
          ? 'Disconnecting WHOOP…'
          : whoopConnection
            ? `Connected${whoopConnection.last_synced_at ? ` • synced ${formatDistanceToNowStrict(new Date(whoopConnection.last_synced_at), { addSuffix: true })}` : ' • never synced'}`
            : 'Not connected';

  const clearMealManagerFeedback = () => {
    setMealManagerMessage(null);
    setMealManagerError(null);
  };

  const fetchSavedMeals = useCallback(async () => {
    setLoadingSavedMeals(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setSavedMeals([]);
        return;
      }

      const { data, error } = await supabase
        .from('foods')
        .select('id, user_id, name, calories, protein, carbs, fat, source, description, serving_size, serving_unit')
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom'])
        .order('created_at', { ascending: false })
        .limit(150);

      if (error) {
        setMealManagerError('Could not load saved meals.');
        setSavedMeals([]);
        return;
      }

      const dedupedMeals = new Map<string, SavedMeal>();

      for (const meal of data || []) {
        const key = normalizeFoodName(meal.name || '');
        if (!key || dedupedMeals.has(key)) continue;

        dedupedMeals.set(key, {
          id: meal.id,
          user_id: meal.user_id,
          name: meal.name,
          calories: Number(meal.calories) || 0,
          protein: Number(meal.protein) || 0,
          carbs: Number(meal.carbs) || 0,
          fat: Number(meal.fat) || 0,
          source: meal.source,
          description: meal.description,
          serving_size: meal.serving_size,
          serving_unit: meal.serving_unit,
        });
      }

      setSavedMeals(Array.from(dedupedMeals.values()));
    } finally {
      setLoadingSavedMeals(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedMeals();
  }, [fetchSavedMeals]);

  const savedMealsCountLabel = useMemo(() => {
    if (loadingSavedMeals) return 'Loading meals…';
    if (mealManagerError) return 'Could not load meals';
    if (savedMeals.length === 0) return 'No meals saved yet';
    return `${savedMeals.length} meal${savedMeals.length === 1 ? '' : 's'} saved`;
  }, [loadingSavedMeals, savedMeals.length, mealManagerError]);

  const openManageMeals = async () => {
    go('/settings/meals');
    setEditingMealId(null);
    clearMealManagerFeedback();
    await fetchSavedMeals();
  };

  const beginEditingMeal = (meal: SavedMeal, replacing = false) => {
    if (editingMealId && editingMealId !== meal.id && !replacing) {
      setDiscardAction(() => () => beginEditingMeal(meal, true));
      return;
    }
    if (decodeMealComposition(meal.description)) {
      setEditingMealId(null);
      clearMealManagerFeedback();
      setEditingComposedMeal({
        ...meal,
        source: meal.source === 'custom' ? 'custom' : 'saved_meal',
        serving_size: meal.serving_size || 1,
        serving_unit: meal.serving_unit || 'serving',
        fdc_id: null,
      });
      return;
    }
    setEditingMealId(meal.id);
    clearMealManagerFeedback();
    setEditingMealDraft({
      name: meal.name,
      calories: String(Math.round(meal.calories * 10) / 10),
      protein: String(Math.round(meal.protein * 10) / 10),
      carbs: String(Math.round(meal.carbs * 10) / 10),
      fat: String(Math.round(meal.fat * 10) / 10),
    });
  };

  const insertSavedMealRecord = async (
    userId: string,
    values: { name: string; calories: number; protein: number; carbs: number; fat: number },
  ) => {
    const payload = {
      user_id: userId,
      name: values.name,
      calories: values.calories,
      protein: values.protein,
      carbs: values.carbs,
      fat: values.fat,
      source: 'saved_meal' as const,
    };

    let { data, error } = await supabase
      .from('foods')
      .insert({
        ...payload,
        serving_size: 1,
        serving_unit: 'serving',
      })
      .select('id')
      .single();

    if (error && shouldDropColumn(error, 'serving_size')) {
      ({ data, error } = await supabase.from('foods').insert(payload).select('id').single());
    }

    if (error || !data) {
      return null;
    }

    return data.id;
  };

  const saveMealEdit = async () => {
    if (!editingMealId || savingMealEdit) return;

    clearMealManagerFeedback();

    const nextName = editingMealDraft.name.trim();
    if (!nextName) {
      setMealManagerError('Meal name is required.');
      return;
    }

    const nextValues = {
      name: nextName,
      calories: parseFloat(editingMealDraft.calories) || 0,
      protein: parseFloat(editingMealDraft.protein) || 0,
      carbs: parseFloat(editingMealDraft.carbs) || 0,
      fat: parseFloat(editingMealDraft.fat) || 0,
    };

    setSavingMealEdit(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setMealManagerError('Please sign in again to save meal edits.');
        return;
      }

      const replacementId = await insertSavedMealRecord(user.id, nextValues);
      if (!replacementId) {
        setMealManagerError('Could not save meal changes.');
        return;
      }

      const { error: retireError } = await supabase
        .from('foods')
        .update({ source: 'manual_entry' })
        .eq('id', editingMealId)
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom']);

      if (retireError) {
        setMealManagerError(
          'Your edited meal was saved, but the original is still in saved meals. Remove the original when your connection is restored. Past logs are unchanged.',
        );
      } else {
        setMealManagerMessage('Saved meal updated for future logs.');
      }
      setEditingMealId(null);
      await fetchSavedMeals();
    } finally {
      setSavingMealEdit(false);
    }
  };

  const removeSavedMeal = async (meal: SavedMeal) => {
    if (!confirm(`Delete ${meal.name} from saved meals? Past logged entries will stay unchanged.`))
      return;

    clearMealManagerFeedback();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setMealManagerError('Please sign in again to manage meals.');
      return;
    }

    const { error } = await supabase
      .from('foods')
      .update({ source: 'manual_entry' })
      .eq('id', meal.id)
      .eq('user_id', user.id)
      .in('source', ['saved_meal', 'custom']);

    if (error) {
      setMealManagerError('Could not delete saved meal.');
      return;
    }

    if (editingMealId === meal.id) {
      setEditingMealId(null);
    }

    setMealManagerMessage('Saved meal deleted. Past logs were not changed.');
    await fetchSavedMeals();
  };

  const baseMacros = {
    calories: macroTarget?.calories ?? DEFAULT_MACRO_TARGET.calories,
    protein: macroTarget?.protein ?? DEFAULT_MACRO_TARGET.protein,
    carbs: macroTarget?.carbs ?? DEFAULT_MACRO_TARGET.carbs,
    fat: macroTarget?.fat ?? DEFAULT_MACRO_TARGET.fat,
    source: macroTarget?.source ?? ('manual' as MacroTargetSource),
  };

  const displayName = displayNameDraft ?? (profile?.display_name || '');
  const macros = macroDraft ?? baseMacros;

  const normalizedDisplayName = displayName.trim();
  const currentDisplayName = profile?.display_name || '';
  const displayNameChanged = normalizedDisplayName !== currentDisplayName;

  // Plain English for what the app currently believes about the user's burn.
  const expenditureDisplay = (() => {
    const learned = nutritionProfile?.expenditure_kcal ?? null;
    const confidence = nutritionProfile?.expenditure_confidence ?? 'predicted';

    if (learned == null || confidence === 'predicted') {
      return {
        value: '—',
        explanation:
          'Estimated from your profile. Food logs and regular weigh-ins help refine this estimate, often over about three weeks.',
      };
    }

    return {
      value: Math.round(learned).toLocaleString(),
      explanation:
        confidence === 'measured'
          ? 'Inferred from your food logs and weight trend. Updates weekly when enough data is available.'
          : 'Being learned from your logs and weight trend — it will keep sharpening as more days come in.',
    };
  })();

  const macrosChanged =
    macros.calories !== baseMacros.calories ||
    macros.protein !== baseMacros.protein ||
    macros.carbs !== baseMacros.carbs ||
    macros.fat !== baseMacros.fat ||
    macros.source !== baseMacros.source;

  const clearNameFeedback = () => {
    setNameMessage(null);
    setNameError(null);
  };

  const clearMacroFeedback = () => {
    setMacroMessage(null);
    setMacroError(null);
  };

  // The coach's numbers land in the manual draft, pre-filled but not saved -
  // the user adjusts and saves exactly as if they had typed them, and the
  // manual source keeps the adaptive loop off them afterwards.
  const stageTargets = (next: NonNullable<typeof macroDraft>) => {
    if (macrosChanged) {
      setPendingTargets(next);
      setReplacementOpen(true);
      return;
    }
    setMacroDraft(next);
    go('/settings/targets/edit', true);
  };
  const handleCoachRecommendation = (recommendation: CoachRecommendation) => {
    clearMacroFeedback();
    setCoachRecommendation(recommendation);
    stageTargets({
      calories: recommendation.calories,
      protein: recommendation.protein,
      carbs: recommendation.carbs,
      fat: recommendation.fat,
      source: 'manual',
    });
  };

  // A hand edit makes the target manual, which keeps the adaptive loop off it.
  const editMacro = (field: 'calories' | 'protein' | 'carbs' | 'fat', raw: string) => {
    clearMacroFeedback();
    setMacroDraft({ ...macros, [field]: parseInt(raw, 10) || 0, source: 'manual' });
  };

  const handleResumeAdaptiveTargets = async () => {
    if (resumingAdaptive) return;
    clearMacroFeedback();
    setResumingAdaptive(true);
    try {
      // Hand the target back to the loop, then let it recompute immediately
      // rather than waiting for the next weekly window.
      await updateMacroTarget({ ...baseMacros, source: 'calculated' });
      setMacroDraft(null);
      await refreshAdaptiveTargets({ force: true });
      setMacroMessage(
        nutritionProfile?.adaptive_enabled
          ? 'Automatic target management resumed. Recalculation was requested; values may stay the same until enough data is available.'
          : 'Target source saved. Complete nutrition setup to enable automatic updates.',
      );
    } catch {
      setMacroError('Could not resume adaptive targets. Please try again.');
    } finally {
      setResumingAdaptive(false);
    }
  };

  const handleSaveDisplayName = async () => {
    clearNameFeedback();
    setSavingName(true);

    const { error } = await updateDisplayName(displayName);

    if (error) {
      setNameError('Could not save display name. Please try again.');
    } else {
      setDisplayNameDraft(null);
      setNameMessage('Display name saved.');
    }

    setSavingName(false);
  };

  /**
   * The wizard's inputs used to be discarded when the modal closed. Now the
   * profile and the weigh-in persist immediately — so reopening resumes where
   * the user left off — while the targets themselves still wait for Save.
   */
  const handleApplyCalculatedTargets = async (outcome: NutritionWizardOutcome) => {
    if (calculatorSaving) return;
    clearMacroFeedback();
    setCalculatorSaving(true);
    try {
      await updateNutritionProfile(outcome.profile);
      setCalculatorSavedProfile(true);
      setCalculatorDirty(false);
      const latestKg = latestBodyWeight ? Number(latestBodyWeight.kilograms) : null;
      if (user?.id && (latestKg == null || Math.abs(latestKg - outcome.weightKg) > 0.05)) {
        try {
          await recordManualBodyWeight(user.id, outcome.weightKg);
          await refreshBodyWeightHistory(user.id);
        } catch {
          setMacroError(
            'Profile saved, but weight could not be recorded. You can retry from Body weight.',
          );
        }
      }
      setMacroMessage('Profile saved. Review and save the suggested targets.');
      stageTargets({ ...outcome.targets, source: 'calculated' });
    } catch {
      setMacroError('Could not save your profile. Your entries are kept; try again.');
    } finally {
      setCalculatorSaving(false);
    }
  };

  const handleSaveMacros = async () => {
    clearMacroFeedback();
    setSavingMacros(true);

    try {
      await updateMacroTarget(macros);
      setMacroDraft(null);
      setCalculatorSavedProfile(false);
      setMacroMessage('Daily targets saved.');
      go('/settings/targets', true);
    } catch {
      setMacroError('Could not save daily targets. Please try again.');
    }

    setSavingMacros(false);
  };

  const handleSignOut = async () => {
    if (
      confirm(
        Object.values(dirty).some(Boolean)
          ? `Sign out and discard unsaved edits?${calculatorSavedProfile ? ' Already saved profile details and weight will be kept.' : ''}`
          : 'Sign out?',
      )
    ) {
      await signOut();
    }
  };

  const workerDirty =
    photoWorkerDraft.url !== workerSaved.url || photoWorkerDraft.provider !== workerSaved.provider;
  const dirty = {
    name: displayNameChanged,
    targets: macrosChanged || calculatorDirty,
    worker: workerDirty,
    meal: editingMealId !== null,
    coach: coachDirty,
    weight: weighInDraft.trim() !== '',
  };
  const busy =
    coachBusy ||
    savingName ||
    savingMacros ||
    savingMealEdit ||
    weighInBusy ||
    calculatorSaving ||
    resumingAdaptive ||
    photoWorkerBusy;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (allowNavigation.current) {
      allowNavigation.current = false;
      return false;
    }
    return (
      (busy && currentLocation.pathname !== nextLocation.pathname) ||
      shouldBlockSettingsExit(currentLocation.pathname, nextLocation.pathname, dirty)
    );
  });
  useEffect(() => {
    const handleUnload = (event: BeforeUnloadEvent) => {
      if (busy || Object.values(dirty).some(Boolean)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  });
  const discardDrafts = () => {
    const leavingSettings =
      blocker.state === 'blocked' && !blocker.location.pathname.startsWith('/settings');
    if (leavingSettings || page === 'account') setDisplayNameDraft(null);
    if (leavingSettings || page.startsWith('targets')) {
      setMacroDraft(null);
      setPendingTargets(null);
      setCoachRecommendation(null);
      setCoachKey((key) => key + 1);
      setCoachDirty(false);
      setCalculatorKey((key) => key + 1);
      setCalculatorDirty(false);
    }
    if (leavingSettings || page === 'analysis/worker') setPhotoWorkerDraft(workerSaved);
    if (leavingSettings || page === 'meals') {
      setEditingMealId(null);
      setEditingComposedMeal(null);
    }
    setWeighInDraft('');
  };
  const titles: Record<string, string> = {
    home: 'You',
    weight: 'Body weight',
    targets: 'Nutrition targets',
    'targets/edit': 'Edit targets',
    'targets/calculate': 'Calculate targets',
    'targets/coach': 'Target suggestions',
    'targets/adaptation': 'How targets adapt',
    meals: 'Saved meals',
    analysis: 'Food analysis',
    'analysis/worker': 'Mac worker setup',
    connections: 'Connections',
    'connections/whoop': 'WHOOP',
    'connections/health': 'Apple Health',
    training: 'Training',
    appearance: 'Appearance',
    account: 'Account',
    about: 'About',
  };
  const modeLabel = targetModeLabel(
    macroTarget ? baseMacros.source : undefined,
    nutritionProfile?.adaptive_enabled,
  );
  const backPath =
    page === 'analysis/worker' && searchParams.get('from') === 'coach'
      ? '/settings/targets/coach'
      : page.includes('/')
        ? `/settings/${page.split('/')[0]}`
        : '/settings';
  const weightSummary = weightLoading
    ? 'Loading weight…'
    : bodyWeightError
      ? 'History unavailable'
      : latestBodyWeight
        ? `${formatWeight(latestBodyWeight.kilograms, weightUnit)} ${weightUnit}`
        : 'No weigh-ins yet';
  const targetSummary =
    targetLoadState === 'loading'
      ? 'Loading targets…'
      : targetLoadState === 'error'
        ? 'Could not load targets'
        : macroTarget
          ? `${baseMacros.calories.toLocaleString()} kcal · ${modeLabel}`
          : 'Starting defaults · not saved';
  const feedback = (
    <div aria-live="polite">
      {healthWeightMessage && <p className="t-body mt-3">{healthWeightMessage}</p>}
      {bodyWeightError && (
        <div role="alert" className="mt-3">
          <p className="t-body">{bodyWeightError}</p>
          <Button
            variant="secondary"
            onClick={() => user && void refreshBodyWeightHistory(user.id)}
          >
            Retry history
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Screen className="you-settings">
      <SettingsSearch open={searchOpen} query={searchQuery} onQuery={setSearchQuery}
        onClose={() => setSearchOpen(false)} onSelect={(href) => {
          setSearchOpen(false);
          go(href);
        }} />
      <header className="mb-5">
        {page !== 'home' && (
          <button type="button" onClick={() => go(backPath)} className="you-back">
            <ArrowLeft size={18} />
            {backPath === '/settings' ? 'You' : titles[backPath.replace('/settings/', '')]}
          </button>
        )}
        <div className="flex items-center justify-between gap-3">
          <h1 ref={pageHeading} tabIndex={-1} className="t-title outline-none">
            {titles[page] || 'You'}
          </h1>
          <button type="button" className="you-text-action flex items-center justify-center gap-2 px-2 shrink-0"
            aria-label="Search settings and features" onClick={() => setSearchOpen(true)}>
            <Search size={20} aria-hidden="true" /><span>Search</span>
          </button>
        </div>
        {page === 'home' && (
          <div className="flex items-center justify-between gap-3 mt-2">
            <p className="t-body break-words min-w-0">
              {profile?.display_name || 'Your personal space'}
            </p>
            <button
              data-you-focus="profile"
              className="you-text-action shrink-0"
              onClick={() => go('/settings/account')}
            >
              Edit profile
            </button>
          </div>
        )}
      </header>

      {page === 'home' && (
        <>
          <section className="you-weight-hero" aria-label="Body weight">
            <div className="flex justify-between items-start gap-3">
              <div>
                <p className="t-label-sm">Body weight</p>
                <p className="you-weight-value mt-2">{weightSummary}</p>
                {latestBodyWeight && (
                  <p className="t-caption mt-1">
                    {format(new Date(latestBodyWeight.measured_at), 'MMM d')} ·{' '}
                    {latestBodyWeight.source_name}
                  </p>
                )}
              </div>
              <button
                data-you-focus="weight"
                onClick={() => go('/settings/weight')}
                className="you-text-action"
              >
                Details
              </button>
            </div>
            <Button className="mt-4 w-full" onClick={() => setWeighInOpen(true)}>
              Log weight
            </Button>
            {healthWeightMessage && (
              <p role="status" className="t-body mt-3">
                {healthWeightMessage}
              </p>
            )}
          </section>
          <SettingsSection label="Nutrition">
            <SettingsRow
              title="Nutrition targets"
              description={targetSummary}
              onClick={() => go('/settings/targets')}
            />
            <SettingsRow
              title="Saved meals"
              description={savedMealsCountLabel}
              onClick={() => void openManageMeals()}
            />
            <SettingsRow
              title="Food analysis"
              description={foodAnalysisMode === 'gemini' ? 'Hosted analysis' : 'Your Mac'}
              onClick={() => go('/settings/analysis')}
            />
          </SettingsSection>
          <SettingsSection label="App & connections">
            <SettingsRow
              title="Connections"
              description={`WHOOP ${whoopConnection ? 'connected' : 'not connected'}${isNativeIOS() ? ` · Health ${healthWeightEnabled ? 'on' : 'off'}` : ''}`}
              onClick={() => go('/settings/connections')}
            />
            <SettingsRow
              title="Appearance"
              description={appearanceLabel}
              onClick={() => go('/settings/appearance')}
            />
          </SettingsSection>
          <SettingsSection label="Activity">
            <SettingsRow
              title="Training"
              description={`Adaptive split scheduling ${adaptiveSchedulingEnabled ? 'on' : 'off'}`}
              onClick={() => go('/settings/training')}
            />
            <SettingsRow
              title="Start a run"
              description="GPS run tracking"
              onClick={() => go('/train/run')}
            />
          </SettingsSection>
          <div className="mt-4">
            <SettingsRow
              title="Account"
              description="Profile and sign-out"
              onClick={() => go('/settings/account')}
            />
            <SettingsRow
              title="About"
              description="Build information"
              onClick={() => go('/settings/about')}
            />
          </div>
        </>
      )}
      {page === 'account' && (
        <>
          <Input
            id="search-display-name"
            label="Display name"
            value={displayName}
            onChange={(e) => {
              clearNameFeedback();
              setDisplayNameDraft(e.target.value);
            }}
            placeholder="Your name"
          />
          {displayNameChanged && (
            <Button className="w-full mt-5" onClick={handleSaveDisplayName} loading={savingName}>
              Save name
            </Button>
          )}
          {nameMessage && (
            <p role="status" className="mt-4 t-body">
              {nameMessage}
            </p>
          )}
          {nameError && (
            <p role="alert" className="mt-4 t-body">
              {nameError}
            </p>
          )}

          <div id="search-sign-out" tabIndex={-1}>
            <SettingsSection label="Sign out">
              <p className="t-body mb-3">Sign out of your account on this device.</p>
              <Button variant="danger" disabled={busy} onClick={handleSignOut}>
                <LogOut size={16} />
                Sign out
              </Button>
            </SettingsSection>
          </div>
        </>
      )}
      {page === 'training' && <div id="search-adaptive-scheduling" tabIndex={-1}><AdaptiveSplitSchedulingSetting /></div>}
      {page === 'appearance' && (
        <>
          <p className="t-body mb-5">Follow your phone’s light or dark mode, or choose an appearance to always use.</p>{' '}
          <div id="search-appearance" className="flex flex-col items-start gap-4">
            <div>
              <p className="t-heading">Theme</p>
              <p className="t-caption mt-1">{appearanceLabel}</p>
            </div>
            <ThemeToggle />
          </div>
        </>
      )}
      {page === 'targets' && (
        <>
          <p className="t-body mb-4">
            {targetLoadState === 'loading'
              ? 'Loading targets…'
              : macroTarget
                ? `Saved targets · ${modeLabel}`
                : 'Starting defaults — not saved'}
          </p>
          {targetLoadState === 'error' && (
            <div role="alert">
              <p>Could not load targets. Any previously loaded values are kept.</p>
              <Button variant="secondary" onClick={() => void loadTargets()}>
                Retry targets
              </Button>
            </div>
          )}
          <dl className="you-target-grid">
            {[
              { label: 'Calories', value: baseMacros.calories, unit: 'kcal' },
              { label: 'Protein', value: baseMacros.protein, unit: 'g' },
              { label: 'Carbs', value: baseMacros.carbs, unit: 'g' },
              { label: 'Fat', value: baseMacros.fat, unit: 'g' },
            ].map((item) => (
              <div key={item.label}>
                <dt className="t-body">{item.label}</dt>
                <dd>
                  <span className="you-target-value">{item.value.toLocaleString()}</span>{' '}
                  <span className="t-caption">{item.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          <Button
            data-you-focus="edit-targets"
            className="w-full mt-5"
            disabled={targetLoadState !== 'ready'}
            onClick={() => go('/settings/targets/edit')}
          >
            {macrosChanged ? 'Continue editing targets' : 'Edit targets'}
          </Button>
          {macroMessage && (
            <p role="status" className="t-body mt-3">
              {macroMessage}
            </p>
          )}
          {macroError && (
            <p role="alert" className="t-body mt-3">
              {macroError}
            </p>
          )}
          <SettingsSection label="Guidance">
            <SettingsRow
              title="Calculate targets"
              description="A guided setup using your body, activity and goal"
              onClick={() => go('/settings/targets/calculate')}
            />
            <SettingsRow
              title="Get target suggestions"
              description="Describe your goal to the coach"
              onClick={() => go('/settings/targets/coach')}
            />
          </SettingsSection>
          {nutritionProfile && (
            <SettingsSection label="Automatic adjustments">
              <p className="t-body">
                Estimated daily burn{' '}
                <strong>
                  {expenditureDisplay.value}
                  {expenditureDisplay.value !== '—' ? ' kcal' : ''}
                </strong>
              </p>
              <p className="t-caption mt-1">
                {nutritionProfile.expenditure_confidence === 'measured'
                  ? 'Inferred from logs and weight trend'
                  : nutritionProfile.expenditure_confidence === 'learning'
                    ? 'Learning from your logs'
                    : 'Estimated from your profile'}
              </p>
              <SettingsRow
                title="How targets adapt"
                onClick={() => go('/settings/targets/adaptation')}
              />
              {baseMacros.source === 'manual' && (
                <>
                  <p className="t-body my-3">
                    Manual targets stay fixed. Resume automatic management to request a
                    recalculation when enough data is available.
                  </p>
                  <Button
                    variant="secondary"
                    loading={resumingAdaptive}
                    onClick={() =>
                      macrosChanged
                        ? setDiscardAction(() => () => {
                            setMacroDraft(null);
                            void handleResumeAdaptiveTargets();
                          })
                        : void handleResumeAdaptiveTargets()
                    }
                  >
                    Resume adaptive targets
                  </Button>
                </>
              )}
            </SettingsSection>
          )}
        </>
      )}
      {page === 'targets/adaptation' && (
        <>
          <p className="t-body">{expenditureDisplay.explanation}</p>
          <p className="t-body mt-4">
            These values are estimates, not direct measurements. Automatic targets use your saved
            nutrition profile, food logs and weight trend. Manual targets stay fixed until you
            resume automatic management.
          </p>
          <SettingsRow
            title="Body weight"
            description="Record a weigh-in or review your trend"
            onClick={() => go('/settings/weight')}
          />
        </>
      )}
      {page === 'targets/edit' && (
        <>
          {targetLoadState !== 'ready' && (
            <p role="status" className="t-body">
              {targetLoadState === 'loading'
                ? 'Loading targets…'
                : 'Targets could not be loaded. Return to Nutrition targets to retry.'}
            </p>
          )}
          <p className="t-body">
            {macrosChanged
              ? 'Unsaved targets'
              : macroTarget
                ? 'Edit your saved daily targets.'
                : 'Starting defaults — save to make these your targets.'}
          </p>
          <p className="t-body mt-2">
            {macros.source === 'manual'
              ? 'Saving sets manual targets. They stay fixed until you resume adaptive targets.'
              : 'Calculated targets can adapt when automatic adjustments are enabled.'}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <Input
              id="search-calories"
              label="Calories"
              type="number"
              inputMode="numeric"
              disabled={targetLoadState !== 'ready'}
              value={macros.calories}
              onChange={(e) => editMacro('calories', e.target.value)}
            />
            <Input
              id="search-protein"
              label="Protein (g)"
              type="number"
              inputMode="numeric"
              disabled={targetLoadState !== 'ready'}
              value={macros.protein}
              onChange={(e) => editMacro('protein', e.target.value)}
            />
            <Input
              id="search-carbs"
              label="Carbs (g)"
              type="number"
              inputMode="numeric"
              disabled={targetLoadState !== 'ready'}
              value={macros.carbs}
              onChange={(e) => editMacro('carbs', e.target.value)}
            />
            <Input
              id="search-fat"
              label="Fat (g)"
              type="number"
              inputMode="numeric"
              disabled={targetLoadState !== 'ready'}
              value={macros.fat}
              onChange={(e) => editMacro('fat', e.target.value)}
            />
          </div>

          {(() => {
            const kcalFromMacros = Math.round(
              macros.protein * 4 + macros.carbs * 4 + macros.fat * 9,
            );
            const driftPct =
              macros.calories > 0
                ? Math.round((Math.abs(macros.calories - kcalFromMacros) / macros.calories) * 100)
                : 0;
            return driftPct > 5 ? (
              <p className="t-caption mt-3 text-[var(--color-accent)]">
                These macros total {kcalFromMacros.toLocaleString()} kcal; your calorie target is{' '}
                {macros.calories.toLocaleString()} kcal. Review the values before saving.
              </p>
            ) : null;
          })()}

          {(macrosChanged || !macroTarget) && (
            <Button
              className="w-full mt-6"
              onClick={handleSaveMacros}
              loading={savingMacros}
              disabled={targetLoadState !== 'ready'}
            >
              Save targets
            </Button>
          )}
          {macroMessage && (
            <p role="status" className="mt-4 t-body">
              {macroMessage}
            </p>
          )}
          {macroError && (
            <p role="alert" className="mt-4 t-body">
              {macroError}
            </p>
          )}

          {coachRecommendation && macros.source === 'manual' && (
            <section className="mt-5">
              <h2 className="t-heading">Latest coach suggestion</h2>
              {pendingTargets?.source === 'manual' && (
                <p className="t-body mt-2">
                  These suggestions have not replaced your current draft.
                </p>
              )}
              <p className="t-body mt-2">{coachRecommendation.rationale}</p>
              {coachRecommendation.cautions && (
                <p className="t-body mt-2">{coachRecommendation.cautions}</p>
              )}
              <p className="t-caption mt-2">Not medical advice.</p>
            </section>
          )}
          {pendingTargets && (
            <Button className="mt-4" variant="secondary" onClick={() => setReplacementOpen(true)}>
              Review new suggestions
            </Button>
          )}
        </>
      )}
      {(calculatorVisited || page === 'targets/calculate') && (
        <div hidden={page !== 'targets/calculate'}>
          <NutritionWizard
            key={calculatorKey}
            onDraftChange={setCalculatorDirty}
            initialProfile={nutritionProfile}
            initialWeightKg={latestBodyWeight?.kilograms ?? null}
            onApply={handleApplyCalculatedTargets}
            onCancel={() => go('/settings/targets')}
            saving={calculatorSaving}
            saveError={macroError}
          />
        </div>
      )}
      {(coachVisited || page === 'targets/coach') && (
        <div hidden={page !== 'targets/coach'}>
          <GoalsCoach
            key={coachKey}
            profile={nutritionProfile}
            weightKg={latestBodyWeight?.kilograms ?? null}
            currentTargets={macroTarget}
            onRecommendation={handleCoachRecommendation}
            onSetupProfile={() => go('/settings/targets/calculate')}
            onSetupWorker={() => go('/settings/analysis/worker?from=coach')}
            workerConfigured={!!workerSaved.url.trim()}
            onDraftChange={setCoachDirty}
            onBusyChange={setCoachBusy}
          />
        </div>
      )}
      {page === 'meals' && (
        <>
          {' '}
          <div className="pt-1 pb-2">
            {mealManagerMessage && (
              <p role="status" className="mb-4 t-body">
                {mealManagerMessage}
              </p>
            )}
            {mealManagerError && (
              <div role="alert">
                <p className="mb-4 t-body">{mealManagerError}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    clearMealManagerFeedback();
                    void fetchSavedMeals();
                  }}
                >
                  Retry meals
                </Button>
              </div>
            )}

            {loadingSavedMeals ? (
              <div className="space-y-px">
                <div className="h-[64px] shimmer" />
                <div className="h-[64px] shimmer" />
                <div className="h-[64px] shimmer" />
              </div>
            ) : savedMeals.length === 0 ? (
              <p className="text-editorial py-8">
                Meals you save from the food logger will appear here.
              </p>
            ) : (
              <ul>
                {savedMeals.map((meal) => (
                  <li
                    key={meal.id}
                    className="py-4 border-t border-[var(--color-border)] first:border-t-0"
                  >
                    {editingMealId === meal.id ? (
                      <div className="space-y-5">
                        <Input
                          label="Meal name"
                          value={editingMealDraft.name}
                          onChange={(e) =>
                            setEditingMealDraft({ ...editingMealDraft, name: e.target.value })
                          }
                        />
                        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                          <Input
                            label="Calories"
                            type="number"
                            value={editingMealDraft.calories}
                            onChange={(e) =>
                              setEditingMealDraft({ ...editingMealDraft, calories: e.target.value })
                            }
                          />
                          <Input
                            label="Protein (g)"
                            type="number"
                            value={editingMealDraft.protein}
                            onChange={(e) =>
                              setEditingMealDraft({ ...editingMealDraft, protein: e.target.value })
                            }
                          />
                          <Input
                            label="Carbs (g)"
                            type="number"
                            value={editingMealDraft.carbs}
                            onChange={(e) =>
                              setEditingMealDraft({ ...editingMealDraft, carbs: e.target.value })
                            }
                          />
                          <Input
                            label="Fat (g)"
                            type="number"
                            value={editingMealDraft.fat}
                            onChange={(e) =>
                              setEditingMealDraft({ ...editingMealDraft, fat: e.target.value })
                            }
                          />
                        </div>

                        <div className="flex gap-3 pt-1">
                          <Button
                            className="flex-1"
                            onClick={saveMealEdit}
                            loading={savingMealEdit}
                            disabled={savingMealEdit}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            className="flex-1"
                            onClick={() => setDiscardAction(() => () => setEditingMealId(null))}
                            disabled={savingMealEdit}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-stretch justify-between overflow-hidden">
                        <div className="min-w-0">
                          <p className="t-heading break-words pr-2 normal-case tracking-normal text-[var(--color-text)]">
                            {meal.name}
                          </p>
                          <p className="t-data-sm mt-1.5 break-words pr-2 leading-5 text-[var(--color-muted)]">
                            {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C{' '}
                            {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-stretch">
                          <button
                            type="button"
                            disabled={savingMealEdit}
                            onClick={() => beginEditingMeal(meal)}
                            className="pressable flex min-h-11 w-11 items-center justify-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                            aria-label={`Edit saved meal ${meal.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            disabled={savingMealEdit}
                            onClick={() => removeSavedMeal(meal)}
                            className="pressable flex min-h-11 w-11 items-center justify-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
                            aria-label={`Delete saved meal ${meal.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {page === 'analysis' && (
        <>
          {' '}
          <div id="search-analysis-mode" className="space-y-4 mb-6">
            <label className="t-body block mb-2" id="analysis-method-label">
              Meal analysis method
            </label>
            <SelectSheet
              title="Meal analysis"
              ariaLabelledBy="analysis-method-label"
              value={foodAnalysisMode}
              onChange={(mode) => {
                saveFoodAnalysisMode(mode);
                setFoodAnalysisMode(mode);
                setFoodTrialMessage(null);
              }}
              options={[
                {
                  value: 'gemini',
                  label: 'Hosted analysis',
                  description:
                    'Gemini 3.8 Flash photo and text analysis with Tavily nutrition lookup. No Mac worker needed for meals.',
                },
                {
                  value: 'worker',
                  label: 'Your Mac',
                  description: 'Your existing Codex or Claude food analysis.',
                },
              ]}
            />
            {foodAnalysisMode === 'gemini' && (
              <>
                <p className="t-caption">
                  Gemini interprets your meal; Tavily looks up nutrition sources when needed. Adjust
                  the result before saving. Daily request limits help control API costs.
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={foodTrialBusy}
                  onClick={() => void handleFoodTrialStatus()}
                >
                  Check analysis usage
                </Button>
                {foodTrialMessage && (
                  <p className="t-caption" role="status">
                    {foodTrialMessage}
                  </p>
                )}
              </>
            )}
          </div>
          <SettingsRow
            title="Mac worker setup"
            description="Connection and photo provider · also used by the coach"
            onClick={() => go('/settings/analysis/worker')}
          />
        </>
      )}
      {page === 'analysis/worker' && (
        <>
          {' '}
          <p className="t-heading">Your Mac</p>
          <p className="t-caption mt-1 mb-5">
            This connection also runs target suggestions, even when meals use hosted analysis. Uses
            your local Codex or Claude login. On a phone, enter the worker’s Tailscale HTTPS URL.
          </p>
          <div className="space-y-4">
            <Input
              id="search-worker-url"
              label="Worker URL"
              value={photoWorkerDraft.url}
              onChange={(event) =>
                setPhotoWorkerDraft((current) => ({ ...current, url: event.target.value }))
              }
              placeholder="http://127.0.0.1:8788"
            />
            <div id="search-analysis-provider">
            <label id="photo-provider-label" className="t-body block">
              Photo-analysis provider
            </label>
            <SelectSheet
              ariaLabelledBy="photo-provider-label"
              title="Photo-analysis provider"
              value={photoWorkerDraft.provider}
              onChange={(provider) => setPhotoWorkerDraft((current) => ({ ...current, provider }))}
              options={[
                {
                  value: 'openai',
                  label: 'OpenAI Codex',
                  description: 'Uses your local ChatGPT/Codex subscription login.',
                },
                {
                  value: 'anthropic',
                  label: 'Anthropic Claude',
                  description:
                    'Local experimental connector; never use consumer credentials for other users.',
                },
              ]}
            />
            </div>
            <Button
              variant="secondary"
              className="w-full"
              loading={photoWorkerBusy}
              onClick={() => void handlePhotoWorkerSave()}
            >
              Save & test connection
            </Button>
            {photoWorkerMessage && (
              <p role="status" className="t-body">
                {photoWorkerMessage}
              </p>
            )}
          </div>
        </>
      )}
      {page === 'connections' && (
        <>
          <SettingsRow
            title="WHOOP"
            description={whoopStatusLabel}
            onClick={() => go('/settings/connections/whoop')}
          />
          {isNativeIOS() ? (
            <SettingsRow
              title="Apple Health"
              description={
                healthWeightEnabled ? 'Automatic weight sync on' : 'Connect weight measurements'
              }
              onClick={() => go('/settings/connections/health')}
            />
          ) : (
            <p className="t-body mt-5">
              Apple Health weight sync is available in the iPhone app. You can log weight manually
              here.
            </p>
          )}
        </>
      )}
      {page === 'connections/whoop' && (
        <>
          {' '}
          <div className="flex flex-col gap-4">
            <div>
              <p className="t-heading">WHOOP</p>
              <p className="t-caption mt-1" aria-live="polite">
                {whoopStatusLabel}
              </p>
            </div>
            {whoopConnection ? (
              <div className="grid grid-cols-2 gap-2 w-full">
                <Button
                  className="w-full"
                  variant="secondary"
                  size="sm"
                  loading={whoopAction === 'sync'}
                  disabled={whoopAction !== null}
                  onClick={() => {
                    void handleWhoopSyncNow();
                  }}
                >
                  Sync now
                </Button>
                <Button
                  className="w-full"
                  variant="ghost"
                  size="sm"
                  loading={whoopAction === 'disconnect'}
                  disabled={whoopAction !== null}
                  onClick={() => {
                    void handleWhoopDisconnect();
                  }}
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button
                className="w-full"
                variant="secondary"
                size="sm"
                loading={whoopAction === 'connect'}
                disabled={whoopAction !== null}
                onClick={() => {
                  void handleWhoopConnect();
                }}
              >
                Connect
              </Button>
            )}
          </div>
          <div aria-live="polite">
            {whoopMessage && <p className="t-caption mt-3">{whoopMessage}</p>}
            {whoopError && (
              <p className="t-caption mt-3 text-[var(--color-accent)]">{whoopError}</p>
            )}
          </div>
        </>
      )}
      {page === 'connections/health' && (
        <>
          <p className="t-body mb-4">
            Import body-weight measurements from Apple Health. Stopping automatic sync keeps
            measurements already imported.
          </p>
          {isNativeIOS() ? (
            <>
              <Button loading={healthWeightBusy} onClick={() => void handleHealthWeightSync()}>
                {healthWeightEnabled ? 'Sync now' : 'Connect Apple Health'}
              </Button>{' '}
              {isNativeIOS() && healthWeightEnabled && (
                <button
                  type="button"
                  onClick={handleDisableHealthWeightSync}
                  className="mt-3 t-label-sm text-[var(--color-muted)] border-b border-[var(--color-border-strong)]"
                >
                  Stop automatic sync
                </button>
              )}
            </>
          ) : (
            <p className="t-body">Open the iPhone app to connect Apple Health.</p>
          )}
          {feedback}
        </>
      )}
      {page === 'weight' && (
        <>
          <div className="flex items-center justify-between gap-3 mb-4">
            <Button id="search-log-weight" onClick={() => setWeighInOpen(true)}>Log weight</Button>
            <button
              id="search-weight-units"
              className="you-text-action"
              aria-label={`Show weight in ${weightUnit === 'lb' ? 'kilograms' : 'pounds'}`}
              onClick={handleToggleWeightUnit}
            >
              {weightUnit === 'lb' ? 'lb / kg' : 'kg / lb'}
            </button>
          </div>
          {weightLoading ? (
            <p role="status">Loading weight history…</p>
          ) : (
            <>
              {' '}
              {latestBodyWeight ? (
                <div className="mt-4">
                  <div className="flex items-baseline gap-2">
                    <span className="number-medium text-[var(--color-text)]">
                      {formatWeight(latestBodyWeight.kilograms, weightUnit)}
                    </span>
                    <span className="t-caption text-[var(--color-text-dim)]">{weightUnit}</span>
                    {weightTrend.kgPerWeek !== null && (
                      <span className="t-data-sm text-[var(--color-text-dim)]">
                        {weightTrend.kgPerWeek > 0 ? '+' : '−'}
                        {Math.abs(kgToUnit(weightTrend.kgPerWeek, weightUnit)).toFixed(2)}{' '}
                        {weightUnit}/wk
                      </span>
                    )}
                  </div>
                  <p className="t-caption mt-1.5">
                    {format(new Date(latestBodyWeight.measured_at), 'MMM d · h:mm a')} ·{' '}
                    {latestBodyWeight.source_name}
                  </p>
                  {weightTrend.latestEwmaKg !== null && weightTrend.fittedDayCount >= 2 && (
                    <p className="t-caption mt-1">
                      Trend {formatWeight(weightTrend.latestEwmaKg, weightUnit)} {weightUnit} ·
                      smoothed over {weightTrend.observedDayCount} weigh-in
                      {weightTrend.observedDayCount === 1 ? '' : 's'}
                    </p>
                  )}
                  {bodyWeightHistory.length > 1 && (
                    <ul className="mt-4 border-t border-[var(--color-border)]">
                      {bodyWeightHistory.slice(1, 6).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-baseline justify-between gap-4 py-2 border-b border-[var(--color-border)]"
                        >
                          <span className="t-caption">
                            {format(new Date(entry.measured_at), 'MMM d')}
                          </span>
                          <span className="t-data-sm text-[var(--color-text)]">
                            {formatWeight(entry.kilograms, weightUnit)} {weightUnit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="t-caption mt-3">
                  {bodyWeightError
                    ? bodyWeightError
                    : 'Record your first weight. If adaptive targets are enabled, regular weigh-ins help refine them.'}
                </p>
              )}
            </>
          )}
          {feedback}
          {isNativeIOS() && (
            <SettingsRow
              title="Apple Health sync"
              description={
                healthWeightEnabled ? 'Automatic sync on' : 'Connect your weight measurements'
              }
              onClick={() => go('/settings/connections/health')}
            />
          )}
        </>
      )}
      {page === 'about' && (
        <>
          {' '}
          <footer className="mt-12 pt-8 border-t border-[var(--color-border)]">
            <div className="flex items-baseline justify-between">
              <h2 className="t-display-italic text-[21px] text-[var(--color-text-dim)]">
                hy<span className="italic text-[var(--color-accent)]">P</span>er
              </h2>
              {/* Tapping the build stamp fires a test haptic — handy for verifying device support */}
              <button
                type="button"
                aria-label={`Build ${__BUILD_ID__}. Tap to test haptics on a supported device.`}
                onClick={() => tapHaptic()}
                className="t-data-sm text-[var(--color-muted)] min-h-11 py-2"
              >
                build {__BUILD_ID__}
              </button>
            </div>
            <p className="t-label-sm mt-3">Built on peer-reviewed research</p>
          </footer>
          <p className="t-body mt-4">
            Tap the build information to test haptics on a supported device.
          </p>
        </>
      )}
      {!titles[page] && <SettingsRow title="Back to You" onClick={() => go('/settings')} />}
      <Modal
        isOpen={editingComposedMeal !== null}
        title="Edit saved meal"
        onClose={() => {
          if (savingMealEdit) return;
          setEditingComposedMeal(null);
        }}
      >
        {editingComposedMeal && (
          <MealLogger
            selectedDate={new Date()}
            initialSavedMeal={editingComposedMeal}
            onCancel={() => setEditingComposedMeal(null)}
            onBusyChange={setSavingMealEdit}
            onComplete={() => {
              setEditingComposedMeal(null);
              setMealManagerMessage('Saved meal updated for future logs.');
              void fetchSavedMeals();
            }}
          />
        )}
      </Modal>
      <Modal
        contentClassName="you-settings"
        isOpen={weighInOpen}
        onClose={() => {
          if (weighInBusy) return;
          if (weighInDraft.trim())
            setDiscardAction(() => () => {
              setWeighInDraft('');
              setWeighInOpen(false);
            });
          else setWeighInOpen(false);
        }}
        title="Log weight"
      >
        <button className="you-text-action" onClick={handleToggleWeightUnit}>
          Unit: {weightUnit} · switch to {weightUnit === 'lb' ? 'kg' : 'lb'}
        </button>
        <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
          <label className="t-label-sm block mb-2" htmlFor="weigh-in">
            Record a weigh-in
          </label>
          <div className="flex items-end gap-4">
            <div className="material-inset flex-1 min-w-0 flex items-baseline gap-2 px-3 rounded-[var(--radius-control)]">
              <input
                id="weigh-in"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={weighInDraft}
                placeholder={weightUnit === 'lb' ? '180.5' : '82.0'}
                onChange={(e) => {
                  setHealthWeightMessage(null);
                  setWeighInDraft(e.target.value);
                }}
                className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
              />
              <span className="t-label-sm shrink-0">{weightUnit}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={weighInBusy}
              disabled={weighInBusy || weighInDraft.trim() === ''}
              onClick={() => {
                void handleRecordWeighIn();
              }}
            >
              Save
            </Button>
          </div>
        </div>

        {healthWeightMessage && (
          <p role="status" className="t-body">
            {healthWeightMessage}
          </p>
        )}
      </Modal>
      <Modal
        contentClassName="you-settings"
        isOpen={blocker.state === 'blocked' || !!discardAction}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
          setDiscardAction(null);
        }}
        title={busy ? 'Saving changes' : 'Discard unsaved changes?'}
      >
        <p className="t-body mb-4">
          {busy
            ? 'Wait for the current save to finish before leaving.'
            : 'Your unsaved edits will be discarded.'}
        </p>
        {calculatorSavedProfile && (
          <p className="t-body mb-4">
            Profile details and any recorded weight are already saved. Discarding targets does not
            undo those changes, which may affect later automatic updates.
          </p>
        )}
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => {
              if (blocker.state === 'blocked') blocker.reset();
              setDiscardAction(null);
            }}
          >
            Keep editing
          </Button>
          {!busy && (
            <Button
              variant="secondary"
              onClick={() => {
                if (discardAction) discardAction();
                else discardDrafts();
                setDiscardAction(null);
                if (blocker.state === 'blocked') blocker.proceed();
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      </Modal>
      <Modal
        contentClassName="you-settings"
        isOpen={replacementOpen}
        onClose={() => setReplacementOpen(false)}
        title="Replace your target draft?"
      >
        <p className="t-body mb-4">
          You have unsaved target edits. Keep them or use the new suggestions.
        </p>
        {pendingTargets && (
          <p className="t-body mb-4">
            Suggested: {pendingTargets.calories} kcal · Protein {pendingTargets.protein} g · Carbs{' '}
            {pendingTargets.carbs} g · Fat {pendingTargets.fat} g
          </p>
        )}
        {calculatorSavedProfile && (
          <p className="t-body mb-4">
            Your profile and any recorded weight have already been saved.
          </p>
        )}
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => {
              setReplacementOpen(false);
              go('/settings/targets/edit');
            }}
          >
            Keep current draft
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setMacroDraft(pendingTargets);
              setPendingTargets(null);
              setReplacementOpen(false);
              go('/settings/targets/edit');
            }}
          >
            Replace with suggestions
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}
