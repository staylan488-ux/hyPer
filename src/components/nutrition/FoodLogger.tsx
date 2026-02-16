import { useMemo, useState } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Button, Input, Card } from '@/components/shared';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import { format, isToday } from 'date-fns';
import { buildLoggedAt, shouldDropColumn, toLocalTimeInput } from './foodLoggerUtils';
import { searchUsdaFoods } from './usdaSearch';

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ANALYSIS_DATA_URL_CHARS = 2_800_000;
const MAX_IMAGE_DIMENSION = 1280;

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
  { value: '', label: 'None' },
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
      serving_size: 1,
      serving_unit: 'serving',
      source: 'custom',
      fdc_id: null,
    };
  });
  const [servings, setServings] = useState(initialEntry ? String(initialEntry.servings) : '1');
  const [saving, setSaving] = useState(false);
  const [entryDate, setEntryDate] = useState<Date>(initialLogDate);
  const [timeValue, setTimeValue] = useState(() =>
    toLocalTimeInput(initialEntry?.logged_at || null, isToday(initialLogDate) ? new Date() : initialLogDate)
  );
  const [mealType, setMealType] = useState<string>(initialEntry?.meal_type || '');
  const [selectedFoodMeta, setSelectedFoodMeta] = useState<SelectedFoodMeta | null>(null);

  const loggerMode = initialEntry ? 'edit' : 'create';
  const dayLabel = useMemo(() => format(entryDate, 'MMM d, yyyy'), [entryDate]);

  const [manualFood, setManualFood] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const [photoHint, setPhotoHint] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const searchUSDA = async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    const apiKey = import.meta.env.VITE_USDA_API_KEY;
    const foods = await searchUsdaFoods(query, apiKey);
    setSearchResults(foods);
    setLoading(false);
  };

  const resetPhotoState = () => {
    setPhotoError(null);
    setPhotoFile(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    setPhotoPreview(null);
    setPhotoHint('');
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
      setServings(String(Math.max(0.25, Number(draft.food.suggested_servings) || 1)));
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
      const { data: existingFood, error: lookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('fdc_id', food.fdc_id)
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
            serving_size: food.serving_size || 100,
            serving_unit: food.serving_unit || 'g',
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

  const handleManualSubmit = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
        return;
      }

      const manualPayload = {
        user_id: user.id,
        name: manualFood.name,
        calories: parseFloat(manualFood.calories) || 0,
        protein: parseFloat(manualFood.protein) || 0,
        carbs: parseFloat(manualFood.carbs) || 0,
        fat: parseFloat(manualFood.fat) || 0,
        source: 'custom' as const,
      };

      let { data: food, error: foodError } = await supabase
        .from('foods')
        .insert({
          ...manualPayload,
          serving_size: 1,
          serving_unit: 'serving',
        })
        .select('id')
        .single();

      if (foodError && shouldDropColumn(foodError, 'serving_size')) {
        ({ data: food, error: foodError } = await supabase
          .from('foods')
          .insert(manualPayload)
          .select('id')
          .single());
      }

      if (foodError || !food) {
        console.error('Error creating custom food:', foodError);
        return;
      }

      await saveNutritionEntry(food.id, parseFloat(servings || '1'));
    } catch (error) {
      console.error('Error in manual submit:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-5">
      <Card variant="slab" className="bg-[#1A1A1A] !p-2.5 md:!p-5 !rounded-[22px] md:!rounded-[28px] overflow-hidden">
        <p className="text-[9px] md:text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-1.5 md:mb-3">Entry details</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
          <div>
            <label className="block text-[10px] font-medium tracking-[0.2em] uppercase text-[#6B6B6B] mb-1">
              Date
            </label>
            <div className="space-y-1">
              <input
                type="date"
                value={format(entryDate, 'yyyy-MM-dd')}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (!nextValue) return;
                  const parsed = new Date(`${nextValue}T12:00:00`);
                  if (!Number.isNaN(parsed.getTime())) {
                    setEntryDate(parsed);
                  }
                }}
                className="w-full h-10 md:h-auto px-3 md:px-4 py-2 md:py-3 bg-[#1A1A1A] border border-white/10 rounded-[14px] md:rounded-[20px] text-[#E8E4DE] text-sm focus:outline-none focus:border-white/25"
              />
              <p className="text-[10px] text-[#6B6B6B]">{dayLabel}</p>
            </div>
          </div>
          <div className="min-w-0 overflow-hidden">
            <label className="block text-[10px] font-medium tracking-[0.2em] uppercase text-[#6B6B6B] mb-1">
              Time
            </label>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => setTimeValue(e.target.value)}
              className="block w-full max-w-full min-w-0 h-10 md:h-auto px-2.5 md:px-4 py-2 md:py-3 bg-[#1A1A1A] border border-white/10 rounded-[14px] md:rounded-[20px] text-[#E8E4DE] text-[16px] md:text-sm focus:outline-none focus:border-white/25 transition-all"
            />
          </div>
        </div>

        <div className="mt-2 md:mt-3">
          <label className="block text-[10px] font-medium tracking-[0.2em] uppercase text-[#6B6B6B] mb-1">
            Meal Tag (Optional)
          </label>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="w-full h-10 md:h-auto px-3 md:px-4 py-2 md:py-3 bg-[#1A1A1A] border border-white/10 rounded-[14px] md:rounded-[20px] text-[#E8E4DE] text-sm focus:outline-none focus:border-white/25 transition-all"
          >
            {MEAL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {selectedFood ? (
        <div className="space-y-5">
          <Card variant="slab" className="bg-[#1A1A1A]">
            <h4 className="text-sm text-[#E8E4DE] mb-3">{selectedFood.name}</h4>
            {selectedFoodMeta?.source === 'photo' && (
              <div className="mb-3 space-y-1">
                <p className="text-[9px] tracking-[0.1em] uppercase text-[#8B9A7D]">
                  Photo estimate - {Math.round(selectedFoodMeta.confidence * 100)}% confidence
                </p>
                {selectedFoodMeta.reasoning && (
                  <p className="text-[10px] text-[#6B6B6B]">{selectedFoodMeta.reasoning}</p>
                )}
              </div>
            )}
            <div className="flex gap-4 text-[10px] tabular-nums">
              <div>
                <span className="text-[#6B6B6B]">KCAL</span>
                <p className="text-[#9A9A9A]">{Math.round(selectedFood.calories)}</p>
              </div>
              <div>
                <span className="text-[#6B6B6B]">PRO</span>
                <p className="text-[#9A9A9A]">{Math.round(selectedFood.protein)}g</p>
              </div>
              <div>
                <span className="text-[#6B6B6B]">CAR</span>
                <p className="text-[#9A9A9A]">{Math.round(selectedFood.carbs)}g</p>
              </div>
              <div>
                <span className="text-[#6B6B6B]">FAT</span>
                <p className="text-[#9A9A9A]">{Math.round(selectedFood.fat)}g</p>
              </div>
            </div>
          </Card>

          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-[#6B6B6B] mb-2">Servings</label>
            <input
              type="number"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              min="0.25"
              step="0.25"
              className="w-full text-center text-2xl tabular-nums bg-transparent border-b border-white/10 focus:border-[#E8E4DE] outline-none py-3 text-[#E8E4DE] transition-colors"
            />
          </div>

          <div className="text-center py-4 bg-[#1A1A1A] rounded-[20px]">
            <p className="text-2xl tabular-nums text-[#E8E4DE]">
              {Math.round(selectedFood.calories * parseFloat(servings || '0'))}
            </p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-[#6B6B6B] mt-1">Total Calories</p>
            <p className="text-[10px] text-[#9A9A9A] mt-2">
              {Math.round(selectedFood.protein * parseFloat(servings || '0'))}g Protein
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                setSelectedFood(null);
                setSelectedFoodMeta(null);
              }}
              disabled={saving}
            >
              Change Food
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleSaveFromSelectedFood(selectedFood, parseFloat(servings || '1'))}
              loading={saving}
              disabled={!timeValue}
            >
              {loggerMode === 'edit' ? 'Save Changes' : 'Log Entry'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 p-1 bg-[#1A1A1A] rounded-[20px]">
            <button
              type="button"
              className={`flex-1 py-2.5 rounded-[16px] text-[10px] tracking-[0.1em] uppercase transition-all ${
                mode === 'search' ? 'bg-[#2E2E2E] text-[#E8E4DE]' : 'text-[#6B6B6B]'
              }`}
              onClick={() => {
                setMode('search');
                setPhotoError(null);
              }}
            >
              Search
            </button>
            <button
              type="button"
              className={`flex-1 py-2.5 rounded-[16px] text-[10px] tracking-[0.1em] uppercase transition-all ${
                mode === 'manual' ? 'bg-[#2E2E2E] text-[#E8E4DE]' : 'text-[#6B6B6B]'
              }`}
              onClick={() => {
                setMode('manual');
                setPhotoError(null);
              }}
            >
              Manual
            </button>
            <button
              type="button"
              className={`flex-1 py-2.5 rounded-[16px] text-[10px] tracking-[0.1em] uppercase transition-all ${
                mode === 'photo' ? 'bg-[#2E2E2E] text-[#E8E4DE]' : 'text-[#6B6B6B]'
              }`}
              onClick={() => setMode('photo')}
            >
              Photo
            </button>
          </div>

          {mode === 'search' ? (
            <>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    placeholder="Search USDA database..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchUSDA(searchQuery)}
                    className="w-full px-4 py-3 bg-[#1A1A1A] border border-white/10 rounded-[20px] text-sm text-[#E8E4DE] placeholder:text-[#6B6B6B]/60 focus:border-white/20 outline-none transition-colors"
                  />
                </div>
                <button
                  type="button"
                  className="w-12 h-12 flex items-center justify-center bg-[#2E2E2E] rounded-[20px] hover:bg-[#383838] transition-colors disabled:opacity-40"
                  onClick={() => searchUSDA(searchQuery)}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin text-[#9A9A9A]" /> : <Search className="w-4 h-4 text-[#E8E4DE]" />}
                </button>
              </div>

              <div className="max-h-48 md:max-h-64 overflow-y-auto space-y-2 overscroll-contain touch-pan-y">
                {searchResults.map((food, index) => (
                  <motion.button
                    key={food.fdc_id || food.id}
                    type="button"
                    className="w-full flex items-center justify-between p-4 bg-[#1A1A1A] border border-white/5 rounded-[20px] hover:border-white/10 transition-colors text-left active:border-white/20"
                    onClick={() => {
                      setSelectedFoodMeta(null);
                      if (!saving) setSelectedFood(food);
                    }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04, ...springs.smooth }}
                    whileTap={{ scale: 0.98 }}
                    disabled={saving}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#E8E4DE] truncate">{food.name}</p>
                      <p className="text-[10px] tabular-nums text-[#6B6B6B] mt-1">
                        {Math.round(food.calories)} kcal / 100g
                      </p>
                    </div>
                    <div className="ml-3 p-2 rounded-[12px] bg-[#2E2E2E]">
                      <Plus className="w-3 h-3 text-[#9A9A9A]" />
                    </div>
                  </motion.button>
                ))}
              </div>
            </>
          ) : mode === 'manual' ? (
            <>
              <Input
                label="Food Name"
                value={manualFood.name}
                onChange={(e) => setManualFood({ ...manualFood, name: e.target.value })}
                placeholder="e.g., Chicken Breast"
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Calories"
                  type="number"
                  value={manualFood.calories}
                  onChange={(e) => setManualFood({ ...manualFood, calories: e.target.value })}
                  placeholder="0"
                />
                <Input
                  label="Protein (g)"
                  type="number"
                  value={manualFood.protein}
                  onChange={(e) => setManualFood({ ...manualFood, protein: e.target.value })}
                  placeholder="0"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Carbs (g)"
                  type="number"
                  value={manualFood.carbs}
                  onChange={(e) => setManualFood({ ...manualFood, carbs: e.target.value })}
                  placeholder="0"
                />
                <Input
                  label="Fat (g)"
                  type="number"
                  value={manualFood.fat}
                  onChange={(e) => setManualFood({ ...manualFood, fat: e.target.value })}
                  placeholder="0"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-[#6B6B6B] mb-2">Servings</label>
                <input
                  type="number"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                  min="0.25"
                  step="0.25"
                  className="w-full text-center text-xl tabular-nums bg-transparent border-b border-white/10 focus:border-[#E8E4DE] outline-none py-2 text-[#E8E4DE] transition-colors"
                />
              </div>

              <Button
                className="w-full"
                onClick={handleManualSubmit}
                disabled={!manualFood.name || saving || !timeValue}
                loading={saving}
              >
                {loggerMode === 'edit' ? 'Save Changes' : 'Log Entry'}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <Card variant="slab" className="bg-[#1A1A1A] !p-3">
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Meal Photo</p>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoSelect}
                      className="block w-full text-xs text-[#9A9A9A] file:mr-3 file:px-3 file:py-2 file:rounded-[12px] file:border-0 file:bg-[#2E2E2E] file:text-[#E8E4DE] file:text-[10px] file:tracking-[0.1em] file:uppercase"
                    />
                  </div>

                  {photoPreview && (
                    <img
                      src={photoPreview}
                      alt="Meal preview"
                      className="w-full h-40 object-cover rounded-[16px] border border-white/10"
                    />
                  )}

                  <Input
                    label="Extra Details (Optional)"
                    value={photoHint}
                    onChange={(e) => setPhotoHint(e.target.value)}
                    placeholder="e.g., large bowl, extra olive oil"
                  />

                  {photoError && (
                    <p className="text-[10px] tracking-[0.1em] uppercase text-[#8B6B6B]">{photoError}</p>
                  )}

                  <Button
                    className="w-full"
                    onClick={handleAnalyzePhoto}
                    loading={photoAnalyzing}
                    disabled={!photoFile || photoAnalyzing || saving}
                  >
                    Analyze Photo
                  </Button>
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
