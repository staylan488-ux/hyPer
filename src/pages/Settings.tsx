import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, LogOut, Palette, Pencil, Target, User, UtensilsCrossed, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, Card, CardTitle, Input, Modal, ThemeToggle } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { normalizeFoodName, shouldDropColumn } from '@/components/nutrition/foodLoggerUtils';
import { NutritionWizard } from '@/components/nutrition/NutritionWizard';

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

export function Settings() {
  const { profile, signOut, updateDisplayName } = useAuthStore();
  const { macroTarget, fetchMacroTarget, updateMacroTarget } = useAppStore();
  const theme = useThemeStore((state) => state.theme);

  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null);
  const [macroDraft, setMacroDraft] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
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

  useEffect(() => {
    fetchMacroTarget();
  }, [fetchMacroTarget]);

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
    if (loadingSavedMeals) return 'Loading meals...';
    if (savedMeals.length === 0) return 'No meals saved';
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
    if (!confirm(`Remove ${meal.name} from saved meals?`)) return;

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
      setMealManagerError('Could not remove saved meal.');
      return;
    }

    if (editingMealId === meal.id) {
      setEditingMealId(null);
    }

    setMealManagerMessage('Saved meal removed.');
    await fetchSavedMeals();
  };

  const baseMacros = {
    calories: macroTarget?.calories || 2000,
    protein: macroTarget?.protein || 150,
    carbs: macroTarget?.carbs || 200,
    fat: macroTarget?.fat || 65,
  };

  const displayName = displayNameDraft ?? (profile?.display_name || '');
  const macros = macroDraft ?? baseMacros;

  const normalizedDisplayName = displayName.trim();
  const currentDisplayName = profile?.display_name || '';
  const displayNameChanged = normalizedDisplayName !== currentDisplayName;

  const macrosChanged =
    macros.calories !== baseMacros.calories
    || macros.protein !== baseMacros.protein
    || macros.carbs !== baseMacros.carbs
    || macros.fat !== baseMacros.fat;

  const clearNameFeedback = () => {
    setNameMessage(null);
    setNameError(null);
  };

  const clearMacroFeedback = () => {
    setMacroMessage(null);
    setMacroError(null);
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
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      {/* Header */}
      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[var(--color-muted)] mb-1">Account</p>
        <h1 className="text-2xl font-display-italic text-[var(--color-text)] tracking-tight">Profile</h1>
      </motion.header>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <Palette className="w-4 h-4 text-accent" strokeWidth={1.5} />
            <CardTitle>Appearance</CardTitle>
          </div>
          <div className="flex items-center justify-between gap-3 p-3 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-base)]">
            <div>
              <p className="text-[11px] tracking-[0.12em] uppercase text-[var(--color-text)]">Theme</p>
              <p className="text-[10px] text-[var(--color-muted)] mt-1">
                {theme === 'light' ? 'Bone & Clay light mode' : 'Nocturne dark mode'}
              </p>
            </div>
            <ThemeToggle />
          </div>
        </Card>
      </motion.div>

      {/* Profile */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <User className="w-4 h-4 text-accent" strokeWidth={1.5} />
            <CardTitle>Identity</CardTitle>
          </div>
          <Input
            label="Display Name"
            value={displayName}
            onChange={(e) => {
              clearNameFeedback();
              setDisplayNameDraft(e.target.value);
            }}
            placeholder="Your name"
          />
          <Button
            className="w-full mt-4"
            onClick={handleSaveDisplayName}
            loading={savingName}
            disabled={!displayNameChanged}
          >
            Save Name
          </Button>
          {nameMessage && <p className="mt-2 text-[10px] tracking-[0.1em] uppercase text-sage">{nameMessage}</p>}
          {nameError && <p className="mt-2 text-[10px] tracking-[0.1em] uppercase text-[var(--color-danger)]">{nameError}</p>}
        </Card>
      </motion.div>

      {/* Macro Targets */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-4 h-4 text-sage" strokeWidth={1.5} />
            <CardTitle>Daily Targets</CardTitle>
          </div>

          {showNutritionWizard ? (
            <NutritionWizard
              onApply={(targets) => {
                clearMacroFeedback();
                setMacroDraft({
                  calories: targets.calories,
                  protein: targets.protein,
                  carbs: targets.carbs,
                  fat: targets.fat,
                });
                setShowNutritionWizard(false);
                setMacroMessage('Targets calculated — review and save above.');
              }}
              onCancel={() => setShowNutritionWizard(false)}
            />
          ) : (
            <div className="space-y-4">
              <button
                className="w-full flex items-center justify-between p-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-base)] hover:border-[color-mix(in_srgb,var(--color-border)_100%,var(--color-text)_20%)] transition-colors group"
                onClick={() => {
                  clearMacroFeedback();
                  setShowNutritionWizard(true);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-[10px] bg-[var(--color-card)]">
                    <Wand2 className="w-3.5 h-3.5 text-sage" strokeWidth={1.5} />
                  </div>
                  <div className="text-left">
                    <p className="text-[11px] text-[var(--color-text)]">Calculate my targets</p>
                    <p className="text-[9px] tracking-[0.08em] uppercase text-[var(--color-muted)]">
                      Answer a few questions for personalized macros
                    </p>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--color-border)]" />
                <span className="text-[9px] tracking-[0.15em] uppercase text-[var(--color-muted)]">or set manually</span>
                <div className="flex-1 h-px bg-[var(--color-border)]" />
              </div>

              <Input
                label="Calories"
                type="number"
                inputMode="numeric"
                value={macros.calories}
                onChange={(e) => {
                  clearMacroFeedback();
                  setMacroDraft({ ...macros, calories: parseInt(e.target.value, 10) || 0 });
                }}
              />

              <div className="grid grid-cols-3 gap-3">
                <Input
                  label="Protein (g)"
                  type="number"
                  inputMode="numeric"
                  value={macros.protein}
                  onChange={(e) => {
                    clearMacroFeedback();
                    setMacroDraft({ ...macros, protein: parseInt(e.target.value, 10) || 0 });
                  }}
                />
                <Input
                  label="Carbs (g)"
                  type="number"
                  inputMode="numeric"
                  value={macros.carbs}
                  onChange={(e) => {
                    clearMacroFeedback();
                    setMacroDraft({ ...macros, carbs: parseInt(e.target.value, 10) || 0 });
                  }}
                />
                <Input
                  label="Fat (g)"
                  type="number"
                  inputMode="numeric"
                  value={macros.fat}
                  onChange={(e) => {
                    clearMacroFeedback();
                    setMacroDraft({ ...macros, fat: parseInt(e.target.value, 10) || 0 });
                  }}
                />
              </div>

              <Button className="w-full" onClick={handleSaveMacros} loading={savingMacros} disabled={!macrosChanged}>
                Save Targets
              </Button>
              {macroMessage && <p className="text-[10px] tracking-[0.1em] uppercase text-sage">{macroMessage}</p>}
              {macroError && <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-danger)]">{macroError}</p>}
            </div>
          )}
        </Card>
      </motion.div>

      {/* Sign Out */}
      <motion.div className="mt-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <UtensilsCrossed className="w-4 h-4 text-accent" strokeWidth={1.5} />
            <CardTitle>Saved Meals</CardTitle>
          </div>
          <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">{savedMealsCountLabel}</p>
          <Button variant="secondary" className="w-full mt-4" onClick={openManageMeals}>
            Manage Meals
          </Button>
        </Card>

        <Button
          variant="ghost"
          className="w-full text-[var(--color-danger)] hover:text-[var(--color-text)]"
          onClick={handleSignOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </motion.div>

      {/* App Info */}
      <motion.div
        className="mt-12 text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.smooth}
      >
        <p className="text-[10px] tracking-[0.15em] text-[var(--color-muted)]">
          hyPer
        </p>
        <p className="text-[9px] tracking-[0.1em] uppercase text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)] mt-1">
          Built on peer-reviewed research
        </p>
      </motion.div>

      <Modal isOpen={manageMealsOpen} onClose={closeManageMeals} title="Saved Meals">
        <div className="pt-4 space-y-3">
          {mealManagerMessage && <p className="text-[10px] tracking-[0.1em] uppercase text-sage">{mealManagerMessage}</p>}
          {mealManagerError && <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-danger)]">{mealManagerError}</p>}

          {loadingSavedMeals ? (
            <div className="space-y-2">
              <div className="h-[56px] rounded-[20px] shimmer" />
              <div className="h-[56px] rounded-[20px] shimmer" />
              <div className="h-[56px] rounded-[20px] shimmer" />
            </div>
          ) : savedMeals.length === 0 ? (
            <p className="text-editorial text-center py-8">
              Meals you save from the food logger will appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {savedMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="p-3 rounded-[20px] border border-[var(--color-border)] bg-[var(--color-base)]"
                >
                  {editingMealId === meal.id ? (
                    <div className="space-y-3">
                      <Input
                        label="Meal Name"
                        value={editingMealDraft.name}
                        onChange={(e) => setEditingMealDraft({ ...editingMealDraft, name: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-3">
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
                      </div>
                      <div className="grid grid-cols-2 gap-3">
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

                      <div className="flex gap-2 pt-1">
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
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--color-text)] truncate">{meal.name}</p>
                        <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-muted)] mt-1 tabular-nums">
                          {Math.round(meal.calories)} cal · {Math.round(meal.protein)}p · {Math.round(meal.carbs)}c · {Math.round(meal.fat)}f
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => beginEditingMeal(meal)}
                          className="w-8 h-8 rounded-[14px] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] transition-colors"
                          aria-label={`Edit ${meal.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSavedMeal(meal)}
                          className="w-8 h-8 rounded-[14px] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] transition-colors"
                          aria-label={`Remove ${meal.name}`}
                        >
                          <Archive className="w-3.5 h-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </motion.div>
  );
}
