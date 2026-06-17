import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Loader2, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button, DateField, FormField, Input, RailStrip, SegmentedControl, SelectSheet, TimeField } from '@/components/shared';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
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
import { applyPortion, fetchUsdaFoodDetail, searchUsdaFoods, selectPortionFromDetail } from './usdaSearch';

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ANALYSIS_DATA_URL_CHARS = 2_800_000;
const MAX_IMAGE_DIMENSION = 1280;

function formatMacroInput(value: number): string {
  const rounded = Math.round((value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMeasurementAmount(value: number): string {
  if (!Number.isFinite(value)) return '';

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

interface PhotoDraftResult {
  food: {
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    serving_size: number;
    serving_unit: string;
    suggested_servings?: number;
  };
  confidence: number;
  reasoning?: string;
}

interface SelectedFoodMeta {
  source: 'photo';
  confidence: number;
  reasoning?: string;
}

const MEAL_OPTIONS = [
  { value: '', label: 'No tag' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
] as const;

interface EditableNutritionEntry {
  id: string;
  date: string;
  logged_at: string | null;
  food_id: string;
  servings: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
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
}

export function FoodLogger({ selectedDate, onComplete, initialEntry = null }: FoodLoggerProps) {
  const initialLogDate = useMemo(() => {
    if (initialEntry?.date) {
      const parsed = new Date(`${initialEntry.date}T12:00:00`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return new Date(selectedDate);
  }, [initialEntry?.date, selectedDate]);

  const [mode, setMode] = useState<'search' | 'manual' | 'photo'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFoodId, setLoadingFoodId] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(() => {
    if (!initialEntry?.food) return null;
    return {
      id: initialEntry.food.id,
      user_id: null,
      name: initialEntry.food.name,
      calories: initialEntry.food.calories,
      protein: initialEntry.food.protein,
      carbs: initialEntry.food.carbs,
      fat: initialEntry.food.fat,
      serving_size: initialEntry.food.serving_size || 1,
      serving_unit: initialEntry.food.serving_unit || 'serving',
      source: 'custom',
      fdc_id: null,
    };
  });
  const [servings, setServings] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementAmount, setMeasurementAmount] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>('serving');
  const [saving, setSaving] = useState(false);
  const [entryDate, setEntryDate] = useState<Date>(initialLogDate);
  const [timeValue, setTimeValue] = useState(() =>
    toLocalTimeInput(initialEntry?.logged_at || null, isToday(initialLogDate) ? new Date() : initialLogDate)
  );
  const [mealType, setMealType] = useState<string>(initialEntry?.meal_type || '');
  const [selectedFoodMeta, setSelectedFoodMeta] = useState<SelectedFoodMeta | null>(null);

  const loggerMode = initialEntry ? 'edit' : 'create';

  const [manualFood, setManualFood] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [savedMeals, setSavedMeals] = useState<Food[]>([]);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [manualNameFocused, setManualNameFocused] = useState(false);
  const [selectedSavedMealId, setSelectedSavedMealId] = useState<string | null>(null);
  const [saveAsReusableMeal, setSaveAsReusableMeal] = useState(false);
  const [updatingSavedMeal, setUpdatingSavedMeal] = useState(false);
  const [savedMealMessage, setSavedMealMessage] = useState<string | null>(null);
  const [savedMealError, setSavedMealError] = useState<string | null>(null);
  const [photoHint, setPhotoHint] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
  const selectedSavedMeal = useMemo(
    () => (selectedSavedMealId ? savedMeals.find((meal) => meal.id === selectedSavedMealId) || null : null),
    [savedMeals, selectedSavedMealId]
  );
  const searchUSDA = async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    const apiKey = import.meta.env.VITE_USDA_API_KEY;
    const foods = await searchUsdaFoods(query, apiKey);
    setSearchResults(foods);
    setLoading(false);
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

  useEffect(() => {
    if (mode !== 'manual') return;

    fetchSavedMeals();
    clearSavedMealFeedback();
    setSaveAsReusableMeal(false);
  }, [mode, fetchSavedMeals]);

  const resetPhotoState = () => {
    setPhotoError(null);
    setPhotoFile(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    setPhotoPreview(null);
    setPhotoHint('');
  };

  const handleRetakePhoto = () => {
    setPhotoError(null);
    setPhotoFile(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    setPhotoPreview(null);
    photoInputRef.current?.click();
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

  const parseFunctionError = async (error: unknown) => {
    const maybeContext = (error as { context?: { clone?: () => Response; json?: () => Promise<unknown>; text?: () => Promise<string> } })?.context;

    if (error instanceof FunctionsHttpError || maybeContext) {
      try {
        const response = typeof maybeContext?.clone === 'function'
          ? maybeContext.clone()
          : maybeContext;

        if (response?.json) {
          const details = await response.json() as { error?: string; message?: string };
          const serverMessage = details?.error || details?.message;
          if (typeof serverMessage === 'string' && serverMessage.trim()) {
            return serverMessage;
          }
        }

        if (response?.text) {
          const text = await response.text();
          if (text.trim()) {
            return text;
          }
        }
      } catch {
        // Fall through to generic error handling below.
      }
    }

    if (error instanceof Error && error.message.includes('non-2xx')) {
      return 'Photo analysis failed on the server. Open Supabase dashboard -> Edge Functions -> process-food-photo -> latest failed invocation.';
    }

    return error instanceof Error ? error.message : 'Could not analyze photo.';
  };

  const handlePhotoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setPhotoError(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
    }

    if (!file) {
      setPhotoFile(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      setPhotoFile(null);
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setPhotoError('Image is too large. Please choose one under 10MB.');
      setPhotoFile(null);
      return;
    }

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleAnalyzePhoto = async () => {
    if (!photoFile || saving) return;

    setPhotoError(null);
    setPhotoAnalyzing(true);

    try {
      const preparedImage = await fileToCompressedJpegBase64(photoFile);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        throw new Error('Your session expired. Please sign out and sign back in.');
      }

      const { data, error } = await supabase.functions.invoke('process-food-photo', {
        body: {
          imageBase64: preparedImage.imageBase64,
          mimeType: preparedImage.mimeType,
          hint: photoHint.trim() || null,
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) {
        const parsedErrorMessage = await parseFunctionError(error);
        throw new Error(parsedErrorMessage);
      }

      const draft = data as PhotoDraftResult | null;

      if (!draft?.food?.name) {
        throw new Error('Could not identify food from this image.');
      }

      const draftFood: Food = {
        id: `photo-${Date.now()}`,
        user_id: null,
        name: draft.food.name,
        calories: Math.max(0, Number(draft.food.calories) || 0),
        protein: Math.max(0, Number(draft.food.protein) || 0),
        carbs: Math.max(0, Number(draft.food.carbs) || 0),
        fat: Math.max(0, Number(draft.food.fat) || 0),
        serving_size: Math.max(1, Number(draft.food.serving_size) || 100),
        serving_unit: draft.food.serving_unit || 'serving',
        source: 'custom',
        fdc_id: null,
      };

      setSelectedFood(draftFood);
      setSelectedFoodMeta({
        source: 'photo',
        confidence: Math.max(0, Math.min(1, Number(draft.confidence) || 0)),
        reasoning: draft.reasoning,
      });

      const suggestedServings = Math.max(0.25, Number(draft.food.suggested_servings) || 1);
      setServings(String(suggestedServings));
      setMeasurementUnit('serving');
      setMeasurementAmount(formatMeasurementAmount(suggestedServings));
      resetPhotoState();
    } catch (analysisError) {
      const message = await parseFunctionError(analysisError);
      setPhotoError(message);
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

  const saveNutritionEntry = async (foodId: string, servingsCount: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No user found');
      return;
    }

    const loggedAt = buildLoggedAt(entryDate, timeValue);
    const day = format(entryDate, 'yyyy-MM-dd');

    const fullPayload = {
      food_id: foodId,
      servings: servingsCount,
      meal_type: mealType || null,
      date: day,
      logged_at: loggedAt,
    };

    const mealTypeFallbackPayload = {
      ...fullPayload,
      meal_type: undefined,
    };

    const loggedAtFallbackPayload = {
      ...fullPayload,
      logged_at: undefined,
      created_at: loggedAt,
    };

    const mealAndLoggedFallbackPayload = {
      ...loggedAtFallbackPayload,
      meal_type: undefined,
    };

    const mealAndLoggedNoCreatedPayload = {
      ...fullPayload,
      logged_at: undefined,
      meal_type: undefined,
    };

    const payloadAttempts = [
      fullPayload,
      mealTypeFallbackPayload,
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
          onComplete();
          return;
        }

        lastError = error;
        const shouldRetry =
          shouldDropColumn(error, 'logged_at')
          || shouldDropColumn(error, 'meal_type')
          || shouldDropColumn(error, 'created_at');
        if (!shouldRetry) {
          console.error('Error updating entry:', error);
          return;
        }
      } else {
        const { error } = await supabase
          .from('nutrition_logs')
          .insert({ user_id: user.id, ...cleanPayload });

        if (!error) {
          onComplete();
          return;
        }

        lastError = error;
        const shouldRetry =
          shouldDropColumn(error, 'logged_at')
          || shouldDropColumn(error, 'meal_type')
          || shouldDropColumn(error, 'created_at');
        if (!shouldRetry) {
          console.error('Error logging food:', error);
          return;
        }
      }
    }

    console.error('Error saving nutrition entry after retries:', lastError);
  };

  const handleSaveFromSelectedFood = async (food: Food, servingsCount: number) => {
    setSaving(true);
    try {
      const foodId = await upsertFoodIfNeeded(food);
      if (!foodId) return;
      await saveNutritionEntry(foodId, servingsCount);
    } catch (error) {
      console.error('Error saving nutrition entry:', error);
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

      await saveNutritionEntry(resolvedFoodId, parseFloat(servings || '1'));
    } catch (error) {
      console.error('Error in manual submit:', error);
    } finally {
      setSaving(false);
    }
  };

  /* ── Shared "when" row: date · time · meal tag ── */
  const whenRow = (
    <div className="grid grid-cols-2 gap-2">
      <DateField value={entryDate} onChange={setEntryDate} max={new Date()} />
      <TimeField value={timeValue} onChange={setTimeValue} />
      <SelectSheet
        className="col-span-2"
        title="Meal tag"
        value={mealType}
        onChange={(value) => setMealType(value)}
        options={MEAL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
    </div>
  );

  /* ═══════════ Review & confirm stage ═══════════ */

  if (selectedFood) {
    return (
      <div className="space-y-4 pt-1 pb-2">
        <div className="panel p-4">
          <h4 className="t-heading mb-2.5">{selectedFood.name}</h4>
          {selectedFoodMeta?.source === 'photo' && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="t-label-sm text-[var(--color-sage)] flex items-center gap-1">
                  <Sparkles className="w-3 h-3" strokeWidth={2} />
                  Photo estimate
                </span>
                <span className="t-data-sm text-[var(--color-sage)]">{Math.round(selectedFoodMeta.confidence * 100)}%</span>
              </div>
              <RailStrip value={selectedFoodMeta.confidence} tone="sage" size="sm" />
              {selectedFoodMeta.reasoning && (
                <p className="text-[11px] text-[var(--color-muted)] mt-2">{selectedFoodMeta.reasoning}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'kcal', value: Math.round(selectedFood.calories) },
              { label: 'protein', value: `${Math.round(selectedFood.protein)}g` },
              { label: 'carbs', value: `${Math.round(selectedFood.carbs)}g` },
              { label: 'fat', value: `${Math.round(selectedFood.fat)}g` },
            ].map((cell) => (
              <div key={cell.label} className="well px-1 py-2 text-center">
                <p className="t-data text-[var(--color-text)]">{cell.value}</p>
                <p className="t-label-sm text-[9px] mt-0.5">{cell.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-muted)] mt-2">
            {selectedFood.serving_label
              ? `per ${selectedFood.serving_label} (${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'g'})`
              : `per ${formatMeasurementAmount(selectedFood.serving_size || 1)} ${selectedFood.serving_unit || 'serving'}`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
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

        <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-accent-tint px-4 py-3">
          <span className="t-label">This entry</span>
          <span className="t-data-lg text-[var(--color-text)]">
            {selectedFoodTotalCalories} <span className="text-[12px] text-[var(--color-muted)]">kcal</span>
            <span className="text-[12px] text-[var(--color-text-dim)] ml-2">{selectedFoodTotalProtein}g protein</span>
          </span>
        </div>

        <div className="flex gap-2.5 pt-1">
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
    <div className="space-y-4 pt-1 pb-2">
      <SegmentedControl
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next !== 'photo') setPhotoError(null);
        }}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'manual', label: 'Manual' },
          { value: 'photo', label: 'Photo' },
        ]}
      />

      {mode === 'search' ? (
        <>
          <div className="well flex items-center gap-2 pl-3.5 pr-1.5 py-1.5">
            <Search className="w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={2} />
            <input
              type="text"
              placeholder="Search the USDA database…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUSDA(searchQuery)}
              className="flex-1 min-w-0 bg-transparent text-sm font-medium text-[var(--color-text)] outline-none placeholder:text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)]"
            />
            <button
              type="button"
              className="pressable flex items-center justify-center w-9 h-9 rounded-[var(--radius-xs)] bg-[var(--color-surface-3)] text-[var(--color-text)] disabled:opacity-40"
              onClick={() => searchUSDA(searchQuery)}
              disabled={loading}
              aria-label="Search"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" strokeWidth={2.25} />}
            </button>
          </div>

          <div className="max-h-56 md:max-h-64 overflow-y-auto space-y-1.5 overscroll-contain touch-pan-y">
            {searchResults.map((food, index) => (
              <motion.button
                key={food.fdc_id || food.id}
                type="button"
                className="pressable w-full flex items-center justify-between gap-3 px-3.5 py-3 bg-[var(--color-surface-2)] hairline rounded-[var(--radius-md)] text-left"
                onClick={async () => {
                  if (saving || loadingFoodId) return;

                  setSelectedFoodMeta(null);

                  let resolvedFood = food;
                  if (food.source === 'usda' && food.fdc_id) {
                    setLoadingFoodId(food.fdc_id);
                    try {
                      const apiKey = import.meta.env.VITE_USDA_API_KEY;
                      const detail = await fetchUsdaFoodDetail(food.fdc_id, apiKey);
                      resolvedFood = applyPortion(food, selectPortionFromDetail(detail));
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">{food.name}</p>
                  <p className="t-data-sm text-[var(--color-muted)] mt-0.5">{Math.round(food.calories)} kcal / 100g</p>
                </div>
                <span className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-xs)] bg-[var(--color-surface-3)] shrink-0">
                  {loadingFoodId === food.fdc_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-text-dim)]" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-[var(--color-text-dim)]" strokeWidth={2.25} />
                  )}
                </span>
              </motion.button>
            ))}
          </div>
        </>
      ) : mode === 'manual' ? (
        <>
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
              <p className="t-label-sm mb-1.5">{loadingSavedMeals ? 'Loading saved meals…' : 'Saved meals'}</p>
              {!loadingSavedMeals && manualSuggestions.length > 0 ? (
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {manualSuggestions.map((meal) => (
                    <button
                      key={meal.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelectSavedMeal(meal)}
                      className="pressable w-full text-left px-3 py-2.5 bg-[var(--color-surface-2)] hairline rounded-[var(--radius-sm)]"
                    >
                      <p className="text-[13px] font-medium text-[var(--color-text)] truncate">{meal.name}</p>
                      <p className="t-data-sm text-[10px] text-[var(--color-muted)] mt-0.5">
                        {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                      </p>
                    </button>
                  ))}
                </div>
              ) : !loadingSavedMeals ? (
                <p className="text-[11px] text-[var(--color-muted)]">No saved meal matches yet.</p>
              ) : null}
            </div>
          )}

          {selectedSavedMealId && (
            <p className="text-[11px] font-semibold text-[var(--color-sage)]">
              {isSelectedSavedMealMatch ? 'Using saved meal values' : 'Editing saved meal values'}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
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

          <div className="grid grid-cols-2 gap-2.5 items-end">
            <FormField label="Servings">
              <input
                type="number"
                inputMode="decimal"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                min="0.25"
                step="0.25"
                className="well w-full min-h-11 px-3 text-center t-data-lg text-[var(--color-text)] outline-none focus:ring-[1.5px] focus:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
              />
            </FormField>

            {!selectedSavedMealId && (
              <button
                type="button"
                onClick={() => setSaveAsReusableMeal(!saveAsReusableMeal)}
                className={`pressable flex items-center gap-2 px-3 min-h-11 rounded-[var(--radius-sm)] border text-left ${
                  saveAsReusableMeal
                    ? 'bg-sage-tint border-[color-mix(in_srgb,var(--color-sage)_40%,transparent)]'
                    : 'bg-[var(--color-surface-2)] border-[var(--color-border)]'
                }`}
              >
                <span
                  className={`flex items-center justify-center w-4.5 h-4.5 w-[18px] h-[18px] rounded-[5px] border shrink-0 ${
                    saveAsReusableMeal
                      ? 'bg-[var(--color-sage)] border-[var(--color-sage)]'
                      : 'border-[var(--color-border-strong)]'
                  }`}
                >
                  {saveAsReusableMeal && <Check className="w-3 h-3 text-[var(--color-base)]" strokeWidth={3.5} />}
                </span>
                <span className={`text-[12px] font-medium leading-tight ${saveAsReusableMeal ? 'text-[var(--color-sage)]' : 'text-[var(--color-text-dim)]'}`}>
                  Save as reusable meal
                </span>
              </button>
            )}
          </div>

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

          {savedMealMessage && <p className="text-[11px] font-semibold text-[var(--color-sage)]">{savedMealMessage}</p>}
          {savedMealError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{savedMealError}</p>}

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
        <div className="space-y-3">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoSelect}
            className="hidden"
          />

          {!photoPreview ? (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="pressable w-full rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] py-10 flex flex-col items-center gap-2.5"
            >
              <span className="flex items-center justify-center w-12 h-12 rounded-full well">
                <Camera className="w-5 h-5 text-[var(--color-stone)]" strokeWidth={1.75} />
              </span>
              <span className="t-heading text-[15px]">Snap your plate</span>
              <span className="t-caption">Camera or photo library</span>
            </button>
          ) : (
            <div className="relative rounded-[var(--radius-lg)] overflow-hidden hairline-strong">
              <img src={photoPreview} alt="Meal preview" className="w-full h-48 object-cover" />
              {photoAnalyzing && (
                <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-base)_55%,transparent)] flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
                  <span className="t-label text-[var(--color-text)]">Reading the plate…</span>
                </div>
              )}
              {!photoAnalyzing && (
                <button
                  type="button"
                  onClick={handleRetakePhoto}
                  className="pressable absolute top-2.5 right-2.5 flex items-center gap-1.5 px-3 py-2 rounded-full bg-[color-mix(in_srgb,var(--color-base)_75%,transparent)] backdrop-blur text-[11px] font-semibold text-[var(--color-text)]"
                >
                  <RefreshCw className="w-3 h-3" strokeWidth={2.25} />
                  Retake
                </button>
              )}
            </div>
          )}

          <Input
            label="Extra details (optional)"
            value={photoHint}
            onChange={(e) => setPhotoHint(e.target.value)}
            placeholder="e.g., large bowl, extra olive oil"
          />

          {photoError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{photoError}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={handleAnalyzePhoto}
            loading={photoAnalyzing}
            disabled={!photoFile || photoAnalyzing || saving}
          >
            {!photoAnalyzing && <Sparkles className="w-4 h-4" strokeWidth={2} />}
            {photoAnalyzing ? 'Analyzing…' : 'Analyze photo'}
          </Button>
        </div>
      )}
    </div>
  );
}
