import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, ImagePlus, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, DateField, FormField, Input, SegmentedControl, SelectSheet, Stepper, TimeField } from '@/components/shared';
import { springs } from '@/lib/animations';
import { useLitSurface } from '@/hooks/useLitSurface';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { buildEntryPayload, chosenFoodLogSource, persistNutritionEntry, type BarcodeProvider } from '@/lib/saveNutritionEntry';
import { createPendingEntryId, entryWriteId } from '@/lib/pendingEntryId';
import { createRequestGate } from '@/lib/requestGate';
import { barcodeProviderLabel, lookupBarcode } from '@/lib/barcodeLookup';
import { readSavedFoodsCache, writeSavedFoodsCache } from '@/lib/savedFoodsCache';
import { filterSavedMeals, foodValuesMatch, loadSavedMeals, replaceSavedMeal, retireSavedMeal, savedMealSuggestions } from '@/lib/savedMeals';
import { ensureFoodRow } from '@/lib/foodPersistence';
import { resolveManualFood, type OneOffFood } from '@/lib/manualFood';
import { formatMacroInput, formatMeasurementAmount } from '@/lib/foodUnits';
import {
  buildPhotoHint,
  COMBINE_MEAL_KEY,
  groundPhotoItems,
  logPhotoItems,
  MAX_ANALYSIS_DATA_URL_CHARS,
  MAX_ANALYSIS_IMAGE_DIMENSION,
  MAX_PHOTO_UPLOAD_BYTES,
  MIN_ANALYSIS_JPEG_QUALITY,
  photoItemsInvalid,
  photoItemStatus,
  photoItemTotals,
  providerFallbackNote,
  providerName,
  type PhotoReviewItem,
} from '@/lib/photoReview';
import { useAuthStore } from '@/stores/authStore';
import type { Food, NutritionGroup } from '@/types';
import { format, isToday } from 'date-fns';
import {
  computeAmountFromServings,
  computeServingsFromAmount,
  describeTargetUnchanged,
  getCompatibleMeasurementUnits,
  normalizeFoodName,
  toLocalTimeInput,
  type MeasurementUnit,
} from './foodLoggerUtils';
import {
  analyzeFoodPhoto,
  getPhotoWorkerSettings,
  type PhotoAnalysisAngle,
  type PhotoAnalysisProvider,
} from '@/lib/photoAnalysis';
import { describeFoodWithAi, type FoodDescriptionResult } from '@/lib/foodDescription';
import { ServingEntry } from './ServingEntry';
import { FoodTrialLogger, type FoodTrialDraftState } from './FoodTrialLogger';
import './fuel.css';
import { getFoodAnalysisMode, trialIngredientFood, trialItemFood, trialLogSource, type TrialFoodItem } from '@/lib/foodTrial';
import { createMealIngredient, decodeMealComposition, type MealIngredient } from '@/lib/mealComposition';
import { nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { bindFoodToBarcode } from '@/lib/savedBarcodeFoods';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import { searchUsdaFoodsSecureStrict, withUsdaPortion } from '@/lib/usdaClient';

const MAX_UPLOAD_FILE_BYTES = MAX_PHOTO_UPLOAD_BYTES;
const MAX_IMAGE_DIMENSION = MAX_ANALYSIS_IMAGE_DIMENSION;

const BarcodeScanner = lazy(() => import('./BarcodeScanner').then((module) => ({
  default: module.BarcodeScanner,
})));


type PhotoFiles = Partial<Record<PhotoAnalysisAngle, File>>;
type PhotoPreviews = Partial<Record<PhotoAnalysisAngle, string>>;

type SelectedFoodMeta = {
  source: 'photo';
  confidence: number;
  reasoning?: string;
} | {
  source: 'barcode';
  barcode: string;
  provider: BarcodeProvider;
};

export interface EditableNutritionEntry {
  id: string;
  date: string;
  logged_at: string | null;
  food_id: string;
  servings: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  group_id?: string | null;
  source?: string;
  food?: {
    id: string;
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    serving_size?: number;
    serving_unit?: string;
    description?: string | null;
  } | null;
}

export type FoodCaptureMethod = 'saved' | 'search' | 'barcode' | 'manual' | 'photo';
export interface FoodLoggerProps {
  selectedDate: Date;
  onComplete: () => void;
  initialEntry?: EditableNutritionEntry | null;
  groups?: NutritionGroup[];
  onAddIngredients?: (ingredients: MealIngredient[]) => void;
  initialMethod?: FoodCaptureMethod;
  onMethodChange?: (method: FoodCaptureMethod) => void;
  onComposeMeal?: (food: Food, editSaved?: boolean) => void;
  /** True while a photo, describe or AI analysis runs, so closing can ask first. */
  onAnalysisBusyChange?: (busy: boolean) => void;
  /** True while a finished photo estimate waits unseen on the Photo tab. */
  onUnreviewedResultChange?: (waiting: boolean) => void;
}

export function FoodLogger({ selectedDate, onComplete, initialEntry = null, groups = [], onAddIngredients, initialMethod, onMethodChange, onComposeMeal, onAnalysisBusyChange, onUnreviewedResultChange }: FoodLoggerProps) {
  const initialLogDate = useMemo(() => {
    if (initialEntry?.date) {
      const parsed = new Date(`${initialEntry.date}T12:00:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return new Date(selectedDate);
  }, [initialEntry?.date, selectedDate]);

  const [servingReviewOpen, setServingReviewOpen] = useState(false);
  const litRetakeRef = useLitSurface<HTMLButtonElement>();
  const [mode, setMode] = useState<FoodCaptureMethod>(initialEntry ? 'manual' : initialMethod || 'saved');
  useEffect(() => { onMethodChange?.(mode); }, [mode, onMethodChange]);
  const [foodAnalysisMode] = useState(getFoodAnalysisMode);
  const [trialInitialHint, setTrialInitialHint] = useState('');
  // The AI logger stays mounted (hidden) once its tab was opened, so switching
  // tabs mid-analysis or after a result keeps its photos, result and edits.
  // trialKey remounts it for a Describe hand-off so it reads the new hint.
  const [trialVisited, setTrialVisited] = useState(false);
  const [trialKey, setTrialKey] = useState(0);
  const [trialAnalyzing, setTrialAnalyzing] = useState(false);
  const [trialDraftState, setTrialDraftState] = useState<FoodTrialDraftState>({ hasDraft: false, busy: false });
  useEffect(() => {
    if (foodAnalysisMode === 'gemini' && mode === 'photo') setTrialVisited(true);
  }, [foodAnalysisMode, mode]);
  const trialSavedFoods = useRef(new WeakMap<TrialFoodItem, string>());
  const trialEntryIds = useRef(new WeakMap<TrialFoodItem, string>());
  // one id per new entry until it is confirmed saved, so a retry after a lost
  // response updates that row instead of logging the food twice
  const [pendingEntryId] = useState(createPendingEntryId);
  // one-off manual food row from a failed log, reused when retried unchanged
  const manualFoodRef = useRef<OneOffFood | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  // what the last manual USDA search found: nothing, or a failure to retry
  const [searchStatus, setSearchStatus] = useState<'idle' | 'short' | 'empty' | 'error'>('idle');
  const [usdaSearches] = useState(createRequestGate);
  const [loadingFoodId, setLoadingFoodId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [servings, setServings] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementAmount, setMeasurementAmount] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>('serving');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState<Date>(initialLogDate);
  const [timeValue, setTimeValue] = useState(() =>
    toLocalTimeInput(initialEntry?.logged_at || null, isToday(initialLogDate) ? new Date() : initialLogDate)
  );
  const orderedGroups = useMemo(() => sortNutritionGroups(groups), [groups]);
  const initialGroupId = initialEntry?.group_id
    || orderedGroups.find((group) => group.label === initialEntry?.meal_type)?.id
    || '';
  const [groupId, setGroupId] = useState<string>(initialGroupId);
  const [selectedFoodMeta, setSelectedFoodMeta] = useState<SelectedFoodMeta | null>(null);
  // set when every barcode source missed; manual entry then offers to save a
  // personal product bound to this code
  const [missedBarcode, setMissedBarcode] = useState<string | null>(null);
  const [pendingBarcodeBinding, setPendingBarcodeBinding] = useState<string | null>(null);
  // a newer scan, or leaving the Scan tab, supersedes an in-flight lookup so a
  // late result can't replace the product under review or bind the wrong code
  const [barcodeLookups] = useState(createRequestGate);
  useEffect(() => {
    if (mode !== 'barcode') barcodeLookups.invalidate();
  }, [mode, barcodeLookups]);
  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const entryDateKey = format(entryDate, 'yyyy-MM-dd');
  const entryUsesSelectedDayGroups = entryDateKey === selectedDateKey;

  useEffect(() => {
    if (!entryUsesSelectedDayGroups && groupId) setGroupId('');
  }, [entryUsesSelectedDayGroups, groupId]);

  const loggerMode = initialEntry ? 'edit' : 'create';

  const [manualFood, setManualFood] = useState({
    name: initialEntry?.food?.name || '',
    calories: initialEntry?.food ? formatMacroInput(initialEntry.food.calories) : '',
    protein: initialEntry?.food ? formatMacroInput(initialEntry.food.protein) : '',
    carbs: initialEntry?.food ? formatMacroInput(initialEntry.food.carbs) : '',
    fat: initialEntry?.food ? formatMacroInput(initialEntry.food.fat) : '',
  });
  const storeUserId = useAuthStore((state) => state.user?.id);
  // start from the last list this account fetched; the refetch still runs
  const [savedMeals, setSavedMeals] = useState<Food[]>(() => readSavedFoodsCache(storeUserId) ?? []);
  const [savedMealFetches] = useState(createRequestGate);
  const [savedQuery, setSavedQuery] = useState('');
  const [managingSavedMeals, setManagingSavedMeals] = useState(false);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [manualNameFocused, setManualNameFocused] = useState(false);
  const [selectedSavedMealId, setSelectedSavedMealId] = useState<string | null>(null);
  const [saveAsReusableMeal, setSaveAsReusableMeal] = useState(false);
  const [updatingSavedMeal, setUpdatingSavedMeal] = useState(false);
  const [deletingSavedMealId, setDeletingSavedMealId] = useState<string | null>(null);
  const [savedMealMessage, setSavedMealMessage] = useState<string | null>(null);
  const [savedMealError, setSavedMealError] = useState<string | null>(null);
  const openManualAsSavedMealRef = useRef(false);
  const [showFoodDescription, setShowFoodDescription] = useState(false);
  const [foodDescription, setFoodDescription] = useState('');
  const [foodDescriptionBusy, setFoodDescriptionBusy] = useState(false);
  const [foodDescriptionError, setFoodDescriptionError] = useState<string | null>(null);
  const [foodDescriptionResult, setFoodDescriptionResult] = useState<FoodDescriptionResult | null>(null);
  // set when the user edited the fields or picked a saved meal while a describe
  // ran: the estimate waits for "Fill fields" instead of replacing their input
  const [pendingDescribeFill, setPendingDescribeFill] = useState(false);
  const [describeRequests] = useState(createRequestGate);
  const describeTargetRef = useRef({ manualFood, selectedSavedMealId });
  useEffect(() => {
    describeTargetRef.current = { manualFood, selectedSavedMealId };
  }, [manualFood, selectedSavedMealId]);
  useEffect(() => () => describeRequests.invalidate(), [describeRequests]);
  const [photoHint, setPhotoHint] = useState('');
  const [photoPlateDiameter, setPhotoPlateDiameter] = useState('');
  const [photoIngredients, setPhotoIngredients] = useState('');
  const [photoFiles, setPhotoFiles] = useState<PhotoFiles>({});
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreviews>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoItems, setPhotoItems] = useState<PhotoReviewItem[]>([]);
  const analysisBusy = photoAnalyzing || foodDescriptionBusy || trialAnalyzing;
  useEffect(() => {
    onAnalysisBusyChange?.(analysisBusy);
    return () => onAnalysisBusyChange?.(false);
  }, [analysisBusy, onAnalysisBusyChange]);
  // a photo estimate that landed while the user was on another tab: the Photo
  // tab is marked and closing the sheet asks before discarding it
  const photoResultWaiting = mode !== 'photo' && photoItems.length > 0;
  useEffect(() => {
    onUnreviewedResultChange?.(photoResultWaiting);
    return () => onUnreviewedResultChange?.(false);
  }, [photoResultWaiting, onUnreviewedResultChange]);
  // On by default: the breakdown is how the estimate is made accurate, but one
  // row per plate is how the day stays readable. Remembered per device.
  const [combineAsOneMeal, setCombineAsOneMeal] = useState<boolean>(() => {
    const stored = globalThis.localStorage?.getItem(COMBINE_MEAL_KEY);
    return stored == null ? true : stored === '1';
  });
  // seed from the saved worker settings so the label reflects the user's
  // choice before the first analysis instead of a hardcoded default
  const [photoProvider, setPhotoProvider] = useState<PhotoAnalysisProvider>(() => getPhotoWorkerSettings().provider);
  const [photoModel, setPhotoModel] = useState('');
  const [photoSummary, setPhotoSummary] = useState('');
  const topPhotoInputRef = useRef<HTMLInputElement>(null);
  const sidePhotoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewsRef = useRef<PhotoPreviews>({});

  useEffect(() => {
    photoPreviewsRef.current = photoPreviews;
  }, [photoPreviews]);

  useEffect(() => () => {
    Object.values(photoPreviewsRef.current).forEach((preview) => URL.revokeObjectURL(preview));
  }, []);

  // a list already on screen stays while it refreshes; the spinner is only
  // for a list that has nothing to show yet
  const showSavedMealsLoading = loadingSavedMeals && savedMeals.length === 0;
  const manualSuggestions = useMemo(() => savedMealSuggestions(savedMeals, manualFood.name), [manualFood.name, savedMeals]);
  const filteredSavedMeals = useMemo(() => filterSavedMeals(savedMeals, savedQuery), [savedMeals, savedQuery]);
  const selectedSavedMeal = useMemo(
    () => (selectedSavedMealId ? savedMeals.find((meal) => meal.id === selectedSavedMealId) || null : null),
    [savedMeals, selectedSavedMealId]
  );
  const searchUSDA = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // the lookup rejects shorter queries, which used to look like no matches
    if (trimmed.length < 2) {
      setSearchStatus('short');
      return;
    }

    // a newer search (e.g. Enter pressed again mid-flight) supersedes this one,
    // so the results always match the words in the box
    const isCurrent = usdaSearches.begin();
    setLoading(true);
    setSearchStatus('idle');
    try {
      const foods = await searchUsdaFoodsSecureStrict(trimmed);
      if (!isCurrent()) return;
      setSearchResults(foods);
      if (foods.length === 0) setSearchStatus('empty');
    } catch {
      if (!isCurrent()) return;
      setSearchResults([]);
      setSearchStatus('error');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleBarcodeDetected = useCallback(async (barcode: string): Promise<boolean> => {
    // a superseded lookup applies nothing
    const result = await lookupBarcode(barcode, barcodeLookups.begin());
    if (result.status === 'stale') return false;
    if (result.status === 'miss') {
      // remember the code so manual entry can create a personal product
      // bound to it — the next scan then resolves from the saved catalog
      setMissedBarcode(barcode);
      return false;
    }
    setMissedBarcode(null);
    setSelectedFoodMeta({ source: 'barcode', barcode, provider: result.provider });
    setSelectedFood(result.food);
    setMeasurementUnit('serving');
    setServings('1');
    setMeasurementAmount('1');
    return true;
  }, [barcodeLookups]);

  const handleDescribeFood = async () => {
    if (foodDescriptionBusy) return;
    if (foodAnalysisMode === 'gemini') {
      if (trialAnalyzing || trialDraftState.busy) return;
      if (trialDraftState.hasDraft
        && !window.confirm('Replace the current AI meal? Unsaved work on the AI tab will be discarded.')) return;
      setTrialInitialHint(foodDescription);
      setTrialKey((key) => key + 1);
      setMode('photo');
      return;
    }

    const isCurrent = describeRequests.begin();
    const before = describeTargetRef.current;
    setFoodDescriptionBusy(true);
    setFoodDescriptionError(null);
    setPendingDescribeFill(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session expired. Please sign out and sign back in.');

      const describeSettings = getPhotoWorkerSettings();
      const result = await describeFoodWithAi({
        description: foodDescription,
        accessToken,
        settings: describeSettings,
      });
      if (!isCurrent()) return;
      // surface a provider fallback instead of silently labeling the answer
      // with a different name than the one the user chose
      const describeFallbackNote = providerFallbackNote(describeSettings.provider, result.provider, 'answered');
      setFoodDescriptionResult(describeFallbackNote
        ? { ...result, notes: `${describeFallbackNote}${result.notes || ''}`.trim() }
        : result);
      if (describeTargetUnchanged(before, describeTargetRef.current)) applyDescribeEstimate(result);
      else setPendingDescribeFill(true);
    } catch (error) {
      if (isCurrent()) setFoodDescriptionError(error instanceof Error ? error.message : 'Could not research this food.');
    } finally {
      setFoodDescriptionBusy(false);
    }
  };

  const applyDescribeEstimate = (result: FoodDescriptionResult) => {
    setManualFood({
      name: result.name,
      calories: formatMacroInput(result.calories),
      protein: formatMacroInput(result.protein_g),
      carbs: formatMacroInput(result.carbs_g),
      fat: formatMacroInput(result.fat_g),
    });
    setSelectedSavedMealId(null);
    setSaveAsReusableMeal(true);
    setManualNameFocused(false);
    setSavedMealMessage(null);
    setSavedMealError(null);
    setPendingDescribeFill(false);
  };

  const clearSavedMealFeedback = () => {
    setSavedMealMessage(null);
    setSavedMealError(null);
  };

  const selectedFoodCompatibleUnits = useMemo(() => {
    if (!selectedFood) return ['serving'] as MeasurementUnit[];
    return getCompatibleMeasurementUnits(selectedFood.serving_unit);
  }, [selectedFood]);

  const resolvedSelectedFoodServings = useMemo(() => {
    if (!selectedFood) return null;

    const amount = parseFloat(measurementAmount);
    if (measurementUnit === 'serving') {
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return amount;
    }

    return computeServingsFromAmount({
      amount,
      amountUnitRaw: measurementUnit,
      servingSize: selectedFood.serving_size,
      servingUnitRaw: selectedFood.serving_unit,
    });
  }, [measurementAmount, measurementUnit, selectedFood]);

  const selectedFoodMeasurementError = useMemo(() => {
    if (!selectedFood) return null;

    const amount = parseFloat(measurementAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'Enter a valid amount greater than zero.';
    }

    if (resolvedSelectedFoodServings === null) {
      return `Can't convert ${measurementUnit} to ${selectedFood.serving_unit || 'serving'} for this food.`;
    }

    return null;
  }, [measurementAmount, measurementUnit, resolvedSelectedFoodServings, selectedFood]);

  useEffect(() => {
    if (!selectedFood) return;

    const servingAmount = parseFloat(servings || '1');
    const safeServingAmount = Number.isFinite(servingAmount) && servingAmount > 0 ? servingAmount : 1;

    setMeasurementUnit('serving');
    setMeasurementAmount(formatMeasurementAmount(safeServingAmount));
  }, [selectedFood, servings]);

  const selectedFoodTotalCalories = useMemo(() => {
    if (!selectedFood || resolvedSelectedFoodServings === null) return 0;
    return Math.round(selectedFood.calories * resolvedSelectedFoodServings);
  }, [resolvedSelectedFoodServings, selectedFood]);

  const selectedFoodTotalProtein = useMemo(() => {
    if (!selectedFood || resolvedSelectedFoodServings === null) return 0;
    return Math.round(selectedFood.protein * resolvedSelectedFoodServings);
  }, [resolvedSelectedFoodServings, selectedFood]);

  const manualMacroValues = useMemo(
    () => ({
      name: manualFood.name.trim(),
      calories: parseFloat(manualFood.calories) || 0,
      protein: parseFloat(manualFood.protein) || 0,
      carbs: parseFloat(manualFood.carbs) || 0,
      fat: parseFloat(manualFood.fat) || 0,
    }),
    [manualFood]
  );

  const manualServingsValue = useMemo(() => {
    const parsed = parseFloat(servings);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [servings]);

  const isSelectedSavedMealMatch = useMemo(
    () => !!selectedSavedMeal && foodValuesMatch(selectedSavedMeal, manualMacroValues),
    [manualMacroValues, selectedSavedMeal],
  );

  const fetchSavedMeals = useCallback(async () => {
    // an older response must never overwrite a newer one
    const isCurrent = savedMealFetches.begin();
    setLoadingSavedMeals(true);
    try {
      const userId = await getSessionUserId();
      if (!isCurrent()) return;
      if (!userId) {
        setSavedMeals([]);
        return;
      }

      const { meals, error } = await loadSavedMeals(userId);

      if (!isCurrent()) return;
      if (error) {
        console.error('Error fetching saved meals:', error);
        setSavedMeals([]);
        return;
      }

      setSavedMeals(meals);
      if (useAuthStore.getState().user?.id === userId) writeSavedFoodsCache(userId, meals);
    } finally {
      if (isCurrent()) setLoadingSavedMeals(false);
    }
  }, [savedMealFetches]);

  const handleSelectSavedMeal = (meal: Food) => {
    // a describe still running must not replace the meal just picked
    describeRequests.invalidate();
    if (decodeMealComposition(meal.description)) {
      if (onAddIngredients || !onComposeMeal) {
        setSelectedFood(meal);
        setSelectedFoodMeta(null);
        setServings('1');
      } else onComposeMeal?.(meal);
      return;
    }
    clearSavedMealFeedback();
    setManualFood({
      name: meal.name,
      calories: formatMacroInput(meal.calories),
      protein: formatMacroInput(meal.protein),
      carbs: formatMacroInput(meal.carbs),
      fat: formatMacroInput(meal.fat),
    });
    setSelectedSavedMealId(meal.id);
    setSaveAsReusableMeal(false);
    setManualNameFocused(false);
  };

  const handleLogSavedMeal = (meal: Food) => {
    if (!onAddIngredients && onComposeMeal && decodeMealComposition(meal.description)) {
      onComposeMeal(meal);
      return;
    }
    setSelectedFoodMeta(null);
    setSelectedFood(meal);
    setMeasurementUnit('serving');
    setMeasurementAmount('1');
    setServings('1');
  };

  const handleEditSavedMeal = (meal: Food) => {
    if (onComposeMeal && decodeMealComposition(meal.description)) {
      onComposeMeal(meal, true);
      return;
    }
    handleSelectSavedMeal(meal);
    setManagingSavedMeals(false);
    setMode('manual');
  };

  const handleAddSavedMeal = () => {
    describeRequests.invalidate();
    setPendingDescribeFill(false);
    clearSavedMealFeedback();
    setManagingSavedMeals(false);
    openManualAsSavedMealRef.current = true;
    setManualFood({ name: '', calories: '', protein: '', carbs: '', fat: '' });
    setSelectedSavedMealId(null);
    setFoodDescriptionResult(null);
    setFoodDescriptionError(null);
    setManualNameFocused(false);
    setMode('manual');
  };

  const handleDeleteSavedMeal = async (meal: Food) => {
    if (!confirm(`Delete ${meal.name} from saved meals? Past logged entries will stay unchanged.`)) return;

    clearSavedMealFeedback();
    setDeletingSavedMealId(meal.id);
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        setSavedMealError('Please sign in again to delete saved meals.');
        return;
      }

      const { error } = await retireSavedMeal(userId, meal.id);

      if (error) {
        setSavedMealError('Could not delete saved meal. Please try again.');
        return;
      }

      if (selectedSavedMealId === meal.id) setSelectedSavedMealId(null);
      setSavedMealMessage('Saved meal deleted. Past logs were not changed.');
      await fetchSavedMeals();
    } finally {
      setDeletingSavedMealId(null);
    }
  };

  useEffect(() => {
    if (mode !== 'manual' && mode !== 'saved') return;

    fetchSavedMeals();
    if (mode === 'manual') {
      clearSavedMealFeedback();
      setSaveAsReusableMeal(openManualAsSavedMealRef.current);
      openManualAsSavedMealRef.current = false;
    }
  }, [mode, fetchSavedMeals]);

  const resetPhotoState = () => {
    setPhotoError(null);
    Object.values(photoPreviews).forEach((preview) => URL.revokeObjectURL(preview));
    setPhotoFiles({});
    setPhotoPreviews({});
    setPhotoHint('');
    setPhotoPlateDiameter('');
    setPhotoIngredients('');
    setPhotoItems([]);
    setPhotoSummary('');
    setPhotoModel('');
  };

  const handleRetakePhoto = (angle: PhotoAnalysisAngle) => {
    setPhotoError(null);
    const preview = photoPreviews[angle];
    if (preview) URL.revokeObjectURL(preview);
    setPhotoFiles((current) => {
      const next = { ...current };
      delete next[angle];
      return next;
    });
    setPhotoPreviews((current) => {
      const next = { ...current };
      delete next[angle];
      return next;
    });
    setPhotoItems([]);
    setPhotoSummary('');
    setPhotoModel('');
    const input = angle === 'top' ? topPhotoInputRef.current : sidePhotoInputRef.current;
    if (input) input.value = '';
    input?.click();
  };

  const fileToCompressedJpegBase64 = (file: File) =>
    new Promise<{ imageBase64: string; mimeType: string }>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;

          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
          const targetWidth = Math.max(1, Math.round(width * scale));
          const targetHeight = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Could not process image.'));
            return;
          }

          context.drawImage(image, 0, 0, targetWidth, targetHeight);

          let quality = 0.82;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);

          while (dataUrl.length > MAX_ANALYSIS_DATA_URL_CHARS && quality > MIN_ANALYSIS_JPEG_QUALITY) {
            quality -= 0.08;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          if (dataUrl.length > MAX_ANALYSIS_DATA_URL_CHARS) {
            reject(new Error('Image is too large for analysis. Try a closer crop.'));
            return;
          }

          const imageBase64 = dataUrl.split(',')[1];
          if (!imageBase64) {
            reject(new Error('Invalid image format'));
            return;
          }

          resolve({ imageBase64, mimeType: 'image/jpeg' });
        } catch {
          reject(new Error('Could not process image.'));
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read image.'));
      };

      image.src = objectUrl;
    });

  const handlePhotoSelect = (angle: PhotoAnalysisAngle, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setPhotoError(null);

    if (!file) {
      const existingPreview = photoPreviews[angle];
      if (existingPreview) URL.revokeObjectURL(existingPreview);
      setPhotoFiles((current) => {
        const next = { ...current };
        delete next[angle];
        return next;
      });
      setPhotoPreviews((current) => {
        const next = { ...current };
        delete next[angle];
        return next;
      });
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setPhotoError('Image is too large. Please choose one under 10MB.');
      return;
    }

    const existingPreview = photoPreviews[angle];
    if (existingPreview) URL.revokeObjectURL(existingPreview);
    setPhotoFiles((current) => ({ ...current, [angle]: file }));
    setPhotoPreviews((current) => ({ ...current, [angle]: URL.createObjectURL(file) }));
  };

  const handleUsePreviewPhoto = () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
        <rect width="720" height="480" fill="#d8d0c0"/>
        <ellipse cx="360" cy="250" rx="260" ry="175" fill="#f6f1e7" stroke="#786f62" stroke-width="8"/>
        <path d="M180 235c35-75 130-85 170-20-18 85-105 125-170 70z" fill="#b77747"/>
        <path d="M375 160c80-35 155 15 150 95-75 40-150 20-170-45z" fill="#ece3cf"/>
        <circle cx="420" cy="315" r="48" fill="#4f7048"/>
        <circle cx="485" cy="325" r="42" fill="#5f8156"/>
        <circle cx="455" cy="275" r="38" fill="#55784e"/>
      </svg>`;
    const file = new File([svg], 'preview-meal.svg', { type: 'image/svg+xml' });

    setPhotoError(null);
    Object.values(photoPreviews).forEach((preview) => URL.revokeObjectURL(preview));
    setPhotoFiles({ top: file });
    setPhotoPreviews({ top: URL.createObjectURL(file) });
  };

  const handleAnalyzePhoto = async () => {
    if ((!photoFiles.top && !photoFiles.side) || saving) return;

    setPhotoError(null);
    setPhotoAnalyzing(true);

    try {
      const captureEntries = (['top', 'side'] as const)
        .flatMap((angle) => photoFiles[angle] ? [{ angle, file: photoFiles[angle] as File }] : []);
      const preparedImages = await Promise.all(captureEntries.map(async ({ angle, file }) => ({
        angle,
        ...await fileToCompressedJpegBase64(file),
      })));
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error('Your session expired. Please sign out and sign back in.');
      }

      const settings = getPhotoWorkerSettings();
      const context = buildPhotoHint({ plateDiameter: photoPlateDiameter, ingredients: photoIngredients, details: photoHint });
      const result = await analyzeFoodPhoto({
        images: preparedImages,
        hint: context,
        accessToken,
        settings,
      });

      const grounded = await groundPhotoItems(result.items);

      setPhotoProvider(result.provider);
      setPhotoModel(result.model);
      // the worker silently falls back to the other provider when the chosen
      // one fails — say so instead of quietly showing the wrong name
      const fallbackNote = providerFallbackNote(getPhotoWorkerSettings().provider, result.provider, 'analyzed this photo');
      setPhotoSummary(`${fallbackNote}${result.summary}`);
      setPhotoItems(grounded);
    } catch (analysisError) {
      setPhotoError(analysisError instanceof Error ? analysisError.message : 'Could not analyze photo.');
    } finally {
      setPhotoAnalyzing(false);
    }
  };

  const upsertFoodIfNeeded = ensureFoodRow;

  const saveNutritionEntry = async (
    foodId: string,
    servingsCount: number,
    source = initialEntry?.source || 'manual',
    shouldComplete = true,
    retryEntryId?: string,
  ): Promise<boolean> => {
    setSaveError(null);
    const selectedGroup = orderedGroups.find((group) => group.id === groupId) || null;
    const fullPayload = buildEntryPayload({
      foodId,
      servings: servingsCount,
      source,
      entryDate,
      time: timeValue,
      group: selectedGroup,
    });

    try {
      await persistNutritionEntry(fullPayload, initialEntry?.id, entryWriteId(!!initialEntry, retryEntryId, pendingEntryId));
      // confirmed: the next save is a new entry (per item in the photo loop)
      if (!retryEntryId) pendingEntryId.clear();
      if (shouldComplete) onComplete();
      return true;
    } catch (error) {
      console.error('Error saving nutrition entry:', error);
      setSaveError('Could not save this entry. Your changes are still here. Please try again.');
      return false;
    }
  };

  const handleSaveFromSelectedFood = async (food: Food, servingsCount: number) => {
    if (onAddIngredients) {
      try { onAddIngredients([createMealIngredient(food, servingsCount)]); }
      catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not add ingredient.'); }
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const foodId = await upsertFoodIfNeeded(food);
      if (!foodId) {
        setSaveError('Could not save this entry. Your changes are still here. Please try again.');
        return;
      }
      const source = chosenFoodLogSource(food, selectedFoodMeta?.source === 'barcode' ? selectedFoodMeta.provider : null);
      await saveNutritionEntry(foodId, servingsCount, source);
    } catch (error) {
      console.error('Error saving nutrition entry:', error);
      setSaveError('Could not save this entry. Your changes are still here. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTrialItems = async (items: TrialFoodItem[], onItemSaved: (item: TrialFoodItem) => void, saveAsReusableMeal: boolean) => {
    if (onAddIngredients) {
      onAddIngredients(items.map((item) => createMealIngredient(trialIngredientFood(item), 1)));
      return;
    }
    if (!timeValue) throw new Error('Choose a logging time.');
    if (initialEntry && items.length !== 1) throw new Error('Keep one food when editing an existing entry.');
    for (const item of items) {
      const entryId = trialEntryIds.current.get(item) || crypto.randomUUID();
      trialEntryIds.current.set(item, entryId);
      const foodId = trialSavedFoods.current.get(item) || await upsertFoodIfNeeded(trialItemFood(item, saveAsReusableMeal));
      if (!foodId) throw new Error(`Could not save ${item.name}.`);
      trialSavedFoods.current.set(item, foodId);
      if (!await saveNutritionEntry(foodId, 1, trialLogSource(item), false, entryId)) throw new Error(`Could not log ${item.name}.`);
      onItemSaved(item);
    }
    onComplete();
  };

  const handleSavePhotoItems = async () => {
    if (photoItems.length === 0 || saving) return;
    if (photoItemsInvalid(photoItems)) {
      setPhotoError('Every photo item needs a name and an amount greater than zero.');
      return;
    }

    if (onAddIngredients) {
      try {
        onAddIngredients(photoItems.map((item) => createMealIngredient(item.groundedFood || {
          id: `photo-${item.id}`, user_id: null, name: item.name.trim(), ...photoItemTotals(item),
          serving_size: item.amountGrams, serving_unit: 'g', source: 'manual_entry', fdc_id: null,
        }, item.groundedFood ? item.amountGrams / Math.max(1, item.groundedFood.serving_size || 100) : 1)));
      } catch (error) { setPhotoError(error instanceof Error ? error.message : 'Could not add ingredients.'); }
      return;
    }
    setSaving(true);
    setPhotoError(null);
    try {
      await logPhotoItems({
        items: photoItems,
        // One entry for the whole plate. The components are summed exactly as
        // reviewed, so nothing is re-estimated; only the presentation changes.
        combine: combineAsOneMeal,
        summary: photoSummary,
        provider: photoProvider,
        ensureFood: upsertFoodIfNeeded,
        saveEntry: (foodId, servingsCount, source) => saveNutritionEntry(foodId, servingsCount, source, false),
        onFoodPersisted: (itemId, foodId) => setPhotoItems((current) => current.map((candidate) => candidate.id === itemId
          ? { ...candidate, persistedFoodId: foodId }
          : candidate)),
        onItemLogged: (itemId) => setPhotoItems((current) => current.filter((candidate) => candidate.id !== itemId)),
      });
      setPhotoItems([]);
      resetPhotoState();
      onComplete();
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Could not save the photo items.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSavedMeal = async () => {
    if (!selectedSavedMealId || updatingSavedMeal) return;

    const { name, calories, protein, carbs, fat } = manualMacroValues;
    if (!name) {
      setSavedMealError('Meal name is required to update.');
      return;
    }

    setUpdatingSavedMeal(true);
    clearSavedMealFeedback();

    try {
      const userId = await getSessionUserId();
      if (!userId) {
        setSavedMealError('Please sign in again to update saved meals.');
        return;
      }

      const { id: nextSavedMealId, retireFailed } = await replaceSavedMeal(
        userId,
        selectedSavedMealId,
        { name, calories, protein, carbs, fat },
      );

      if (!nextSavedMealId) {
        setSavedMealError('Could not update saved meal. Please try again.');
        return;
      }

      // the new meal row exists either way, so the form points at it
      setSelectedSavedMealId(nextSavedMealId);
      setSaveAsReusableMeal(false);
      if (retireFailed) {
        setSavedMealError(
          'Your edited meal was saved, but the original is still in saved meals. Remove the original when your connection is restored. Past logs are unchanged.',
        );
      } else {
        setSavedMealMessage('Saved meal updated for future logs.');
      }
      await fetchSavedMeals();
    } finally {
      setUpdatingSavedMeal(false);
    }
  };

  const handleManualSubmit = async () => {
    if (onAddIngredients) {
      try {
        onAddIngredients([createMealIngredient({ id: crypto.randomUUID(), user_id: null,
          ...manualMacroValues, serving_size: 1, serving_unit: 'serving', source: 'manual_entry', fdc_id: null,
        }, manualServingsValue)]);
      } catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not add ingredient.'); }
      return;
    }
    setSaving(true);
    clearSavedMealFeedback();
    setSaveError(null);
    try {
      const userId = await getSessionUserId();
      if (!userId) {
        console.error('No user found');
        setSaveError('Please sign in again to log food. Your changes are still here.');
        return;
      }

      const {
        name: normalizedName,
        calories,
        protein,
        carbs,
        fat,
      } = manualMacroValues;

      if (!normalizedName) {
        return;
      }

      const choice = await resolveManualFood({
        userId,
        values: { name: normalizedName, calories, protein, carbs, fat },
        selectedSavedMeal,
        saveAsReusable: saveAsReusableMeal,
        savedMeals,
        originalEntry: initialEntry?.food ? { food_id: initialEntry.food_id, food: initialEntry.food } : null,
        cachedOneOff: manualFoodRef.current,
      });
      if (choice.foodId === null) {
        if (choice.error === 'saved_meal') setSavedMealError('Could not save reusable meal. Please try again.');
        else setSaveError('Could not save this entry. Your changes are still here. Please try again.');
        return;
      }
      const resolvedFoodId = choice.foodId;
      if (choice.oneOff) manualFoodRef.current = choice.oneOff;
      if (choice.createdSavedMeal) {
        setSelectedSavedMealId(resolvedFoodId);
        await fetchSavedMeals();
      }

      if (pendingBarcodeBinding) {
        // bind the new product to the scanned code so the next scan of it
        // resolves from the owner's saved catalog without any provider
        const bound = await bindFoodToBarcode(userId, resolvedFoodId, pendingBarcodeBinding);
        if (bound) {
          setPendingBarcodeBinding(null);
          setMissedBarcode(null);
        }
      }

      const saved = await saveNutritionEntry(
        resolvedFoodId,
        parseFloat(servings || '1'),
        pendingBarcodeBinding ? 'barcode_saved' : initialEntry?.source || 'manual',
      );
      if (saved) manualFoodRef.current = null;
    } catch (error) {
      console.error('Error in manual submit:', error);
      setSaveError('Could not save this entry. Your changes are still here. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  /* ── Shared "when" row: date · time · destination ── */
  const whenRow = onAddIngredients ? (saveError && <p role="alert" className="fuel-note is-alert">{saveError}</p>) : (
    <div className="grid grid-cols-2 gap-3">
      {saveError && (
        <p role="alert" className="col-span-2 fuel-note is-alert">{saveError}</p>
      )}
      <p className="col-span-2 metal-eyebrow -mb-0.5">When</p>
      <DateField
        value={entryDate}
        onChange={(nextDate) => {
          setEntryDate(nextDate);
          if (format(nextDate, 'yyyy-MM-dd') !== selectedDateKey) setGroupId('');
        }}
        max={new Date()}
      />
      <TimeField value={timeValue} onChange={setTimeValue} />
      {entryUsesSelectedDayGroups ? (
        <SelectSheet
          className="col-span-2"
          title="Add to"
          value={groupId}
          onChange={setGroupId}
          options={[
            { value: '', label: 'Unassigned' },
            ...orderedGroups.map((group) => ({ value: group.id, label: nutritionGroupLabel(group, orderedGroups) })),
          ]}
        />
      ) : (
        <div className="col-span-2 fuel-ruled pt-3">
          <span className="metal-eyebrow">Add to</span>
          <span className="metal-row-title mt-1">Unassigned on {format(entryDate, 'MMM d')}</span>
          <span className="metal-row-detail">Meal groups shown here belong to {format(selectedDate, 'MMM d')}.</span>
        </div>
      )}
    </div>
  );

  // Every stage renders the AI logger in one keyed slot of its root, so opening
  // a food to review and going back keeps its photos, result and edits.
  const renderTrialLogger = (hidden: boolean) => foodAnalysisMode === 'gemini' && (trialVisited || mode === 'photo') ? (
    <div key="food-trial-logger" hidden={hidden}>
      <FoodTrialLogger key={trialKey} addingIngredients={!!onAddIngredients} whenRow={whenRow} prepareImage={fileToCompressedJpegBase64} onSave={handleSaveTrialItems} initialHint={trialInitialHint} editingEntry={!!initialEntry} onAnalysisBusyChange={setTrialAnalyzing} onDraftStateChange={setTrialDraftState} />
    </div>
  ) : null;

  // a late result waits on the Photo tab instead of taking over another tab
  if (mode === 'photo' && photoItems.length > 0) {
    const totalCalories = Math.round(photoItems.reduce((sum, item) => sum + photoItemTotals(item).calories, 0));
    return (
      <div className="fuel-logger">
        {renderTrialLogger(true)}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="metal-eyebrow"><Sparkles className="w-3 h-3" strokeWidth={1.75} /> Photo review</span>
            <span className="fuel-note">
              {providerName(photoProvider)}{photoModel ? ` · ${photoModel}` : ''}
            </span>
          </div>
          <h3 className="metal-title">{photoItems.length} food{photoItems.length === 1 ? '' : 's'} found</h3>
          {photoSummary && <p className="fuel-note mt-3">{photoSummary}</p>}
          <p className="fuel-note mt-2">Review every component and portion. USDA suggestions are never applied until you choose one.</p>
        </div>

        <div className={`grid gap-3 ${photoPreviews.side ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {(['top', 'side'] as const).map((angle) => photoPreviews[angle] ? (
            <figure key={angle}>
              <div className="fuel-photo">
                <img
                  src={photoPreviews[angle]}
                  alt={`${angle === 'top' ? 'Top' : 'Side'} meal view`}
                  className="aspect-[4/3]"
                />
              </div>
              <figcaption className="metal-eyebrow mt-2">{angle === 'top' ? 'Top view' : '45° view'}</figcaption>
            </figure>
          ) : null)}
        </div>

        <div>
          {photoItems.map((item, index) => {
            const totals = photoItemTotals(item);
            return (
              <div key={item.id} className="py-4 fuel-ruled">
                <div className="flex items-start gap-3">
                  <span className="fuel-note is-faint pt-3 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0 grid grid-cols-1 gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_6rem]">
                    <Input
                      label="Food"
                      value={item.name}
                      onChange={(event) => setPhotoItems((current) => current.map((candidate) => candidate.id === item.id
                        ? { ...candidate, name: event.target.value, groundedFood: null, persistedFoodId: undefined }
                        : candidate))}
                    />
                    <Input
                      label="Grams"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      value={formatMeasurementAmount(item.amountGrams)}
                      onChange={(event) => setPhotoItems((current) => current.map((candidate) => candidate.id === item.id
                        ? { ...candidate, amountGrams: Math.max(0, Number(event.target.value)), persistedFoodId: undefined }
                        : candidate))}
                    />
                  </div>
                  <button
                    type="button"
                    className="fuel-icon-btn is-quiet is-danger -mr-3 min-[420px]:mt-6"
                    onClick={() => setPhotoItems((current) => current.filter((candidate) => candidate.id !== item.id))}
                    aria-label={`Remove ${item.name}`}
                  >
                    <X strokeWidth={1.5} />
                  </button>
                </div>
                <div className="ml-8 mt-2 space-y-1">
                  <p className="fuel-note is-ink tabular-nums">
                    {Math.round(totals.calories)} kcal · P {Math.round(totals.protein)} · C {Math.round(totals.carbs)} · F {Math.round(totals.fat)}
                  </p>
                  <p className="fuel-note">
                    {photoItemStatus(item)}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </p>
                </div>
                {item.groundingCandidates.length > 0 && (
                  <div className="ml-8 mt-3">
                    <FormField label="Nutrition source">
                      <SelectSheet
                        title={`Match ${item.name}`}
                        value={item.groundedFood?.id || 'model-estimate'}
                        onChange={(value) => setPhotoItems((current) => current.map((candidate) => {
                          if (candidate.id !== item.id) return candidate;
                          if (value === 'model-estimate') return { ...candidate, groundedFood: null, persistedFoodId: undefined };
                          const match = candidate.groundingCandidates.find((food) => food.id === value) || null;
                          return { ...candidate, groundedFood: match, persistedFoodId: undefined };
                        }))}
                        options={[
                          {
                            value: 'model-estimate',
                            label: 'Keep model estimate',
                            description: `${Math.round(item.confidence * 100)}% visual confidence`,
                          },
                          ...item.groundingCandidates.map((food) => ({
                            value: food.id,
                            label: food.name,
                            description: `${Math.round(food.calories)} kcal per ${food.serving_label || `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}`}`,
                          })),
                        ]}
                      />
                    </FormField>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {whenRow}

        <div
          className="fuel-tray pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          style={{ bottom: 'calc(0px - max(1.25rem, env(safe-area-inset-bottom)))' }}
        >
          {photoError && (
            <p className="fuel-note is-alert mb-3" role="alert" aria-live="assertive">
              {photoError}
            </p>
          )}
          {!onAddIngredients && photoItems.length > 1 && (
            <label className="fuel-check">
              <input
                type="checkbox"
                checked={combineAsOneMeal}
                onChange={(event) => {
                  setCombineAsOneMeal(event.target.checked);
                  globalThis.localStorage?.setItem(COMBINE_MEAL_KEY, event.target.checked ? '1' : '0');
                }}
                className="sr-only"
              />
              <span className="fuel-check-box" aria-hidden>{combineAsOneMeal && <Check strokeWidth={3} />}</span>
              <span className="min-w-0">
                <span className="fuel-check-label">Log as one meal</span>
                <span className="fuel-check-detail">
                  {combineAsOneMeal
                    ? `Combines all ${photoItems.length} components into a single entry, with the description above attached.`
                    : `Logs all ${photoItems.length} components as separate entries.`}
                </span>
              </span>
            </label>
          )}
          <div className="fuel-tray-row">
            <div className="fuel-tray-figure">
              <span className="metal-eyebrow">Plate total</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="metal-num">{totalCalories}</span>
                <span className="metal-unit">kcal</span>
              </div>
            </div>
            <Button variant="ghost" className="shrink-0 !px-3" disabled={saving} onClick={resetPhotoState}>Retake</Button>
            <Button className="min-w-0 shrink-0 !px-4" size="lg" loading={saving} disabled={photoItems.length === 0 || !timeValue} onClick={() => void handleSavePhotoItems()}>
              {onAddIngredients ? 'Add ingredients' : combineAsOneMeal && photoItems.length > 1
                ? 'Log 1 meal'
                : `Log ${photoItems.length} item${photoItems.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════ Review & confirm stage ═══════════ */

  if (selectedFood) {
    return (
      <div className="fuel-logger">
        {renderTrialLogger(true)}
        {/* ── Food header + macro ledger ── */}
        <div>
          <span className="metal-eyebrow">{loggerMode === 'edit' ? 'Editing entry' : 'Selected'}</span>
          <h3 className="metal-title fuel-food-title">{selectedFood.name}</h3>

          {selectedFoodMeta?.source === 'photo' && (
            <div className="fuel-confidence">
              <div className="metal-rail-label">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" strokeWidth={1.75} />
                  Photo estimate
                </span>
                <b>{Math.round(selectedFoodMeta.confidence * 100)}%</b>
              </div>
              <div className="metal-rail-track" aria-hidden>
                <div className="metal-rail-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, selectedFoodMeta.confidence))})` }} />
              </div>
              {selectedFoodMeta.reasoning && (
                <p className="fuel-note mt-3">{selectedFoodMeta.reasoning}</p>
              )}
            </div>
          )}
          {selectedFoodMeta?.source === 'barcode' && (
            <p className="fuel-note mt-2">
              Barcode {selectedFoodMeta.barcode} ·{' '}
              {selectedFoodMeta.provider === 'open_food_facts' ? (
                <a
                  href="https://world.openfoodfacts.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Food Facts
                </a>
              ) : barcodeProviderLabel(selectedFoodMeta.provider)}
            </p>
          )}

          <div className="fuel-facts">
            {[
              { label: 'kcal', value: Math.round(selectedFood.calories) },
              { label: 'protein', value: Math.round(selectedFood.protein), unit: 'g' },
              { label: 'carbs', value: Math.round(selectedFood.carbs), unit: 'g' },
              { label: 'fat', value: Math.round(selectedFood.fat), unit: 'g' },
            ].map((cell) => (
              <div key={cell.label} className="fuel-fact">
                <span className="metal-eyebrow">{cell.label}</span>
                <span className="fuel-fact-value">
                  {cell.value}
                  {cell.unit && <small>{cell.unit}</small>}
                </span>
              </div>
            ))}
          </div>
          <p className="fuel-basis">
            {selectedFood.serving_label
              ? `per ${selectedFood.serving_label} (${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'g'})`
              : `per ${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'serving'}`}
          </p>
        </div>

        {/* ── Amount + unit ── */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Amount" error={selectedFoodMeasurementError ?? undefined}>
            <input
              type="number"
              inputMode="decimal"
              value={measurementAmount}
              onChange={(event) => setMeasurementAmount(event.target.value)}
              min="0.01"
              step="0.01"
              aria-label="Amount"
              aria-invalid={selectedFoodMeasurementError ? true : undefined}
              className="metal-input fuel-amount w-full px-3 text-[var(--metal-ink)]"
            />
          </FormField>
          <FormField label="Unit">
            <SelectSheet
              title="Unit"
              value={measurementUnit}
              onChange={(nextUnit) => {
                if (!selectedFood) {
                  setMeasurementUnit(nextUnit);
                  return;
                }

                const currentServings = measurementUnit === 'serving'
                  ? parseFloat(measurementAmount)
                  : computeServingsFromAmount({
                    amount: parseFloat(measurementAmount),
                    amountUnitRaw: measurementUnit,
                    servingSize: selectedFood.serving_size,
                    servingUnitRaw: selectedFood.serving_unit,
                  });

                setMeasurementUnit(nextUnit);

                if (currentServings === null || !Number.isFinite(currentServings) || currentServings <= 0) {
                  return;
                }

                if (nextUnit === 'serving') {
                  setMeasurementAmount(formatMeasurementAmount(currentServings));
                  return;
                }

                const nextAmount = computeAmountFromServings({
                  servings: currentServings,
                  targetUnitRaw: nextUnit,
                  servingSize: selectedFood.serving_size,
                  servingUnitRaw: selectedFood.serving_unit,
                });

                if (nextAmount !== null) {
                  setMeasurementAmount(formatMeasurementAmount(nextAmount));
                }
              }}
              options={selectedFoodCompatibleUnits.map((unit) => ({ value: unit, label: unit }))}
              className="min-h-12"
            />
          </FormField>
        </div>

        <ServingEntry
          key={JSON.stringify([selectedFood.id, selectedFood.serving_size, selectedFood.serving_unit, selectedFood.serving_label, measurementAmount, measurementUnit])}
          food={selectedFood}
          disabled={saving}
          onReviewChange={setServingReviewOpen}
          onApply={(amount) => {
            setMeasurementUnit('serving');
            setMeasurementAmount(String(amount));
          }}
        />

        {whenRow}

        {/* ── This entry — the one important figure ── */}
        <div className="fuel-figure fuel-ruled pt-4">
          <span className="metal-eyebrow">This entry</span>
          <div className="metal-big">
            <span className="metal-num">{selectedFoodTotalCalories}</span>
            <span className="metal-unit">kcal</span>
            <span className="fuel-figure-support">· {selectedFoodTotalProtein} g protein</span>
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              setSelectedFood(null);
              setSelectedFoodMeta(null);
              setMeasurementUnit('serving');
              setMeasurementAmount('1');
            }}
            disabled={saving}
          >
            Change food
          </Button>
          <Button
            className="flex-[1.6]"
            size="lg"
            onClick={() => {
              if (resolvedSelectedFoodServings === null) return;
              setServings(String(resolvedSelectedFoodServings));
              void handleSaveFromSelectedFood(selectedFood, resolvedSelectedFoodServings);
            }}
            loading={saving}
            disabled={servingReviewOpen || !timeValue || resolvedSelectedFoodServings === null}
          >
            {onAddIngredients ? 'Add ingredient' : loggerMode === 'edit' ? 'Save changes' : 'Log entry'}
          </Button>
        </div>
      </div>
    );
  }

  /* ═══════════ Capture stage ═══════════ */

  const foodMacros = (food: Pick<Food, 'calories' | 'protein' | 'carbs' | 'fat'>) =>
    `${Math.round(food.calories)} kcal · P ${Math.round(food.protein)} · C ${Math.round(food.carbs)} · F ${Math.round(food.fat)}`;

  return (
    <div className="fuel-logger">
      <SegmentedControl
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next !== 'saved') setManagingSavedMeals(false);
          if (next !== 'photo') setPhotoError(null);
          // barcode binding only survives the guided miss -> manual path
          if (next !== 'manual') setPendingBarcodeBinding(null);
        }}
        options={[
          { value: 'saved', label: 'Saved' },
          { value: 'search', label: 'USDA' },
          { value: 'barcode', label: 'Scan' },
          { value: 'manual', label: 'Manual' },
          {
            value: 'photo',
            label: foodAnalysisMode === 'gemini' ? 'AI' : photoResultWaiting ? (
              <span className="inline-flex items-center gap-1">
                Photo
                <span className="w-1 h-1 rounded-full bg-[var(--metal-red)]" aria-hidden />
                <span className="sr-only">, estimate ready</span>
              </span>
            ) : 'Photo',
          },
        ]}
        distribution="equal"
        size="sm"
      />

      {renderTrialLogger(mode !== 'photo')}

      {mode === 'saved' ? (
        <div className="fuel-stack">
          <div className="fuel-sheet-head">
            <span className="metal-eyebrow">
              {showSavedMealsLoading ? 'Loading' : `${savedMeals.length} saved`}
            </span>
            <div className="fuel-sheet-head-actions">
              <button
                type="button"
                className="metal-line-btn"
                onClick={handleAddSavedMeal}
              >
                <Plus strokeWidth={1.5} aria-hidden />
                Add
              </button>
              {savedMeals.length > 0 && (
                <button
                  type="button"
                  className="metal-line-btn"
                  onClick={() => {
                    clearSavedMealFeedback();
                    setManagingSavedMeals((current) => !current);
                  }}
                  aria-pressed={managingSavedMeals}
                >
                  {managingSavedMeals ? 'Done' : 'Edit'}
                </button>
              )}
            </div>
          </div>

          <div className="fuel-search">
            <Search strokeWidth={1.5} aria-hidden />
            <input
              type="text"
              placeholder="Find a saved food…"
              aria-label="Find a saved food"
              value={savedQuery}
              onChange={(event) => setSavedQuery(event.target.value)}
            />
          </div>

          {savedMealMessage && (
            <p className="fuel-note is-ink" role="status" aria-live="polite">
              {savedMealMessage}
            </p>
          )}
          {savedMealError && (
            <p className="fuel-note is-alert" role="alert">
              {savedMealError}
            </p>
          )}

          {showSavedMealsLoading ? (
            <div className="fuel-loading">
              <Loader2 className="animate-spin" />
              Loading saved foods…
            </div>
          ) : filteredSavedMeals.length > 0 ? (
            <div className="fuel-food-list">
              {filteredSavedMeals.map((meal) => (
                <div key={meal.id} className="fuel-food-row">
                  {managingSavedMeals ? (
                    <>
                      <div className="fuel-food-main">
                        <span className="fuel-food-text">
                          <span className="fuel-food-name">{meal.name}</span>
                          <span className="fuel-food-detail">{foodMacros(meal)}</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="fuel-icon-btn"
                        onClick={() => handleEditSavedMeal(meal)}
                        disabled={deletingSavedMealId === meal.id}
                        aria-label={`Edit saved meal ${meal.name}`}
                      >
                        <Pencil strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        className="fuel-icon-btn is-danger -mr-3"
                        onClick={() => void handleDeleteSavedMeal(meal)}
                        disabled={deletingSavedMealId === meal.id}
                        aria-label={`Delete saved meal ${meal.name}`}
                      >
                        {deletingSavedMealId === meal.id
                          ? <Loader2 className="animate-spin" />
                          : <Trash2 strokeWidth={1.5} />}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="fuel-food-main"
                      onClick={() => handleLogSavedMeal(meal)}
                      aria-label={`Log ${meal.name}`}
                    >
                      <span className="fuel-food-text">
                        <span className="fuel-food-name">{meal.name}</span>
                        <span className="fuel-food-detail">{foodMacros(meal)}</span>
                      </span>
                      <span className="fuel-food-glyph"><Plus strokeWidth={1.5} /></span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="fuel-empty">
              <p className="metal-row-title">{savedQuery ? 'No saved foods match' : 'No saved foods yet'}</p>
              <p className="fuel-note mt-1">Create one in Manual and choose “Save as reusable meal.”</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setMode('manual')}>
                Add manually
              </Button>
            </div>
          )}
        </div>
      ) : mode === 'search' ? (
        <div className="fuel-stack">
          <div className="fuel-search">
            <Search strokeWidth={1.5} aria-hidden />
            <input
              type="text"
              placeholder="Search the USDA database…"
              aria-label="Search the USDA database"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUSDA(searchQuery)}
            />
            <button
              type="button"
              className="fuel-icon-btn is-ink -mr-1"
              onClick={() => searchUSDA(searchQuery)}
              disabled={loading}
              aria-label="Search"
            >
              {loading ? <Loader2 className="animate-spin" /> : <ArrowRight strokeWidth={1.5} />}
            </button>
          </div>

          {!loading && searchStatus === 'short' && <p className="fuel-note">Type at least 2 characters.</p>}
          {!loading && searchStatus === 'empty' && <p className="fuel-note">No USDA matches.</p>}
          {!loading && searchStatus === 'error' && (
            <div>
              <p className="fuel-note is-alert" role="alert">Search failed. Check your connection and try again.</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => void searchUSDA(searchQuery)}>
                Retry
              </Button>
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="fuel-food-list">
              {searchResults.map((food, index) => (
                <motion.button
                  key={food.fdc_id || food.id}
                  type="button"
                  className="fuel-food-main fuel-food-row w-full"
                  onClick={async () => {
                    if (saving || loadingFoodId) return;

                    setSelectedFoodMeta(null);

                    let resolvedFood = food;
                    if (food.source === 'usda' && food.fdc_id && !food.serving_label) {
                      setLoadingFoodId(food.fdc_id);
                      try {
                        resolvedFood = await withUsdaPortion(food);
                      } finally {
                        setLoadingFoodId(null);
                      }
                    }

                    setSelectedFood(resolvedFood);
                    setMeasurementUnit('serving');

                    const defaultServings = 1;
                    setServings(String(defaultServings));
                    setMeasurementAmount(formatMeasurementAmount(defaultServings));
                  }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.25), ...springs.settle }}
                  disabled={saving || loadingFoodId !== null}
                >
                  <span className="fuel-food-text">
                    <span className="fuel-food-name">{food.name}</span>
                    <span className="fuel-food-detail">
                      {Math.round(food.calories)} kcal / {food.serving_label ?? `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}`}
                    </span>
                  </span>
                  <span className="fuel-food-glyph">
                    {loadingFoodId === food.fdc_id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Plus strokeWidth={1.5} />
                    )}
                  </span>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      ) : mode === 'barcode' ? (
        <Suspense fallback={<div className="fuel-loading is-tall"><Loader2 className="animate-spin" />Loading scanner…</div>}>
          <div className="fuel-stack">
            <BarcodeScanner onDetected={handleBarcodeDetected} />
            {missedBarcode && (
              <div className="fuel-ruled pt-4">
                <p className="metal-flag mt-0">
                  <span>
                    {onAddIngredients ? `No catalog match for barcode ${missedBarcode}. Enter the package nutrition to add this ingredient.` : `No catalog match for barcode ${missedBarcode}. Enter it from the package label once and it will be yours on every future scan.`}
                  </span>
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setPendingBarcodeBinding(onAddIngredients ? null : missedBarcode);
                    setSaveAsReusableMeal(true);
                    setSelectedSavedMealId(null);
                    setMode('manual');
                  }}
                >
                  {onAddIngredients ? 'Enter ingredient manually' : 'Create a saved product for this barcode'}
                </Button>
              </div>
            )}
            <p className="fuel-note">
              Product fallback data from{' '}
              <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">
                Open Food Facts
              </a>{' '}
              under the{' '}
              <a href="https://world.openfoodfacts.org/terms-of-use" target="_blank" rel="noreferrer">
                ODbL
              </a>.
            </p>
          </div>
        </Suspense>
      ) : mode === 'manual' ? (
        <>
          <div className="fuel-ruled-bottom pb-1 -mt-2">
            <button
              type="button"
              className="fuel-disclosure"
              onClick={() => setShowFoodDescription((current) => !current)}
              aria-expanded={showFoodDescription}
            >
              <span className="min-w-0">
                <span className="fuel-disclosure-title">
                  <Sparkles strokeWidth={1.75} aria-hidden />
                  Describe with AI
                </span>
                <span className="fuel-disclosure-detail">Research a food and fill editable macros.</span>
              </span>
              <span className="fuel-disclosure-state">{showFoodDescription ? 'Close' : 'Open'}</span>
            </button>

            {showFoodDescription && (
              <div className="fuel-stack mt-2 pb-5">
                <FormField label="Food, portion, and preparation">
                  <textarea
                    value={foodDescription}
                    readOnly={foodDescriptionBusy}
                    onChange={(event) => {
                      setFoodDescription(event.target.value.slice(0, 1500));
                      setFoodDescriptionError(null);
                    }}
                    rows={4}
                    placeholder="e.g., One restaurant chicken burrito bowl with white rice, black beans, cheese, salsa, no guacamole"
                    className="metal-input w-full min-h-28 px-3.5 py-3 text-[1rem] text-[var(--metal-ink)] resize-y placeholder:text-[var(--metal-ink-3)]"
                  />
                </FormField>
                <p className="fuel-note">Include brand or restaurant, amount, raw/cooked state, sauces, oils, and excluded ingredients.</p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => void handleDescribeFood()}
                  loading={foodDescriptionBusy}
                  disabled={foodDescriptionBusy || (foodAnalysisMode === 'gemini' && (trialAnalyzing || trialDraftState.busy)) || foodDescription.trim().length < 5}
                >
                  {foodAnalysisMode === 'gemini' ? 'Review with Gemini' : 'Research & fill fields'}
                </Button>

                {foodDescriptionError && (
                  <p className="fuel-note is-alert" role="alert">
                    {foodDescriptionError}
                  </p>
                )}

                {foodDescriptionResult && (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="metal-eyebrow">{pendingDescribeFill ? 'Estimate ready' : 'Estimate filled below'}</span>
                      <span className="fuel-note tabular-nums">
                        {foodDescriptionResult.provider === 'anthropic' ? 'Claude' : 'OpenAI'} · {Math.round(foodDescriptionResult.confidence * 100)}%
                      </span>
                    </div>
                    <p className="fuel-note">{foodDescriptionResult.serving_description}</p>
                    {foodDescriptionResult.notes && <p className="fuel-note">{foodDescriptionResult.notes}</p>}
                    {foodDescriptionResult.sources.length > 0 && (
                      <p className="fuel-note">
                        Sources:{' '}
                        {foodDescriptionResult.sources.map((source, index) => (
                          <span key={source.url}>
                            {index > 0 ? ' · ' : ''}
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.title}
                            </a>
                          </span>
                        ))}
                      </p>
                    )}
                    {pendingDescribeFill ? (
                      <>
                        <p className="fuel-note">You changed the fields while this ran, so your entries were kept.</p>
                        <Button variant="secondary" size="sm" onClick={() => applyDescribeEstimate(foodDescriptionResult)}>
                          Fill fields with estimate
                        </Button>
                      </>
                    ) : (
                      <p className="fuel-note">Review every field. Logging will also add it to Saved; a package label should win if available.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <Input
            label="Food name"
            value={manualFood.name}
            onChange={(e) => {
              clearSavedMealFeedback();
              setManualFood({ ...manualFood, name: e.target.value });
            }}
            onFocus={() => setManualNameFocused(true)}
            onBlur={() => {
              window.setTimeout(() => setManualNameFocused(false), 120);
            }}
            placeholder="e.g., Chicken Breast"
          />

          {manualNameFocused && normalizeFoodName(manualFood.name).length >= 2 && (
            <div>
              <p className="metal-eyebrow mb-1">{showSavedMealsLoading ? 'Loading saved meals…' : 'Saved meals'}</p>
              {!showSavedMealsLoading && manualSuggestions.length > 0 ? (
                <div className="max-h-36 overflow-y-auto">
                  {manualSuggestions.map((meal) => (
                    <button
                      key={meal.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectSavedMeal(meal)}
                      className="fuel-food-main fuel-food-row is-compact w-full"
                    >
                      <span className="fuel-food-text">
                        <span className="fuel-food-name">{meal.name}</span>
                        <span className="fuel-food-detail">{foodMacros(meal)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : !showSavedMealsLoading ? (
                <p className="fuel-note">No saved meal matches yet.</p>
              ) : null}
            </div>
          )}

          {!onAddIngredients && selectedSavedMealId && (
            <p className="metal-eyebrow text-[var(--metal-ink)]">
              {isSelectedSavedMealMatch ? 'Using saved meal values' : 'Editing saved meal values'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            <Input
              label="Calories"
              type="number"
              inputMode="decimal"
              value={manualFood.calories}
              onChange={(e) => {
                clearSavedMealFeedback();
                setManualFood({ ...manualFood, calories: e.target.value });
              }}
              placeholder="0"
            />
            <Input
              label="Protein (g)"
              type="number"
              inputMode="decimal"
              value={manualFood.protein}
              onChange={(e) => {
                clearSavedMealFeedback();
                setManualFood({ ...manualFood, protein: e.target.value });
              }}
              placeholder="0"
            />
            <Input
              label="Carbs (g)"
              type="number"
              inputMode="decimal"
              value={manualFood.carbs}
              onChange={(e) => {
                clearSavedMealFeedback();
                setManualFood({ ...manualFood, carbs: e.target.value });
              }}
              placeholder="0"
            />
            <Input
              label="Fat (g)"
              type="number"
              inputMode="decimal"
              value={manualFood.fat}
              onChange={(e) => {
                clearSavedMealFeedback();
                setManualFood({ ...manualFood, fat: e.target.value });
              }}
              placeholder="0"
            />
          </div>

          <FormField label="Servings">
            <Stepper
              value={formatMeasurementAmount(manualServingsValue)}
              onDecrement={() => setServings(formatMeasurementAmount(Math.max(0.25, manualServingsValue - 0.25)))}
              onIncrement={() => setServings(formatMeasurementAmount(manualServingsValue + 0.25))}
              canDecrement={manualServingsValue > 0.25}
            />
          </FormField>

          {!onAddIngredients && !selectedSavedMealId && (
            <button
              type="button"
              role="checkbox"
              aria-checked={saveAsReusableMeal}
              onClick={() => setSaveAsReusableMeal(!saveAsReusableMeal)}
              className={`fuel-check -my-2 ${saveAsReusableMeal ? 'is-on' : ''}`}
            >
              <span className="fuel-check-box" aria-hidden>
                {saveAsReusableMeal && <Check strokeWidth={3} />}
              </span>
              <span className="fuel-check-label">Save as reusable meal</span>
            </button>
          )}

          {!onAddIngredients && selectedSavedMealId && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleUpdateSavedMeal}
              loading={updatingSavedMeal}
              disabled={saving || updatingSavedMeal || !timeValue || isSelectedSavedMealMatch}
            >
              Update saved meal
            </Button>
          )}

          {savedMealMessage && <p className="fuel-note is-ink">{savedMealMessage}</p>}
          {savedMealError && <p className="fuel-note is-alert">{savedMealError}</p>}

          {whenRow}

          <Button
            className="w-full"
            size="lg"
            onClick={handleManualSubmit}
            disabled={!manualFood.name || saving || !timeValue}
            loading={saving}
          >
            {onAddIngredients ? 'Add ingredient' : loggerMode === 'edit' ? 'Save changes' : 'Log entry'}
          </Button>
        </>
      ) : foodAnalysisMode === 'gemini' ? null : (
        <div className="fuel-stack is-loose">
          <input
            ref={topPhotoInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => handlePhotoSelect('top', event)}
            className="hidden"
          />
          <input
            ref={sidePhotoInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => handlePhotoSelect('side', event)}
            className="hidden"
          />

          <p className="fuel-note">
            Add at least one photo of your meal. A top-down shot estimates portions best, but any angle works — add both for the most accuracy.
          </p>

          {!photoPreviews.top ? (
            <div className="space-y-3">
              <div>
                <span className="fuel-step-label">01 · Recommended</span>
                <p className="fuel-step-title">Top view</p>
                <p className="fuel-note mt-0.5">Shows every component and how much of the plate it covers.</p>
              </div>
              <button
                type="button"
                onClick={() => topPhotoInputRef.current?.click()}
                className="fuel-photo-slot"
              >
                <Camera strokeWidth={1.5} aria-hidden />
                <span className="fuel-photo-slot-title">Add top photo</span>
                <span className="fuel-photo-slot-detail">Take one now or choose from your library</span>
              </button>
              {isPreviewActive() && !isAppSandboxActive() && (
                <Button variant="secondary" className="w-full" onClick={handleUsePreviewPhoto}>
                  Use preview plate
                </Button>
              )}
            </div>
          ) : (
            <div className="fuel-photo">
              <img src={photoPreviews.top} alt="Top view of meal" className="h-52" />
              {photoAnalyzing && (
                <div className="fuel-photo-cover">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--metal-red)]" />
                  <span>Reading the plate…</span>
                </div>
              )}
              {!photoAnalyzing && (
                <button
                  ref={litRetakeRef}
                  type="button"
                  onClick={() => handleRetakePhoto('top')}
                  className="fuel-photo-action"
                >
                  <RefreshCw strokeWidth={1.75} aria-hidden />
                  Retake
                </button>
              )}
            </div>
          )}

          <div className="pt-5 fuel-ruled space-y-3">
            <div>
              <span className="fuel-step-label">02 · Recommended</span>
              <p className="fuel-step-title">45° side view</p>
              <p className="fuel-note mt-0.5">Adds height and depth, which improves portion estimates.</p>
            </div>
            {photoPreviews.side ? (
              <div className="fuel-photo">
                <img src={photoPreviews.side} alt="45 degree view of meal" className="h-44" />
                {photoAnalyzing && (
                  <div className="fuel-photo-cover" aria-hidden="true" />
                )}
                {!photoAnalyzing && (
                  <button
                    ref={litRetakeRef}
                    type="button"
                    onClick={() => handleRetakePhoto('side')}
                    className="fuel-photo-action"
                  >
                    <RefreshCw strokeWidth={1.75} aria-hidden />
                    Retake
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => sidePhotoInputRef.current?.click()}
                disabled={photoAnalyzing}
                className="fuel-photo-slot is-row"
              >
                <ImagePlus strokeWidth={1.5} aria-hidden />
                <span>
                  <span className="fuel-photo-slot-title block">Add side photo</span>
                  <span className="fuel-photo-slot-detail block mt-0.5">Same plate, about 45° above the table</span>
                </span>
              </button>
            )}
          </div>

          <Input
            label="Plate diameter (cm, optional)"
            type="number"
            inputMode="decimal"
            min="1"
            max="100"
            value={photoPlateDiameter}
            readOnly={photoAnalyzing}
            onChange={(event) => setPhotoPlateDiameter(event.target.value)}
            placeholder="e.g., 27"
          />

          <Input
            label="Oils, sauces, dressings, hidden ingredients"
            value={photoIngredients}
            readOnly={photoAnalyzing}
            onChange={(event) => setPhotoIngredients(event.target.value)}
            placeholder="e.g., 1 tbsp olive oil, sauce on side, or none"
          />

          <Input
            label="Extra details (optional)"
            value={photoHint}
            readOnly={photoAnalyzing}
            onChange={(e) => setPhotoHint(e.target.value)}
            placeholder="e.g., 27 cm plate, extra olive oil"
          />

          <p className="fuel-note">
            Shoot in good light. A measured plate or printed 5 cm marker on the food plane is useful; unmeasured utensils are not. You will confirm every detected item before logging.
          </p>

          {photoError && <p className="fuel-note is-alert">{photoError}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={handleAnalyzePhoto}
            loading={photoAnalyzing}
            disabled={(!photoFiles.top && !photoFiles.side) || photoAnalyzing || saving}
          >
            {!photoAnalyzing && <Sparkles className="w-4 h-4" strokeWidth={1.75} />}
            {photoAnalyzing ? 'Analyzing…' : `Analyze ${photoFiles.top && photoFiles.side ? '2 photos' : 'photo'}`}
          </Button>
        </div>
      )}
    </div>
  );
}
