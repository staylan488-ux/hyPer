import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, LogOut, Pencil, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Button, Input, Modal, Screen, SelectSheet, ThemeToggle } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { normalizeFoodName, shouldDropColumn } from '@/components/nutrition/foodLoggerUtils';
import { NutritionWizard, type NutritionWizardOutcome } from '@/components/nutrition/NutritionWizard';
import { GoalsCoach } from '@/components/nutrition/GoalsCoach';
import type { CoachRecommendation } from '@/lib/nutritionCoach';
import { DEFAULT_MACRO_TARGET, type MacroTargetSource } from '@/types';
import { tapHaptic } from '@/lib/haptics';
import { summarizeFoodTrialStatus } from '@/lib/foodTrialUsage';
import { getFoodAnalysisMode, saveFoodAnalysisMode, getFoodTrialStatus } from '@/lib/foodTrial';
import { checkPhotoWorker, getPhotoWorkerSettings, savePhotoWorkerSettings, type PhotoWorkerSettings } from '@/lib/photoAnalysis';
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
import {
  NATIVE_AUTH_CALLBACK_SCHEME,
  NativeAuth,
  isNativeIOS,
} from '@/lib/nativeBridge';

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
}

function SettingsGroup({
  label,
  children,
}: {
  label: string;
  index: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section className="mt-[30px] pt-5 border-t border-[var(--color-border)]">
      <div className="flex items-baseline justify-between mb-5">
        <span className="t-label">{label}</span>
      </div>
      {children}
    </section>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { user, profile, signOut, updateDisplayName } = useAuthStore();
  const {
    macroTarget,
    fetchMacroTarget,
    updateMacroTarget,
    nutritionProfile,
    fetchNutritionProfile,
    updateNutritionProfile,
    refreshAdaptiveTargets,
    whoopConnection,
    fetchWhoopConnection,
    connectWhoop,
    disconnectWhoop,
    syncWhoop,
  } = useAppStore();
  const theme = useThemeStore((state) => state.theme);
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [manageMealsOpen, setManageMealsOpen] = useState(false);
  const [savedMeals, setSavedMeals] = useState<SavedMeal[]>([]);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [editingMealId, setEditingMealId] = useState<string | null>(null);
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
  const [showNutritionWizard, setShowNutritionWizard] = useState(false);
  const [whoopAction, setWhoopAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [whoopMessage, setWhoopMessage] = useState<string | null>(null);
  const [whoopError, setWhoopError] = useState<string | null>(null);
  const [foodAnalysisMode, setFoodAnalysisMode] = useState(getFoodAnalysisMode);
  const [foodTrialBusy, setFoodTrialBusy] = useState(false);
  const [foodTrialMessage, setFoodTrialMessage] = useState<string | null>(null);
  const [photoWorkerDraft, setPhotoWorkerDraft] = useState<PhotoWorkerSettings>(() => getPhotoWorkerSettings());
  const [photoWorkerBusy, setPhotoWorkerBusy] = useState(false);
  const [photoWorkerMessage, setPhotoWorkerMessage] = useState<string | null>(null);
  const [healthWeightBusy, setHealthWeightBusy] = useState(false);
  const [healthWeightEnabled, setHealthWeightEnabled] = useState(() => (
    isNativeIOS() && isHealthWeightSyncEnabled()
  ));
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
    setWeightUnit(next);
    setPreferredWeightUnit(next);
  };

  const refreshBodyWeightHistory = useCallback(async (userId: string) => {
    try {
      const history = await getBodyWeightHistorySince(userId, WEIGHT_TREND_WINDOW_DAYS);
      setBodyWeightHistory(history);
      setLatestBodyWeight(history[0] ?? null);
      setBodyWeightError(null);
    } catch {
      setBodyWeightError('Could not load weight history. Pull to retry after checking your connection.');
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
    } catch (error) {
      setHealthWeightMessage(error instanceof Error ? error.message : 'Could not save that weigh-in.');
    } finally {
      setWeighInBusy(false);
    }
  };

  useEffect(() => {
    fetchMacroTarget();
    void fetchNutritionProfile();
  }, [fetchMacroTarget, fetchNutritionProfile]);

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
      setHealthWeightMessage(result.imported > 0
        ? `Imported ${result.imported} Apple Health weight entr${result.imported === 1 ? 'y' : 'ies'}.`
        : 'Apple Health weight is up to date.');
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
    setFoodTrialBusy(true);
    setFoodTrialMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error('Sign in again to check analysis usage.');
      const status = await getFoodTrialStatus(data.session.access_token);
      setFoodTrialMessage(summarizeFoodTrialStatus(status));
    } catch (error) {
      setFoodTrialMessage(error instanceof Error ? error.message : 'Could not check analysis usage.');
    } finally { setFoodTrialBusy(false); }
  };

  const handlePhotoWorkerSave = async () => {
    savePhotoWorkerSettings(photoWorkerDraft);
    setPhotoWorkerBusy(true);
    setPhotoWorkerMessage(null);
    const status = await checkPhotoWorker(photoWorkerDraft);
    setPhotoWorkerMessage(status.ok
      ? `Worker connected. Signed in: ${status.authenticatedProviders.join(', ') || 'none'}. Models: OpenAI ${status.models.openai || 'default'} (${status.efforts.openai || 'default'} effort), Claude ${status.models.anthropic || 'default'} (${status.efforts.anthropic || 'default'} effort).`
      : `Saved, but the worker is offline: ${status.error || 'connection failed'}`);
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
    setSearchParams(next, { replace: true });
  }, [fetchWhoopConnection, searchParams, setSearchParams]);

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
      setWhoopMessage(changes > 0 ? `Synced — ${result.created} new, ${result.updated} updated.` : 'Up to date.');
    } catch (error) {
      console.error('Error syncing WHOOP:', error);
      setWhoopError('Sync failed. Try again later.');
    } finally {
      setWhoopAction(null);
    }
  };

  const whoopStatusLabel = whoopAction === 'sync'
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedMeals([]);
        return;
      }

      const { data, error } = await supabase
        .from('foods')
        .select('id, user_id, name, calories, protein, carbs, fat, source')
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
    if (savedMeals.length === 0) return 'No meals saved yet';
    return `${savedMeals.length} meal${savedMeals.length === 1 ? '' : 's'} saved`;
  }, [loadingSavedMeals, savedMeals.length]);

  const openManageMeals = async () => {
    setManageMealsOpen(true);
    setEditingMealId(null);
    clearMealManagerFeedback();
    await fetchSavedMeals();
  };

  const closeManageMeals = () => {
    setManageMealsOpen(false);
    setEditingMealId(null);
    clearMealManagerFeedback();
  };

  const beginEditingMeal = (meal: SavedMeal) => {
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

  const insertSavedMealRecord = async (userId: string, values: { name: string; calories: number; protein: number; carbs: number; fat: number }) => {
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
      ({ data, error } = await supabase
        .from('foods')
        .insert(payload)
        .select('id')
        .single());
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setMealManagerError('Please sign in again to save meal edits.');
        return;
      }

      const replacementId = await insertSavedMealRecord(user.id, nextValues);
      if (!replacementId) {
        setMealManagerError('Could not save meal changes.');
        return;
      }

      await supabase
        .from('foods')
        .update({ source: 'manual_entry' })
        .eq('id', editingMealId)
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom']);

      setMealManagerMessage('Saved meal updated for future logs.');
      setEditingMealId(null);
      await fetchSavedMeals();
    } finally {
      setSavingMealEdit(false);
    }
  };

  const removeSavedMeal = async (meal: SavedMeal) => {
    if (!confirm(`Delete ${meal.name} from saved meals? Past logged entries will stay unchanged.`)) return;

    clearMealManagerFeedback();
    const { data: { user } } = await supabase.auth.getUser();
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
    calories: macroTarget?.calories || DEFAULT_MACRO_TARGET.calories,
    protein: macroTarget?.protein || DEFAULT_MACRO_TARGET.protein,
    carbs: macroTarget?.carbs || DEFAULT_MACRO_TARGET.carbs,
    fat: macroTarget?.fat || DEFAULT_MACRO_TARGET.fat,
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
          'Still estimated from your profile. Log food and weigh in a few times a week and the app will work out your real burn, usually within three weeks.',
      };
    }

    return {
      value: Math.round(learned).toLocaleString(),
      explanation: confidence === 'measured'
        ? 'Measured from what you logged against your weight trend, not a formula. Updates weekly.'
        : 'Being learned from your logs and weight trend — it will keep sharpening as more days come in.',
    };
  })();

  const macrosChanged =
    macros.calories !== baseMacros.calories
    || macros.protein !== baseMacros.protein
    || macros.carbs !== baseMacros.carbs
    || macros.fat !== baseMacros.fat
    || macros.source !== baseMacros.source;

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
  const handleCoachRecommendation = (recommendation: CoachRecommendation) => {
    clearMacroFeedback();
    setMacroDraft({
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
      setMacroMessage('Adaptive targets resumed.');
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
    clearMacroFeedback();
    setMacroDraft({ ...outcome.targets, source: 'calculated' });
    setShowNutritionWizard(false);

    try {
      await updateNutritionProfile(outcome.profile);
    } catch {
      setMacroError('Targets calculated, but your profile could not be saved.');
      return;
    }

    // Only record a weigh-in when the number actually moved, so recalculating
    // does not litter the weight series with duplicates.
    const latestKg = latestBodyWeight ? Number(latestBodyWeight.kilograms) : null;
    const weightChanged = latestKg == null || Math.abs(latestKg - outcome.weightKg) > 0.05;

    if (user?.id && weightChanged) {
      try {
        await recordManualBodyWeight(user.id, outcome.weightKg);
        await refreshBodyWeightHistory(user.id);
      } catch {
        // A failed weigh-in should not block the targets the user just built.
      }
    }

    setMacroMessage('Profile saved. Review the targets below and save them.');
  };

  const handleSaveMacros = async () => {
    clearMacroFeedback();
    setSavingMacros(true);

    try {
      await updateMacroTarget(macros);
      setMacroDraft(null);
      setMacroMessage('Daily targets saved.');
    } catch {
      setMacroError('Could not save daily targets. Please try again.');
    }

    setSavingMacros(false);
  };

  const handleSignOut = async () => {
    if (confirm('Sign out?')) {
      await signOut();
    }
  };

  return (
    <Screen>
      {/* Header */}
      <header>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Account</span>
          <span className="t-label-sm">Settings</span>
        </div>
        <h1 className="t-title mt-5">{profile?.display_name || 'You'}</h1>
      </header>

      {/* ── Profile ── */}
      <SettingsGroup label="Profile" index="01">
        <Input
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
          <p className="mt-4 t-caption text-[var(--color-text)]">{nameMessage}</p>
        )}
        {nameError && (
          <p className="mt-4 t-caption text-[var(--color-accent)]">{nameError}</p>
        )}
      </SettingsGroup>

      {/* ── Appearance ── */}
      <SettingsGroup label="Appearance" index="02" delay={0.04}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-heading">Theme</p>
            <p className="t-caption mt-1">
              {theme === 'light' ? 'Ivory' : 'Black'}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </SettingsGroup>

      {/* ── Nutrition targets ── */}
      <SettingsGroup label="Daily targets" index="03" delay={0.08}>
        {/* Compact records share one quiet numeric role. */}
        <dl>
          {[
            { label: 'Calories', value: macros.calories.toLocaleString(), unit: 'kcal' },
            { label: 'Protein', value: String(macros.protein), unit: 'g' },
            { label: 'Carbs', value: String(macros.carbs), unit: 'g' },
            { label: 'Fat', value: String(macros.fat), unit: 'g' },
          ].map((cell) => (
            <div
              key={cell.label}
              className="flex items-baseline justify-between gap-4 py-4 border-t border-[var(--color-border-soft)]"
            >
              <dt className="t-label-sm">{cell.label}</dt>
              <dd className="flex items-baseline gap-1.5">
                <span className="t-data text-[var(--color-text)]">{cell.value}</span>
                <span className="t-data-sm text-[var(--color-muted)]">{cell.unit}</span>
              </dd>
            </div>
          ))}
        </dl>

        {/* Where the targets came from, and what the app has learned. */}
        {nutritionProfile && (
          <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-label-sm">Daily burn</span>
              <span className="flex items-baseline gap-1.5">
                <span className="number-medium text-[var(--color-text)]">
                  {expenditureDisplay.value}
                </span>
                <span className="t-data-sm text-[var(--color-muted)]">kcal</span>
              </span>
            </div>
            <p className="t-caption mt-2 max-w-[44ch]">{expenditureDisplay.explanation}</p>

            {macros.source === 'manual' && (
              <div className="mt-4">
                <p className="t-caption max-w-[44ch]">
                  You set these by hand, so they stay exactly as you left them.
                </p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  size="sm"
                  loading={resumingAdaptive}
                  disabled={resumingAdaptive}
                  onClick={() => { void handleResumeAdaptiveTargets(); }}
                >
                  Resume adaptive targets
                </Button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className="pressable group mt-2 w-full flex items-center gap-4 py-4 border-t border-[var(--color-border)] text-left"
          onClick={() => {
            clearMacroFeedback();
            setShowNutritionWizard(true);
          }}
        >
          <span className="t-data-sm text-[var(--color-muted)] w-6">→</span>
          <span className="flex-1 min-w-0">
            <span className="t-heading block">Calculate my targets</span>
            <span className="t-caption">A short guided pass — body stats to macros</span>
          </span>
          <ArrowRight
            className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors"
            strokeWidth={1.5}
          />
        </button>

        <GoalsCoach
          profile={nutritionProfile}
          weightKg={latestBodyWeight ? Number(latestBodyWeight.kilograms) : null}
          currentTargets={baseMacros}
          onRecommendation={handleCoachRecommendation}
        />

        <div className="mt-8 mb-1">
          <span className="t-label-sm">Set manually</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 mt-4">
          <Input
            label="Calories"
            type="number"
            inputMode="numeric"
            value={macros.calories}
            onChange={(e) => editMacro('calories', e.target.value)}
          />
          <Input
            label="Protein (g)"
            type="number"
            inputMode="numeric"
            value={macros.protein}
            onChange={(e) => editMacro('protein', e.target.value)}
          />
          <Input
            label="Carbs (g)"
            type="number"
            inputMode="numeric"
            value={macros.carbs}
            onChange={(e) => editMacro('carbs', e.target.value)}
          />
          <Input
            label="Fat (g)"
            type="number"
            inputMode="numeric"
            value={macros.fat}
            onChange={(e) => editMacro('fat', e.target.value)}
          />
        </div>

        {(() => {
          const kcalFromMacros = Math.round(macros.protein * 4 + macros.carbs * 4 + macros.fat * 9);
          const driftPct = macros.calories > 0
            ? Math.round(Math.abs(macros.calories - kcalFromMacros) / macros.calories * 100)
            : 0;
          return driftPct > 5 ? (
            <p className="t-caption mt-3 text-[var(--color-accent)]">
              These macros add up to {kcalFromMacros.toLocaleString()} kcal — {driftPct}% off the
              calorie figure. One of them is probably a typo.
            </p>
          ) : null;
        })()}

        {macrosChanged && (
          <Button className="w-full mt-6" onClick={handleSaveMacros} loading={savingMacros}>
            Save targets
          </Button>
        )}
        {macroMessage && (
          <p className="mt-4 t-caption text-[var(--color-text)]">{macroMessage}</p>
        )}
        {macroError && (
          <p className="mt-4 t-caption text-[var(--color-accent)]">{macroError}</p>
        )}
      </SettingsGroup>

      {/* ── Saved meals ── */}
      <SettingsGroup label="Saved meals" index="04" delay={0.12}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-heading">Reusable meals</p>
            <p className="t-caption mt-1">{savedMealsCountLabel}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={openManageMeals}>
            Manage
          </Button>
        </div>
      </SettingsGroup>

      {/* ── Local food analysis ── */}
      <SettingsGroup label="Food analysis" index="05" delay={0.14}>
        <div className="space-y-4 mb-6">
          <SelectSheet title="Meal analysis" value={foodAnalysisMode} onChange={(mode) => {
            saveFoodAnalysisMode(mode); setFoodAnalysisMode(mode); setFoodTrialMessage(null);
          }} options={[
            { value: 'gemini', label: 'Gemini 3.8 Flash + Tavily', description: 'Photo and text analysis with Tavily nutrition lookup. No Mac worker needed for meals.' },
            { value: 'worker', label: 'Private Mac worker', description: 'Your existing Codex or Claude food analysis.' },
          ]} />
          {foodAnalysisMode === 'gemini' && <>
            <p className="t-caption">Gemini interprets your meal; Tavily looks up nutrition sources when needed. Adjust the result before saving. Daily request limits help control API costs.</p>
            <Button variant="secondary" className="w-full" loading={foodTrialBusy} onClick={() => void handleFoodTrialStatus()}>Check analysis usage</Button>
            {foodTrialMessage && <p className="t-caption" role="status">{foodTrialMessage}</p>}
          </>}
        </div>
        <p className="t-heading">Private Mac worker</p>
        <p className="t-caption mt-1 mb-5">
          Worker settings also serve the existing coach. Uses your local Codex or Claude login. On a phone, enter the worker’s Tailscale HTTPS URL.
        </p>
        <div className="space-y-4">
          <Input
            label="Worker URL"
            value={photoWorkerDraft.url}
            onChange={(event) => setPhotoWorkerDraft((current) => ({ ...current, url: event.target.value }))}
            placeholder="http://127.0.0.1:8788"
          />
          <SelectSheet
            title="Food model"
            value={photoWorkerDraft.provider}
            onChange={(provider) => setPhotoWorkerDraft((current) => ({ ...current, provider }))}
            options={[
              { value: 'openai', label: 'OpenAI Codex', description: 'Uses your local ChatGPT/Codex subscription login.' },
              { value: 'anthropic', label: 'Anthropic Claude', description: 'Local experimental connector; never use consumer credentials for other users.' },
            ]}
          />
          <Button variant="secondary" className="w-full" loading={photoWorkerBusy} onClick={() => void handlePhotoWorkerSave()}>
            Save and test worker
          </Button>
          {photoWorkerMessage && <p className="t-caption">{photoWorkerMessage}</p>}
        </div>
      </SettingsGroup>

      {/* ── Connected services ── */}
      <SettingsGroup label="Connected services" index="06" delay={0.17}>
        <div className="flex flex-col gap-4">
          <div>
            <p className="t-heading">WHOOP</p>
            <p className="t-caption mt-1" aria-live="polite">{whoopStatusLabel}</p>
          </div>
          {whoopConnection ? (
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button className="w-full" variant="secondary" size="sm" loading={whoopAction === 'sync'} disabled={whoopAction !== null} onClick={() => { void handleWhoopSyncNow(); }}>
                Sync now
              </Button>
              <Button className="w-full" variant="ghost" size="sm" loading={whoopAction === 'disconnect'} disabled={whoopAction !== null} onClick={() => { void handleWhoopDisconnect(); }}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button className="w-full" variant="secondary" size="sm" loading={whoopAction === 'connect'} disabled={whoopAction !== null} onClick={() => { void handleWhoopConnect(); }}>
              Connect
            </Button>
          )}
        </div>
        <div aria-live="polite">
          {whoopMessage && <p className="t-caption mt-3">{whoopMessage}</p>}
          {whoopError && <p className="t-caption mt-3 text-[var(--color-accent)]">{whoopError}</p>}
        </div>

        <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="t-heading">Body weight</p>
              <p className="t-caption mt-1">
                Weigh in below, or let Apple Health sync your scale
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="pressable min-h-11 px-2 t-label-sm"
                aria-label={`Show weight in ${weightUnit === 'lb' ? 'kilograms' : 'pounds'}`}
                onClick={handleToggleWeightUnit}
              >
                <span className={weightUnit === 'lb' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}>lb</span>
                <span className="text-[var(--color-muted)]"> / </span>
                <span className={weightUnit === 'kg' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}>kg</span>
              </button>
              {isNativeIOS() && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={healthWeightBusy}
                  disabled={healthWeightBusy}
                  onClick={() => { void handleHealthWeightSync(); }}
                >
                  {healthWeightEnabled ? 'Sync now' : 'Connect'}
                </Button>
              )}
            </div>
          </div>

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
                    {Math.abs(kgToUnit(weightTrend.kgPerWeek, weightUnit)).toFixed(2)} {weightUnit}/wk
                  </span>
                )}
              </div>
              <p className="t-caption mt-1.5">
                {format(new Date(latestBodyWeight.measured_at), 'MMM d · h:mm a')} · {latestBodyWeight.source_name}
              </p>
              {weightTrend.latestEwmaKg !== null && weightTrend.fittedDayCount >= 2 && (
                <p className="t-caption mt-1">
                  Trend {formatWeight(weightTrend.latestEwmaKg, weightUnit)} {weightUnit} · smoothed over{' '}
                  {weightTrend.observedDayCount} weigh-in{weightTrend.observedDayCount === 1 ? '' : 's'}
                </p>
              )}
              {bodyWeightHistory.length > 1 && (
                <ul className="mt-4 border-t border-[var(--color-border)]">
                  {bodyWeightHistory.slice(1, 6).map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline justify-between gap-4 py-2 border-b border-[var(--color-border)]"
                    >
                      <span className="t-caption">{format(new Date(entry.measured_at), 'MMM d')}</span>
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
                : 'No weigh-ins yet. Record one below — a few a week is what makes your targets adapt.'}
            </p>
          )}

          {/* Manual weigh-in — the adaptive targets need a weight series, and
              not everyone has a scale that writes to Apple Health. */}
          <div className="mt-6 pt-6 border-t border-[var(--color-border)]">
            <label className="t-label-sm block mb-2" htmlFor="weigh-in">Record a weigh-in</label>
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
                onClick={() => { void handleRecordWeighIn(); }}
              >
                Save
              </Button>
            </div>
          </div>

          {isNativeIOS() && healthWeightEnabled && (
            <button
              type="button"
              onClick={handleDisableHealthWeightSync}
              className="mt-3 t-label-sm text-[var(--color-muted)] border-b border-[var(--color-border-strong)]"
            >
              Stop automatic sync
            </button>
          )}
          {healthWeightMessage && (
            <p className="t-caption mt-3" aria-live="polite">{healthWeightMessage}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 mt-6 pt-5 border-t border-[var(--color-border)]">
          <div>
            <p className="t-heading">iPhone GPS</p>
            <p className="t-caption mt-1">Built in • no paid account</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/train/run')}>
            Start a run
          </Button>
        </div>
      </SettingsGroup>

      {/* ── Account ── */}
      <SettingsGroup label="Session" index="07" delay={0.2}>
        <Button variant="danger" size="lg" className="w-full" onClick={handleSignOut}>
          <LogOut className="w-4 h-4" strokeWidth={1.75} />
          Sign out
        </Button>
      </SettingsGroup>

      {/* App info — colophon */}
      <motion.footer
        className="mt-12 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...springs.smooth, delay: 0.2 }}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="t-display-italic text-[21px] text-[var(--color-text-dim)]">
            hy<span className="italic text-[var(--color-accent)]">P</span>er
          </h2>
          {/* Tapping the build stamp fires a test haptic — handy for verifying device support */}
          <button
            type="button"
            onClick={() => tapHaptic()}
            className="t-data-sm text-[var(--color-muted)] min-h-11 py-2"
          >
            build {__BUILD_ID__}
          </button>
        </div>
        <p className="t-label-sm mt-3">Built on peer-reviewed research</p>
      </motion.footer>

      {/* Macro calculator — focused sheet */}
      <Modal
        isOpen={showNutritionWizard}
        onClose={() => setShowNutritionWizard(false)}
        title="Calculate targets"
      >
        <div className="pt-1 pb-2">
          <NutritionWizard
            initialProfile={nutritionProfile}
            initialWeightKg={latestBodyWeight ? Number(latestBodyWeight.kilograms) : null}
            onApply={handleApplyCalculatedTargets}
            onCancel={() => setShowNutritionWizard(false)}
          />
        </div>
      </Modal>

      {/* Saved meals manager */}
      <Modal isOpen={manageMealsOpen} onClose={closeManageMeals} title="Saved meals">
        <div className="pt-1 pb-2">
          {mealManagerMessage && (
            <p className="mb-4 t-caption text-[var(--color-text)]">{mealManagerMessage}</p>
          )}
          {mealManagerError && (
            <p className="mb-4 t-caption text-[var(--color-accent)]">{mealManagerError}</p>
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
                        onChange={(e) => setEditingMealDraft({ ...editingMealDraft, name: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                        <Input
                          label="Calories"
                          type="number"
                          value={editingMealDraft.calories}
                          onChange={(e) => setEditingMealDraft({ ...editingMealDraft, calories: e.target.value })}
                        />
                        <Input
                          label="Protein"
                          type="number"
                          value={editingMealDraft.protein}
                          onChange={(e) => setEditingMealDraft({ ...editingMealDraft, protein: e.target.value })}
                        />
                        <Input
                          label="Carbs"
                          type="number"
                          value={editingMealDraft.carbs}
                          onChange={(e) => setEditingMealDraft({ ...editingMealDraft, carbs: e.target.value })}
                        />
                        <Input
                          label="Fat"
                          type="number"
                          value={editingMealDraft.fat}
                          onChange={(e) => setEditingMealDraft({ ...editingMealDraft, fat: e.target.value })}
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
                          onClick={() => setEditingMealId(null)}
                          disabled={savingMealEdit}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-stretch justify-between overflow-hidden">
                      <div className="min-w-0">
                        <p className="t-heading break-words pr-2 normal-case tracking-normal text-[var(--color-text)]">{meal.name}</p>
                        <p className="t-data-sm mt-1.5 break-words pr-2 leading-5 text-[var(--color-muted)]">
                          {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-stretch">
                        <button
                          type="button"
                          onClick={() => beginEditingMeal(meal)}
                          className="pressable flex min-h-11 w-11 items-center justify-center text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                          aria-label={`Edit saved meal ${meal.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
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
      </Modal>
    </Screen>
  );
}
