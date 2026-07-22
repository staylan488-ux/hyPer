import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, Loader2, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, DateField, FormField, Input, RailStrip, SegmentedControl, SelectSheet, Stepper, TimeField } from '@/components/shared';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import type { Food, NutritionGroup } from '@/types';
import { format, isToday } from 'date-fns';
import {
  buildLoggedAt,
  computeAmountFromServings,
  computeServingsFromAmount,
  getCompatibleMeasurementUnits,
  normalizeFoodName,
  numbersNearlyEqual,
  shouldDropColumn,
  toLocalTimeInput,
  type MeasurementUnit,
} from './foodLoggerUtils';
import { applyPortion, selectPortionFromDetail } from './usdaSearch';
import {
  analyzeFoodPhoto,
  getPhotoWorkerSettings,
  type PhotoAnalysisAngle,
  type PhotoAnalysisProvider,
} from '@/lib/photoAnalysis';
import { describeFoodWithAi, type FoodDescriptionResult } from '@/lib/foodDescription';
import { legacyMealTypeForGroup, nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { bindFoodToBarcode, findSavedFoodByBarcode } from '@/lib/savedBarcodeFoods';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import {
  fetchUsdaFoodDetailSecure,
  searchFatSecretByBarcodeSecure,
  searchOpenFoodFactsByBarcodeSecure,
  searchUsdaFoodByBarcodeSecure,
  searchUsdaFoodsSecure,
} from '@/lib/usdaClient';

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ANALYSIS_DATA_URL_CHARS = 2_800_000;
const MAX_IMAGE_DIMENSION = 2048;

const BarcodeScanner = lazy(() => import('./BarcodeScanner').then((module) => ({
  default: module.BarcodeScanner,
})));

function formatMacroInput(value: number): string {
  const rounded = Math.round((value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMeasurementAmount(value: number): string {
  if (!Number.isFinite(value)) return '';

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

interface PhotoReviewItem {
  id: string;
  name: string;
  searchQuery: string;
  amountGrams: number;
  modelAmountGrams: number;
  modelCalories: number;
  modelProtein: number;
  modelCarbs: number;
  modelFat: number;
  confidence: number;
  notes: string;
  groundedFood: Food | null;
  groundingCandidates: Food[];
  persistedFoodId?: string;
}

type PhotoFiles = Partial<Record<PhotoAnalysisAngle, File>>;
type PhotoPreviews = Partial<Record<PhotoAnalysisAngle, string>>;

type SelectedFoodMeta = {
  source: 'photo';
  confidence: number;
  reasoning?: string;
} | {
  source: 'barcode';
  barcode: string;
  provider: 'usda' | 'open_food_facts' | 'saved' | 'fatsecret';
};

interface EditableNutritionEntry {
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
  } | null;
}

interface FoodLoggerProps {
  selectedDate: Date;
  onComplete: () => void;
  initialEntry?: EditableNutritionEntry | null;
  groups?: NutritionGroup[];
}

export function FoodLogger({ selectedDate, onComplete, initialEntry = null, groups = [] }: FoodLoggerProps) {
  const initialLogDate = useMemo(() => {
    if (initialEntry?.date) {
      const parsed = new Date(`${initialEntry.date}T12:00:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return new Date(selectedDate);
  }, [initialEntry?.date, selectedDate]);

  const [mode, setMode] = useState<'saved' | 'search' | 'barcode' | 'manual' | 'photo'>(initialEntry ? 'manual' : 'saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFoodId, setLoadingFoodId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [servings, setServings] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementAmount, setMeasurementAmount] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>('serving');
  const [saving, setSaving] = useState(false);
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
  const [savedMeals, setSavedMeals] = useState<Food[]>([]);
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
  const [photoHint, setPhotoHint] = useState('');
  const [photoPlateDiameter, setPhotoPlateDiameter] = useState('');
  const [photoIngredients, setPhotoIngredients] = useState('');
  const [photoFiles, setPhotoFiles] = useState<PhotoFiles>({});
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreviews>({});
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoItems, setPhotoItems] = useState<PhotoReviewItem[]>([]);
  const [photoProvider, setPhotoProvider] = useState<PhotoAnalysisProvider>('openai');
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

  const manualNameQuery = useMemo(() => normalizeFoodName(manualFood.name), [manualFood.name]);
  const manualSuggestions = useMemo(() => {
    if (manualNameQuery.length < 2) return [];

    const startsWithMatches = savedMeals.filter((meal) =>
      normalizeFoodName(meal.name).startsWith(manualNameQuery)
    );
    const containsMatches = savedMeals.filter((meal) => {
      const normalized = normalizeFoodName(meal.name);
      return !normalized.startsWith(manualNameQuery) && normalized.includes(manualNameQuery);
    });

    return [...startsWithMatches, ...containsMatches].slice(0, 6);
  }, [manualNameQuery, savedMeals]);
  const filteredSavedMeals = useMemo(() => {
    const query = normalizeFoodName(savedQuery);
    if (!query) return savedMeals;
    return savedMeals.filter((meal) => normalizeFoodName(meal.name).includes(query));
  }, [savedMeals, savedQuery]);
  const selectedSavedMeal = useMemo(
    () => (selectedSavedMealId ? savedMeals.find((meal) => meal.id === selectedSavedMealId) || null : null),
    [savedMeals, selectedSavedMealId]
  );
  const searchUSDA = async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    const foods = await searchUsdaFoodsSecure(query);
    setSearchResults(foods);
    setLoading(false);
  };

  const handleBarcodeDetected = useCallback(async (barcode: string): Promise<boolean> => {
    let food: Food | null = null;
    let provider: 'usda' | 'open_food_facts' | 'saved' | 'fatsecret' = 'saved';

    // owner catalog first: a previously scanned or label-captured product
    // resolves locally before any external provider is asked
    food = await findSavedFoodByBarcode(barcode);

    // FatSecret next when configured — curated coverage ahead of the free
    // sources; returns null (skip) when unconfigured or unknown
    if (!food) {
      provider = 'fatsecret';
      try {
        food = await searchFatSecretByBarcodeSecure(barcode);
      } catch {
        // fall through to the free providers on any FatSecret error
      }
    }

    if (!food) {
      provider = 'usda';
      try {
        food = await searchUsdaFoodByBarcodeSecure(barcode);
      } catch {
        // A second independent product source can still satisfy the scan.
      }
    }

    if (!food) {
      provider = 'open_food_facts';
      try {
        food = await searchOpenFoodFactsByBarcodeSecure(barcode);
      } catch {
        // A transient error must still reach the miss path below (create a
        // personal product), like the FatSecret and USDA legs above.
      }
    }
    if (!food) {
      // remember the code so manual entry can create a personal product
      // bound to it — the next scan then resolves from the saved catalog
      setMissedBarcode(barcode);
      return false;
    }
    setMissedBarcode(null);

    if (food.fdc_id && !food.serving_label) {
      const detail = await fetchUsdaFoodDetailSecure(food.fdc_id);
      const portion = selectPortionFromDetail(detail);
      if (portion) food = applyPortion(food, portion);
    }

    setSelectedFoodMeta({ source: 'barcode', barcode, provider });
    setSelectedFood(food);
    setMeasurementUnit('serving');
    setServings('1');
    setMeasurementAmount('1');
    return true;
  }, []);

  const handleDescribeFood = async () => {
    if (foodDescriptionBusy) return;

    setFoodDescriptionBusy(true);
    setFoodDescriptionError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Your session expired. Please sign out and sign back in.');

      const result = await describeFoodWithAi({
        description: foodDescription,
        accessToken,
        settings: getPhotoWorkerSettings(),
      });
      setFoodDescriptionResult(result);
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
    } catch (error) {
      setFoodDescriptionError(error instanceof Error ? error.message : 'Could not research this food.');
    } finally {
      setFoodDescriptionBusy(false);
    }
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

  const insertFoodRecord = async (
    userId: string,
    values: { name: string; calories: number; protein: number; carbs: number; fat: number },
    source: 'saved_meal' | 'manual_entry'
  ) => {
    const payload = {
      user_id: userId,
      name: values.name,
      calories: values.calories,
      protein: values.protein,
      carbs: values.carbs,
      fat: values.fat,
      source,
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
      console.error('Error creating food record:', error);
      return null;
    }

    return data.id as string;
  };

  const isSelectedSavedMealMatch = useMemo(() => {
    if (!selectedSavedMeal) return false;

    const manualValues = manualMacroValues;

    return (
      normalizeFoodName(selectedSavedMeal.name) === normalizeFoodName(manualValues.name)
      && numbersNearlyEqual(selectedSavedMeal.calories, manualValues.calories)
      && numbersNearlyEqual(selectedSavedMeal.protein, manualValues.protein)
      && numbersNearlyEqual(selectedSavedMeal.carbs, manualValues.carbs)
      && numbersNearlyEqual(selectedSavedMeal.fat, manualValues.fat)
    );
  }, [manualMacroValues, selectedSavedMeal]);

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
        .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id')
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom'])
        .order('created_at', { ascending: false })
        .limit(120);

      if (error) {
        console.error('Error fetching saved meals:', error);
        setSavedMeals([]);
        return;
      }

      const uniqueMealsByName = new Map<string, Food>();

      for (const meal of data || []) {
        const normalizedName = normalizeFoodName(meal.name || '');
        if (!normalizedName || uniqueMealsByName.has(normalizedName)) continue;

        uniqueMealsByName.set(normalizedName, {
          id: meal.id,
          user_id: meal.user_id,
          name: meal.name,
          calories: Number(meal.calories) || 0,
          protein: Number(meal.protein) || 0,
          carbs: Number(meal.carbs) || 0,
          fat: Number(meal.fat) || 0,
          serving_size: Number(meal.serving_size) || 1,
          serving_unit: meal.serving_unit || 'serving',
          source: 'custom',
          fdc_id: meal.fdc_id,
        });
      }

      setSavedMeals(Array.from(uniqueMealsByName.values()));
    } finally {
      setLoadingSavedMeals(false);
    }
  }, []);

  const handleSelectSavedMeal = (meal: Food) => {
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
    setSelectedFoodMeta(null);
    setSelectedFood(meal);
    setMeasurementUnit('serving');
    setMeasurementAmount('1');
    setServings('1');
  };

  const handleEditSavedMeal = (meal: Food) => {
    handleSelectSavedMeal(meal);
    setManagingSavedMeals(false);
    setMode('manual');
  };

  const handleAddSavedMeal = () => {
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedMealError('Please sign in again to delete saved meals.');
        return;
      }

      const { error } = await supabase
        .from('foods')
        .update({ source: 'manual_entry' })
        .eq('id', meal.id)
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom']);

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

          while (dataUrl.length > MAX_ANALYSIS_DATA_URL_CHARS && quality > 0.45) {
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
      const context = [
        photoPlateDiameter.trim() ? `Measured plate diameter: ${photoPlateDiameter.trim()} cm.` : 'Plate diameter not measured.',
        photoIngredients.trim() ? `Oils, sauces, dressings, or hidden ingredients: ${photoIngredients.trim()}.` : 'Oils, sauces, dressings, or hidden ingredients were not specified.',
        photoHint.trim() ? `Other details: ${photoHint.trim()}.` : '',
      ].filter(Boolean).join(' ');
      const result = await analyzeFoodPhoto({
        images: preparedImages,
        hint: context,
        accessToken,
        settings,
      });

      const grounded = await Promise.all(result.items.map(async (item, index): Promise<PhotoReviewItem> => {
        let matches: Food[] = [];
        try {
          matches = await searchUsdaFoodsSecure(item.search_query);
        } catch {
          // USDA grounding is best-effort; model estimates remain editable/loggable.
        }
        const candidates = matches
          // Review amounts are grams. Volume matches need density data we do
          // not have, so offering an ml basis would silently assume 1 g/ml.
          .filter((food) => food.serving_unit.toLowerCase() === 'g')
          .slice(0, 3);
        return {
          id: `photo-${Date.now()}-${index}`,
          name: item.name,
          searchQuery: item.search_query,
          amountGrams: item.estimated_grams,
          modelAmountGrams: item.estimated_grams,
          modelCalories: item.calories,
          modelProtein: item.protein_g,
          modelCarbs: item.carbs_g,
          modelFat: item.fat_g,
          confidence: item.confidence,
          notes: item.notes,
          groundedFood: null,
          groundingCandidates: candidates,
        };
      }));

      setPhotoProvider(result.provider);
      setPhotoModel(result.model);
      setPhotoSummary(result.summary);
      setPhotoItems(grounded);
    } catch (analysisError) {
      setPhotoError(analysisError instanceof Error ? analysisError.message : 'Could not analyze photo.');
    } finally {
      setPhotoAnalyzing(false);
    }
  };

  const upsertFoodIfNeeded = async (food: Food): Promise<string | null> => {
    let foodId = food.id;

    if (food.source === 'usda' && food.fdc_id) {
      const servingSize = food.serving_size || 100;
      const servingUnit = food.serving_unit || 'g';

      // Match on the serving basis too: a food cached before portions existed has a
      // 100 g basis and is tied to historical logs. Reuse only a same-basis row;
      // otherwise insert a new one. Never mutate existing rows.
      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('fdc_id', food.fdc_id)
        .eq('serving_size', servingSize)
        .eq('serving_unit', servingUnit)
        .limit(1)
        .maybeSingle();

      if (lookupError) {
        console.error('Error looking up food:', lookupError);
      }

      if (existingFood) {
        foodId = existingFood.id;
      } else {
        const { data: newFood, error: insertError } = await supabase
          .from('foods')
          .insert({
            name: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            serving_size: servingSize,
            serving_unit: servingUnit,
            source: 'usda',
            fdc_id: food.fdc_id,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error('Error creating food:', insertError);
          return null;
        }

        if (newFood) {
          foodId = newFood.id;
        }
      }
    }

    if (food.source === 'open_food_facts' && food.external_id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found while saving barcode food');
        return null;
      }

      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('user_id', user.id)
        .eq('external_source', 'open_food_facts')
        .eq('external_id', food.external_id)
        .limit(1)
        .maybeSingle();

      if (lookupError) console.error('Error looking up Open Food Facts food:', lookupError);
      if (existingFood) return existingFood.id;

      const { data: newFood, error: insertError } = await supabase
        .from('foods')
        .insert({
          user_id: user.id,
          name: food.name,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          serving_size: food.serving_size || 1,
          serving_unit: food.serving_unit || 'serving',
          source: 'open_food_facts',
          fdc_id: null,
          external_source: 'open_food_facts',
          external_id: food.external_id,
        })
        .select('id')
        .single();

      if (insertError || !newFood) {
        console.error('Error creating Open Food Facts food:', insertError);
        return null;
      }
      foodId = newFood.id;
    }

    if (food.source === 'fatsecret' && food.external_id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found while saving barcode food');
        return null;
      }

      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('user_id', user.id)
        .eq('external_source', 'fatsecret')
        .eq('external_id', food.external_id)
        .limit(1)
        .maybeSingle();

      if (lookupError) console.error('Error looking up FatSecret food:', lookupError);
      if (existingFood) return existingFood.id;

      const { data: newFood, error: insertError } = await supabase
        .from('foods')
        .insert({
          user_id: user.id,
          name: food.name,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          serving_size: food.serving_size || 1,
          serving_unit: food.serving_unit || 'serving',
          source: 'fatsecret',
          fdc_id: null,
          external_source: 'fatsecret',
          external_id: food.external_id,
        })
        .select('id')
        .single();

      if (insertError || !newFood) {
        console.error('Error creating FatSecret food:', insertError);
        return null;
      }
      foodId = newFood.id;
    }

    if (food.source === 'custom') {
      const hasTemporaryId = !food.id || food.id.startsWith('photo-');

      if (!hasTemporaryId) {
        const { data: existingCustomFood, error: customLookupError } = await supabase
          .from('foods')
          .select('id')
          .eq('id', food.id)
          .maybeSingle();

        if (customLookupError) {
          console.error('Error looking up custom food:', customLookupError);
        }

        if (existingCustomFood) {
          return existingCustomFood.id;
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found while creating custom food');
        return null;
      }

      const customPayload = {
        user_id: user.id,
        name: food.name,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        source: 'custom' as const,
      };

      let { data: newCustomFood, error: customInsertError } = await supabase
        .from('foods')
        .insert({
          ...customPayload,
          serving_size: food.serving_size || 1,
          serving_unit: food.serving_unit || 'serving',
        })
        .select('id')
        .single();

      if (customInsertError && shouldDropColumn(customInsertError, 'serving_size')) {
        ({ data: newCustomFood, error: customInsertError } = await supabase
          .from('foods')
          .insert(customPayload)
          .select('id')
          .single());
      }

      if (customInsertError || !newCustomFood) {
        console.error('Error creating custom food:', customInsertError);
        return null;
      }

      foodId = newCustomFood.id;
    }

    return foodId;
  };

  const saveNutritionEntry = async (
    foodId: string,
    servingsCount: number,
    source = initialEntry?.source || 'manual',
    shouldComplete = true,
  ): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No user found');
      return false;
    }

    const loggedAt = buildLoggedAt(entryDate, timeValue);
    const day = format(entryDate, 'yyyy-MM-dd');
    const selectedGroup = orderedGroups.find((group) => group.id === groupId) || null;

    const fullPayload = {
      food_id: foodId,
      servings: servingsCount,
      // Mirror the chosen group's legacy meal name (null for custom/Unassigned
      // groups). Do NOT fall back to the entry's old meal_type — that made the
      // tag impossible to clear and caused it to snap back to the old group.
      meal_type: legacyMealTypeForGroup(selectedGroup),
      group_id: groupId || null,
      source,
      date: day,
      logged_at: loggedAt,
    };

    const legacyFullPayload = {
      ...fullPayload,
      group_id: undefined,
      source: undefined,
    };

    const loggedAtFallbackPayload = {
      ...legacyFullPayload,
      logged_at: undefined,
      created_at: loggedAt,
    };

    const mealAndLoggedFallbackPayload = {
      ...loggedAtFallbackPayload,
      meal_type: undefined,
    };

    const mealAndLoggedNoCreatedPayload = {
      ...legacyFullPayload,
      logged_at: undefined,
      meal_type: undefined,
    };

    const payloadAttempts = [
      fullPayload,
      legacyFullPayload,
      loggedAtFallbackPayload,
      mealAndLoggedFallbackPayload,
      mealAndLoggedNoCreatedPayload,
    ];

    let lastError: unknown = null;

    for (const payload of payloadAttempts) {
      const cleanPayload = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined)
      );

      if (initialEntry) {
        const { error } = await supabase
          .from('nutrition_logs')
          .update(cleanPayload)
          .eq('id', initialEntry.id)
          .eq('user_id', user.id);

        if (!error) {
          if (shouldComplete) onComplete();
          return true;
        }

        lastError = error;
        const shouldRetry =
          shouldDropColumn(error, 'logged_at')
          || shouldDropColumn(error, 'meal_type')
          || shouldDropColumn(error, 'created_at')
          || shouldDropColumn(error, 'group_id')
          || shouldDropColumn(error, 'source');
        if (!shouldRetry) {
          console.error('Error updating entry:', error);
          return false;
        }
      } else {
        const { error } = await supabase
          .from('nutrition_logs')
          .insert({ user_id: user.id, ...cleanPayload });

        if (!error) {
          if (shouldComplete) onComplete();
          return true;
        }

        lastError = error;
        const shouldRetry =
          shouldDropColumn(error, 'logged_at')
          || shouldDropColumn(error, 'meal_type')
          || shouldDropColumn(error, 'created_at')
          || shouldDropColumn(error, 'group_id')
          || shouldDropColumn(error, 'source');
        if (!shouldRetry) {
          console.error('Error logging food:', error);
          return false;
        }
      }
    }

    console.error('Error saving nutrition entry after retries:', lastError);
    return false;
  };

  const handleSaveFromSelectedFood = async (food: Food, servingsCount: number) => {
    setSaving(true);
    try {
      const foodId = await upsertFoodIfNeeded(food);
      if (!foodId) return;
      const source = selectedFoodMeta?.source === 'barcode'
        ? selectedFoodMeta.provider === 'open_food_facts'
          ? 'barcode_open_food_facts'
          : selectedFoodMeta.provider === 'saved' ? 'barcode_saved'
          : selectedFoodMeta.provider === 'fatsecret' ? 'barcode_fatsecret' : 'barcode'
        : food.source === 'usda' ? 'usda' : 'manual';
      await saveNutritionEntry(foodId, servingsCount, source);
    } catch (error) {
      console.error('Error saving nutrition entry:', error);
    } finally {
      setSaving(false);
    }
  };

  const photoItemTotals = (item: PhotoReviewItem) => {
    const basisGrams = item.groundedFood?.serving_size || item.modelAmountGrams;
    const factor = item.amountGrams / Math.max(1, basisGrams);
    return {
      calories: Math.round((item.groundedFood?.calories ?? item.modelCalories) * factor * 10) / 10,
      protein: Math.round((item.groundedFood?.protein ?? item.modelProtein) * factor * 10) / 10,
      carbs: Math.round((item.groundedFood?.carbs ?? item.modelCarbs) * factor * 10) / 10,
      fat: Math.round((item.groundedFood?.fat ?? item.modelFat) * factor * 10) / 10,
    };
  };

  const handleSavePhotoItems = async () => {
    if (photoItems.length === 0 || saving) return;
    if (photoItems.some((item) => !item.name.trim() || !Number.isFinite(item.amountGrams) || item.amountGrams <= 0)) {
      setPhotoError('Every photo item needs a name and an amount greater than zero.');
      return;
    }

    setSaving(true);
    setPhotoError(null);
    let savedCount = 0;
    try {
      const logSource = photoProvider === 'anthropic' ? 'photo_anthropic' : 'photo_openai';
      for (const item of photoItems) {
        const totals = photoItemTotals(item);
        const food: Food = item.groundedFood || {
          id: item.persistedFoodId || `photo-${item.id}`,
          user_id: null,
          name: item.name.trim(),
          calories: totals.calories,
          protein: totals.protein,
          carbs: totals.carbs,
          fat: totals.fat,
          serving_size: item.amountGrams,
          serving_unit: 'g',
          source: 'custom',
          fdc_id: null,
        };
        const foodId = await upsertFoodIfNeeded(food);
        if (!foodId) throw new Error(`Could not save ${item.name}.`);
        setPhotoItems((current) => current.map((candidate) => candidate.id === item.id
          ? { ...candidate, persistedFoodId: foodId }
          : candidate));
        const servingsCount = item.groundedFood
          ? item.amountGrams / Math.max(1, item.groundedFood.serving_size || 100)
          : 1;
        const saved = await saveNutritionEntry(foodId, servingsCount, logSource, false);
        if (!saved) throw new Error(`Could not log ${item.name}.`);
        savedCount += 1;
        setPhotoItems((current) => current.filter((candidate) => candidate.id !== item.id));
      }
      resetPhotoState();
      onComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the photo items.';
      setPhotoError(savedCount > 0
        ? `${message} ${savedCount} already logged item${savedCount === 1 ? ' was' : 's were'} removed from this review. Retry only the remaining items.`
        : message);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSavedMealError('Please sign in again to update saved meals.');
        return;
      }

      const nextSavedMealId = await insertFoodRecord(
        user.id,
        { name, calories, protein, carbs, fat },
        'saved_meal'
      );

      if (!nextSavedMealId) {
        setSavedMealError('Could not update saved meal. Please try again.');
        return;
      }

      await supabase
        .from('foods')
        .update({ source: 'manual_entry' })
        .eq('id', selectedSavedMealId)
        .eq('user_id', user.id)
        .in('source', ['saved_meal', 'custom']);

      setSelectedSavedMealId(nextSavedMealId);
      setSaveAsReusableMeal(false);
      setSavedMealMessage('Saved meal updated for future logs.');
      await fetchSavedMeals();
    } finally {
      setUpdatingSavedMeal(false);
    }
  };

  const handleManualSubmit = async () => {
    setSaving(true);
    clearSavedMealFeedback();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
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

      let resolvedFoodId = isSelectedSavedMealMatch && selectedSavedMeal ? selectedSavedMeal.id : null;

      if (!resolvedFoodId && saveAsReusableMeal) {
        const matchingSavedMeal = savedMeals.find((meal) => (
          normalizeFoodName(meal.name) === normalizeFoodName(normalizedName)
          && numbersNearlyEqual(meal.calories, calories)
          && numbersNearlyEqual(meal.protein, protein)
          && numbersNearlyEqual(meal.carbs, carbs)
          && numbersNearlyEqual(meal.fat, fat)
        ));

        if (matchingSavedMeal) {
          resolvedFoodId = matchingSavedMeal.id;
        }
      }

      if (!resolvedFoodId && saveAsReusableMeal) {
        resolvedFoodId = await insertFoodRecord(
          user.id,
          { name: normalizedName, calories, protein, carbs, fat },
          'saved_meal'
        );

        if (!resolvedFoodId) {
          setSavedMealError('Could not save reusable meal. Please try again.');
          return;
        }

        setSelectedSavedMealId(resolvedFoodId);
        await fetchSavedMeals();
      }

      // Editing an entry without changing the food itself (e.g. only servings
      // or time) must reuse the original food row. Otherwise every edit inserts
      // an orphan manual_entry food and rebases the entry onto a 1-serving
      // basis, losing the original fdc_id / gram basis and saved-meal linkage.
      if (!resolvedFoodId && initialEntry?.food_id && initialEntry.food
        && normalizeFoodName(initialEntry.food.name) === normalizeFoodName(normalizedName)
        && numbersNearlyEqual(initialEntry.food.calories, calories)
        && numbersNearlyEqual(initialEntry.food.protein, protein)
        && numbersNearlyEqual(initialEntry.food.carbs, carbs)
        && numbersNearlyEqual(initialEntry.food.fat, fat)) {
        resolvedFoodId = initialEntry.food_id;
      }

      if (!resolvedFoodId) {
        resolvedFoodId = await insertFoodRecord(
          user.id,
          { name: normalizedName, calories, protein, carbs, fat },
          'manual_entry'
        );

        if (!resolvedFoodId) {
          console.error('Error creating one-off manual food entry');
          return;
        }
      }

      if (!resolvedFoodId) {
        return;
      }

      if (pendingBarcodeBinding) {
        // bind the new product to the scanned code so the next scan of it
        // resolves from the owner's saved catalog without any provider
        const bound = await bindFoodToBarcode(user.id, resolvedFoodId, pendingBarcodeBinding);
        if (bound) {
          setPendingBarcodeBinding(null);
          setMissedBarcode(null);
        }
      }

      await saveNutritionEntry(
        resolvedFoodId,
        parseFloat(servings || '1'),
        pendingBarcodeBinding ? 'barcode_saved' : initialEntry?.source || 'manual',
      );
    } catch (error) {
      console.error('Error in manual submit:', error);
    } finally {
      setSaving(false);
    }
  };

  /* ── Shared "when" row: date · time · destination ── */
  const whenRow = (
    <div className="grid grid-cols-2 gap-3">
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
        <div className="col-span-2 border-t border-[var(--color-border)] pt-3">
          <span className="t-label-sm block">Add to</span>
          <span className="t-heading block mt-1">Unassigned on {format(entryDate, 'MMM d')}</span>
          <span className="t-caption block mt-1">Meal groups shown here belong to {format(selectedDate, 'MMM d')}.</span>
        </div>
      )}
    </div>
  );

  if (photoItems.length > 0) {
    const totalCalories = Math.round(photoItems.reduce((sum, item) => sum + photoItemTotals(item).calories, 0));
    return (
      <div className="space-y-6 pt-1">
        <div>
          <div className="flex flex-col gap-1 min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:justify-between">
            <span className="t-label flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Photo review</span>
            <span className="t-data-sm text-[var(--color-muted)]">
              {photoProvider === 'anthropic' ? 'Claude' : 'OpenAI'}{photoModel ? ` · ${photoModel}` : ''}
            </span>
          </div>
          <h3 className="t-title mt-3 pb-4 border-b border-[var(--color-text)]">{photoItems.length} food{photoItems.length === 1 ? '' : 's'} found</h3>
          {photoSummary && <p className="t-caption mt-4">{photoSummary}</p>}
          <p className="t-caption mt-2">Review every component and portion. USDA suggestions are never applied until you choose one.</p>
        </div>

        <div className={`grid gap-3 ${photoPreviews.side ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {(['top', 'side'] as const).map((angle) => photoPreviews[angle] ? (
            <figure key={angle}>
              <img
                src={photoPreviews[angle]}
                alt={`${angle === 'top' ? 'Top' : 'Side'} meal view`}
                className="w-full aspect-[4/3] object-cover hairline-strong"
              />
              <figcaption className="t-label-sm mt-2">{angle === 'top' ? 'Top view' : '45° view'}</figcaption>
            </figure>
          ) : null)}
        </div>

        <div>
          {photoItems.map((item, index) => {
            const totals = photoItemTotals(item);
            return (
              <div key={item.id} className="py-4 border-t border-[var(--color-border)]">
                <div className="flex items-start gap-3">
                  <span className="t-data-sm text-[var(--color-muted)] pt-3">{String(index + 1).padStart(2, '0')}</span>
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
                    className="pressable flex items-center justify-center w-11 h-11 min-[420px]:mt-6 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    onClick={() => setPhotoItems((current) => current.filter((candidate) => candidate.id !== item.id))}
                    aria-label={`Remove ${item.name}`}
                  >
                    <X className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="ml-8 mt-2 space-y-1">
                  <p className="t-data-sm text-[var(--color-text-dim)]">
                    {Math.round(totals.calories)} kcal · P {Math.round(totals.protein)} · C {Math.round(totals.carbs)} · F {Math.round(totals.fat)}
                  </p>
                  <p className="t-caption text-[var(--color-muted)]">
                    {item.groundedFood
                      ? 'USDA confirmed'
                      : item.groundingCandidates.length > 0
                        ? 'Match not chosen'
                        : `${Math.round(item.confidence * 100)}% estimate`}
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
          className="sticky z-20 -mx-6 border-t border-[var(--color-border-strong)] bg-[var(--color-surface-1)] px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          style={{ bottom: 'calc(0px - max(1.25rem, env(safe-area-inset-bottom)))' }}
        >
          {photoError && (
            <p className="t-caption mb-3 text-[var(--color-accent)]" role="alert" aria-live="assertive">
              {photoError}
            </p>
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-[4.5rem] flex-1 border-l-2 border-[var(--color-accent)] pl-3">
              <span className="t-label-sm block mb-1">Plate total</span>
              <div className="flex items-baseline gap-1.5">
                <span className="number-medium text-[var(--color-text)]">{totalCalories}</span>
                <span className="[font-family:var(--font-display)] italic text-xs text-[var(--color-text-dim)]">kcal</span>
              </div>
            </div>
            <Button variant="ghost" className="shrink-0 !px-3" disabled={saving} onClick={resetPhotoState}>Retake</Button>
            <Button className="min-w-0 shrink-0 !px-4" size="lg" loading={saving} disabled={photoItems.length === 0 || !timeValue} onClick={() => void handleSavePhotoItems()}>
              Log {photoItems.length} item{photoItems.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════ Review & confirm stage ═══════════ */

  if (selectedFood) {
    return (
      <div className="space-y-7 pt-1 pb-2">
        {/* ── Food header + macro ledger ── */}
        <div>
          <span className="t-label-sm block mb-2">{loggerMode === 'edit' ? 'Editing entry' : 'Selected'}</span>
          <h3 className="t-title pb-4 border-b border-[var(--color-text)]">{selectedFood.name}</h3>

          {selectedFoodMeta?.source === 'photo' && (
            <div className="mt-5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="t-label flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" strokeWidth={1.75} />
                  Photo estimate
                </span>
                <span className="t-data-sm text-[var(--color-text-dim)]">{Math.round(selectedFoodMeta.confidence * 100)}%</span>
              </div>
              <RailStrip value={selectedFoodMeta.confidence} tone="chalk" size="sm" />
              {selectedFoodMeta.reasoning && (
                <p className="t-caption mt-3">{selectedFoodMeta.reasoning}</p>
              )}
            </div>
          )}
          {selectedFoodMeta?.source === 'barcode' && (
            <p className="t-label-sm text-[var(--color-text-dim)]">
              Barcode {selectedFoodMeta.barcode} ·{' '}
              {selectedFoodMeta.provider === 'open_food_facts' ? (
                <a
                  href="https://world.openfoodfacts.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Open Food Facts
                </a>
              ) : selectedFoodMeta.provider === 'saved' ? 'from your saved foods'
                : selectedFoodMeta.provider === 'fatsecret' ? 'FatSecret' : 'USDA branded record'}
            </p>
          )}

          <div className="grid grid-cols-4 gap-4 mt-6">
            {[
              { label: 'kcal', value: Math.round(selectedFood.calories) },
              { label: 'protein', value: Math.round(selectedFood.protein), unit: 'g' },
              { label: 'carbs', value: Math.round(selectedFood.carbs), unit: 'g' },
              { label: 'fat', value: Math.round(selectedFood.fat), unit: 'g' },
            ].map((cell) => (
              <div key={cell.label} className="border-t border-[var(--color-border)] pt-2.5">
                <span className="t-label-sm block mb-1.5">{cell.label}</span>
                <span className="flex items-baseline gap-0.5">
                  <span className="number-medium text-[var(--color-text)]">{cell.value}</span>
                  {cell.unit && (
                    <span className="[font-family:var(--font-display)] italic text-xs text-[var(--color-text-dim)]">{cell.unit}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="t-caption mt-3">
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
              className="well w-full min-h-12 px-3 text-center t-data-lg text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
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

        {whenRow}

        {/* ── This entry — the one important figure ── */}
        <div className="border-l-2 border-[var(--color-accent)] pl-5">
          <span className="t-label block mb-2">This entry</span>
          <div className="flex items-baseline gap-2">
            <span className="number-large text-[var(--color-text)]">{selectedFoodTotalCalories}</span>
            <span className="[font-family:var(--font-display)] italic text-[1rem] text-[var(--color-text-dim)]">kcal</span>
            <span className="t-data-sm text-[var(--color-muted)] ml-2">{selectedFoodTotalProtein}g protein</span>
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
            disabled={!timeValue || resolvedSelectedFoodServings === null}
          >
            {loggerMode === 'edit' ? 'Save changes' : 'Log entry'}
          </Button>
        </div>
      </div>
    );
  }

  /* ═══════════ Capture stage ═══════════ */

  return (
    <div className="space-y-6 pt-1 pb-2">
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
          { value: 'photo', label: 'Photo' },
        ]}
        distribution="equal"
        size="sm"
      />

      {mode === 'saved' ? (
        <div className="space-y-4">
          <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[var(--color-border)] pb-2">
            <span className="t-label-sm">
              {loadingSavedMeals ? 'Loading' : `${savedMeals.length} saved`}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="pressable min-h-11 px-3 t-label-sm text-[var(--color-muted)] hover:text-[var(--color-text)]"
                onClick={handleAddSavedMeal}
              >
                Add
              </button>
              {savedMeals.length > 0 && (
                <button
                  type="button"
                  className="pressable min-h-11 px-3 t-label-sm text-[var(--color-text)]"
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

          <div className="flex items-center gap-3 border-b border-[var(--color-border-strong)] pb-2">
            <Search className="w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={1.5} />
            <input
              type="text"
              placeholder="Find a saved food…"
              value={savedQuery}
              onChange={(event) => setSavedQuery(event.target.value)}
              className="flex-1 min-w-0 bg-transparent text-[1rem] text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
            />
          </div>

          {savedMealMessage && (
            <p className="border-l-2 border-[var(--color-text)] pl-4 t-caption text-[var(--color-text)]" role="status" aria-live="polite">
              {savedMealMessage}
            </p>
          )}
          {savedMealError && (
            <p className="border-l-2 border-[var(--color-accent)] pl-4 t-caption text-[var(--color-accent)]" role="alert">
              {savedMealError}
            </p>
          )}

          {loadingSavedMeals ? (
            <div className="flex items-center gap-2 py-6 t-caption">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading saved foods…
            </div>
          ) : filteredSavedMeals.length > 0 ? (
            <div className="max-h-64 w-full max-w-full overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y">
              {filteredSavedMeals.map((meal, index) => (
                <div key={meal.id} className="flex w-full max-w-full min-w-0 items-stretch overflow-hidden border-t border-[var(--color-border)]">
                  {managingSavedMeals ? (
                    <>
                      <div className="flex min-w-0 flex-1 items-baseline gap-3 py-3.5 pr-2">
                        <span className="t-data-sm w-6 shrink-0 pt-1 text-[var(--color-muted)]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="t-body break-words font-medium text-[var(--color-text)]">{meal.name}</p>
                          <p className="t-data-sm mt-0.5 break-words leading-5 text-[var(--color-muted)]">
                            {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="pressable flex w-11 shrink-0 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
                        onClick={() => handleEditSavedMeal(meal)}
                        disabled={deletingSavedMealId === meal.id}
                        aria-label={`Edit saved meal ${meal.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        className="pressable flex w-11 shrink-0 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
                        onClick={() => void handleDeleteSavedMeal(meal)}
                        disabled={deletingSavedMealId === meal.id}
                        aria-label={`Delete saved meal ${meal.name}`}
                      >
                        {deletingSavedMealId === meal.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="pressable group flex min-w-0 flex-1 items-baseline gap-3 py-3.5 text-left"
                      onClick={() => handleLogSavedMeal(meal)}
                      aria-label={`Log ${meal.name}`}
                    >
                      <span className="t-data-sm w-6 shrink-0 pt-1 text-[var(--color-muted)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="t-body break-words font-medium text-[var(--color-text)]">{meal.name}</p>
                        <p className="t-data-sm mt-0.5 break-words leading-5 text-[var(--color-muted)]">
                          {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                        </p>
                      </div>
                      <Plus className="h-3.5 w-3.5 shrink-0 self-center text-[var(--color-muted)]" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-7 border-t border-[var(--color-border)]">
              <p className="t-heading">{savedQuery ? 'No saved foods match' : 'No saved foods yet'}</p>
              <p className="t-caption mt-2">Create one in Manual and choose “Save as reusable meal.”</p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setMode('manual')}>
                Add manually
              </Button>
            </div>
          )}
        </div>
      ) : mode === 'search' ? (
        <>
          <div className="flex items-center gap-3 border-b border-[var(--color-border-strong)] pb-2">
            <Search className="w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={1.5} />
            <input
              type="text"
              placeholder="Search the USDA database…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUSDA(searchQuery)}
              className="flex-1 min-w-0 bg-transparent text-[1rem] text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
            />
            <button
              type="button"
              className="pressable flex items-center justify-center w-9 h-9 text-[var(--color-text)] disabled:opacity-40"
              onClick={() => searchUSDA(searchQuery)}
              disabled={loading}
              aria-label="Search"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" strokeWidth={1.75} />}
            </button>
          </div>

          <div className="max-h-56 md:max-h-64 overflow-y-auto overscroll-contain touch-pan-y">
            {searchResults.map((food, index) => (
              <motion.button
                key={food.fdc_id || food.id}
                type="button"
                className="pressable group w-full flex items-baseline gap-4 py-3.5 border-t border-[var(--color-border)] text-left"
                onClick={async () => {
                  if (saving || loadingFoodId) return;

                  setSelectedFoodMeta(null);

                  let resolvedFood = food;
                  if (food.source === 'usda' && food.fdc_id && !food.serving_label) {
                    setLoadingFoodId(food.fdc_id);
                    try {
                      const detail = await fetchUsdaFoodDetailSecure(food.fdc_id);
                      const portion = selectPortionFromDetail(detail);
                      if (portion) resolvedFood = applyPortion(food, portion);
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
                transition={{ delay: Math.min(index * 0.03, 0.25), ...springs.smooth }}
                disabled={saving || loadingFoodId !== null}
              >
                <span className="t-data-sm text-[var(--color-muted)] w-6 shrink-0 pt-1">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="t-body font-medium text-[var(--color-text)] truncate">{food.name}</p>
                  <p className="t-data-sm text-[var(--color-muted)] mt-0.5">
                    {Math.round(food.calories)} kcal / {food.serving_label ?? `${formatMeasurementAmount(food.serving_size || 100)} ${food.serving_unit || 'g'}`}
                  </p>
                </div>
                <span className="flex items-center justify-center w-8 h-8 shrink-0 self-center text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors">
                  {loadingFoodId === food.fdc_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                  )}
                </span>
              </motion.button>
            ))}
          </div>
        </>
      ) : mode === 'barcode' ? (
        <Suspense fallback={<div className="flex items-center gap-2 py-10 t-caption"><Loader2 className="w-4 h-4 animate-spin" />Loading scanner…</div>}>
          <div className="space-y-4">
            <BarcodeScanner onDetected={handleBarcodeDetected} />
            {missedBarcode && (
              <div className="border border-[var(--color-border)] p-4">
                <p className="t-caption">
                  No catalog match for barcode {missedBarcode}. Enter it from the
                  package label once and it will be yours on every future scan.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setPendingBarcodeBinding(missedBarcode);
                    setSaveAsReusableMeal(true);
                    setSelectedSavedMealId(null);
                    setMode('manual');
                  }}
                >
                  Create a saved product for this barcode
                </Button>
              </div>
            )}
            <p className="t-caption">
              Product fallback data from{' '}
              <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Open Food Facts
              </a>{' '}
              under the{' '}
              <a href="https://world.openfoodfacts.org/terms-of-use" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                ODbL
              </a>.
            </p>
          </div>
        </Suspense>
      ) : mode === 'manual' ? (
        <>
          <div className="border-b border-[var(--color-border)] pb-5">
            <button
              type="button"
              className="pressable flex w-full items-center justify-between gap-4 text-left"
              onClick={() => setShowFoodDescription((current) => !current)}
              aria-expanded={showFoodDescription}
            >
              <span>
                <span className="t-label flex items-center gap-2 text-[var(--color-text)]">
                  <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Describe with AI
                </span>
                <span className="t-caption block mt-1">Research a food and fill editable macros.</span>
              </span>
              <span className="t-data-sm text-[var(--color-muted)]">{showFoodDescription ? 'Close' : 'Open'}</span>
            </button>

            {showFoodDescription && (
              <div className="space-y-4 mt-4">
                <FormField label="Food, portion, and preparation">
                  <textarea
                    value={foodDescription}
                    onChange={(event) => {
                      setFoodDescription(event.target.value.slice(0, 1500));
                      setFoodDescriptionError(null);
                    }}
                    rows={4}
                    placeholder="e.g., One restaurant chicken burrito bowl with white rice, black beans, cheese, salsa, no guacamole"
                    className="well w-full min-h-28 px-3 py-3 text-[1rem] text-[var(--color-text)] outline-none resize-y placeholder:text-[var(--color-muted)]"
                  />
                </FormField>
                <p className="t-caption">Include brand or restaurant, amount, raw/cooked state, sauces, oils, and excluded ingredients.</p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => void handleDescribeFood()}
                  loading={foodDescriptionBusy}
                  disabled={foodDescriptionBusy || foodDescription.trim().length < 5}
                >
                  Research &amp; fill fields
                </Button>

                {foodDescriptionError && (
                  <p className="border-l-2 border-[var(--color-accent)] pl-4 t-caption text-[var(--color-accent)]" role="alert">
                    {foodDescriptionError}
                  </p>
                )}

                {foodDescriptionResult && (
                  <div className="border-l-2 border-[var(--color-text)] pl-4 space-y-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="t-label">Estimate filled below</span>
                      <span className="t-data-sm text-[var(--color-muted)]">
                        {foodDescriptionResult.provider === 'anthropic' ? 'Claude' : 'OpenAI'} · {Math.round(foodDescriptionResult.confidence * 100)}%
                      </span>
                    </div>
                    <p className="t-caption">{foodDescriptionResult.serving_description}</p>
                    {foodDescriptionResult.notes && <p className="t-caption">{foodDescriptionResult.notes}</p>}
                    {foodDescriptionResult.sources.length > 0 && (
                      <p className="t-caption">
                        Sources:{' '}
                        {foodDescriptionResult.sources.map((source, index) => (
                          <span key={source.url}>
                            {index > 0 ? ' · ' : ''}
                            <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                              {source.title}
                            </a>
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="t-caption">Review every field. Logging will also add it to Saved; a package label should win if available.</p>
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

          {manualNameFocused && manualNameQuery.length >= 2 && (
            <div>
              <p className="t-label-sm mb-2.5">{loadingSavedMeals ? 'Loading saved meals…' : 'Saved meals'}</p>
              {!loadingSavedMeals && manualSuggestions.length > 0 ? (
                <div className="max-h-36 overflow-y-auto">
                  {manualSuggestions.map((meal) => (
                    <button
                      key={meal.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectSavedMeal(meal)}
                      className="pressable w-full text-left py-2.5 border-t border-[var(--color-border)]"
                    >
                      <p className="t-body font-medium text-[var(--color-text)] truncate">{meal.name}</p>
                      <p className="t-data-sm text-[var(--color-muted)] mt-0.5">
                        {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                      </p>
                    </button>
                  ))}
                </div>
              ) : !loadingSavedMeals ? (
                <p className="t-caption">No saved meal matches yet.</p>
              ) : null}
            </div>
          )}

          {selectedSavedMealId && (
            <p className="t-label-sm text-[var(--color-text)]">
              {isSelectedSavedMealMatch ? 'Using saved meal values' : 'Editing saved meal values'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
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

          {!selectedSavedMealId && (
            <button
              type="button"
              onClick={() => setSaveAsReusableMeal(!saveAsReusableMeal)}
              className="pressable flex items-center gap-3 text-left"
            >
              <span
                className={`flex items-center justify-center w-[18px] h-[18px] border shrink-0 ${
                  saveAsReusableMeal
                    ? 'bg-[var(--color-text)] border-[var(--color-text)]'
                    : 'border-[var(--color-border-strong)]'
                }`}
              >
                {saveAsReusableMeal && <Check className="w-3 h-3 text-[var(--color-base)]" strokeWidth={3} />}
              </span>
              <span className={`t-label ${saveAsReusableMeal ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                Save as reusable meal
              </span>
            </button>
          )}

          {selectedSavedMealId && (
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

          {savedMealMessage && <p className="t-caption text-[var(--color-text)]">{savedMealMessage}</p>}
          {savedMealError && <p className="t-caption text-[var(--color-accent)]">{savedMealError}</p>}

          {whenRow}

          <Button
            className="w-full"
            size="lg"
            onClick={handleManualSubmit}
            disabled={!manualFood.name || saving || !timeValue}
            loading={saving}
          >
            {loggerMode === 'edit' ? 'Save changes' : 'Log entry'}
          </Button>
        </>
      ) : (
        <div className="space-y-5">
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

          <p className="t-caption">
            Add at least one photo of your meal. A top-down shot estimates portions best, but any angle works — add both for the most accuracy.
          </p>

          {!photoPreviews.top ? (
            <div className="space-y-3">
              <div>
                <span className="t-label-sm">01 · Recommended</span>
                <p className="t-heading mt-1">Top view</p>
                <p className="t-caption mt-1">Shows every component and how much of the plate it covers.</p>
              </div>
              <button
                type="button"
                onClick={() => topPhotoInputRef.current?.click()}
                className="pressable w-full border border-dashed border-[var(--color-border-strong)] py-10 flex flex-col items-center gap-3"
              >
                <span className="flex items-center justify-center w-12 h-12 border border-[var(--color-border-strong)]">
                  <Camera className="w-5 h-5 text-[var(--color-text-dim)]" strokeWidth={1.5} />
                </span>
                <span className="t-heading">Add top photo</span>
                <span className="t-caption">Take one now or choose from your library</span>
              </button>
              {isPreviewActive() && !isAppSandboxActive() && (
                <Button variant="secondary" className="w-full" onClick={handleUsePreviewPhoto}>
                  Use preview plate
                </Button>
              )}
            </div>
          ) : (
            <div className="relative overflow-hidden hairline-strong">
              <img src={photoPreviews.top} alt="Top view of meal" className="w-full h-52 object-cover" />
              {photoAnalyzing && (
                <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-base)_55%,transparent)] flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                  <span className="t-label text-[var(--color-text)]">Reading the plate…</span>
                </div>
              )}
              {!photoAnalyzing && (
                <button
                  type="button"
                  onClick={() => handleRetakePhoto('top')}
                  className="pressable absolute top-2.5 right-2.5 flex min-h-11 items-center gap-1.5 px-3 bg-[color-mix(in_srgb,var(--color-base)_82%,transparent)] backdrop-blur t-label text-[var(--color-text)]"
                >
                  <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
                  Retake
                </button>
              )}
            </div>
          )}

          <div className="pt-5 border-t border-[var(--color-border)] space-y-3">
            <div>
              <span className="t-label-sm">02 · Recommended</span>
              <p className="t-heading mt-1">45° side view</p>
              <p className="t-caption mt-1">Adds height and depth, which improves portion estimates.</p>
            </div>
            {photoPreviews.side ? (
              <div className="relative overflow-hidden hairline-strong">
                <img src={photoPreviews.side} alt="45 degree view of meal" className="w-full h-44 object-cover" />
                {photoAnalyzing && (
                  <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-base)_55%,transparent)]" aria-hidden="true" />
                )}
                {!photoAnalyzing && (
                  <button
                    type="button"
                    onClick={() => handleRetakePhoto('side')}
                    className="pressable absolute top-2.5 right-2.5 flex min-h-11 items-center gap-1.5 px-3 bg-[color-mix(in_srgb,var(--color-base)_82%,transparent)] backdrop-blur t-label text-[var(--color-text)]"
                  >
                    <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
                    Retake
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => sidePhotoInputRef.current?.click()}
                disabled={photoAnalyzing}
                className="pressable w-full min-h-20 border border-dashed border-[var(--color-border-strong)] px-4 flex items-center gap-4 text-left disabled:opacity-40"
              >
                <span className="flex items-center justify-center w-10 h-10 border border-[var(--color-border-strong)] shrink-0">
                  <ImagePlus className="w-4 h-4 text-[var(--color-text-dim)]" strokeWidth={1.5} />
                </span>
                <span>
                  <span className="t-heading block">Add side photo</span>
                  <span className="t-caption block mt-0.5">Same plate, about 45° above the table</span>
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
            onChange={(event) => setPhotoPlateDiameter(event.target.value)}
            placeholder="e.g., 27"
          />

          <Input
            label="Oils, sauces, dressings, hidden ingredients"
            value={photoIngredients}
            onChange={(event) => setPhotoIngredients(event.target.value)}
            placeholder="e.g., 1 tbsp olive oil, sauce on side, or none"
          />

          <Input
            label="Extra details (optional)"
            value={photoHint}
            onChange={(e) => setPhotoHint(e.target.value)}
            placeholder="e.g., 27 cm plate, extra olive oil"
          />

          <p className="t-caption">
            Shoot in good light. A measured plate or printed 5 cm marker on the food plane is useful; unmeasured utensils are not. You will confirm every detected item before logging.
          </p>

          {photoError && <p className="t-caption text-[var(--color-accent)]">{photoError}</p>}

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
