import { useMemo, useState } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, Input, Card } from '@/components/shared';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import { format, isToday } from 'date-fns';
import { buildLoggedAt, shouldDropColumn, toLocalTimeInput } from './foodLoggerUtils';
import { searchUsdaFoods } from './usdaSearch';

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
  const [mode, setMode] = useState<'search' | 'manual'>('search');
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
  const [timeValue, setTimeValue] = useState(() =>
    toLocalTimeInput(initialEntry?.logged_at || null, isToday(selectedDate) ? new Date() : selectedDate)
  );
  const [mealType, setMealType] = useState<string>(initialEntry?.meal_type || '');

  const loggerMode = initialEntry ? 'edit' : 'create';
  const dayLabel = useMemo(() => format(selectedDate, 'MMM d, yyyy'), [selectedDate]);

  const [manualFood, setManualFood] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
  });
  const searchUSDA = async (query: string) => {
    if (!query.trim()) return;

    setLoading(true);
    const apiKey = import.meta.env.VITE_USDA_API_KEY;
    const foods = await searchUsdaFoods(query, apiKey);
    setSearchResults(foods);
    setLoading(false);
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

    return foodId;
  };

  const saveNutritionEntry = async (foodId: string, servingsCount: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('No user found');
      return;
    }

    const loggedAt = buildLoggedAt(selectedDate, timeValue);
    const day = format(selectedDate, 'yyyy-MM-dd');

    const fullPayload = {
      food_id: foodId,
      servings: servingsCount,
      meal_type: mealType || null,
      date: day,
      logged_at: loggedAt,
    };

    const payloadAttempts = [
      fullPayload,
      { ...fullPayload, logged_at: undefined },
      { ...fullPayload, meal_type: undefined },
      { ...fullPayload, logged_at: undefined, meal_type: undefined },
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
        const shouldRetry = shouldDropColumn(error, 'logged_at') || shouldDropColumn(error, 'meal_type');
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
        const shouldRetry = shouldDropColumn(error, 'logged_at') || shouldDropColumn(error, 'meal_type');
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
            <div className="w-full h-10 md:h-auto px-3 md:px-4 py-2 md:py-3 bg-[#1A1A1A] border border-white/10 rounded-[14px] md:rounded-[20px] text-[#9A9A9A] text-sm flex items-center">
              {dayLabel}
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
            <Button variant="ghost" className="flex-1" onClick={() => setSelectedFood(null)} disabled={saving}>
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
              onClick={() => setMode('search')}
            >
              Search
            </button>
            <button
              type="button"
              className={`flex-1 py-2.5 rounded-[16px] text-[10px] tracking-[0.1em] uppercase transition-all ${
                mode === 'manual' ? 'bg-[#2E2E2E] text-[#E8E4DE]' : 'text-[#6B6B6B]'
              }`}
              onClick={() => setMode('manual')}
            >
              Manual
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
          ) : (
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
          )}
        </>
      )}
    </div>
  );
}
