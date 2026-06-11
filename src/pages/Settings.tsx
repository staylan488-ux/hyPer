import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, LogOut, Pencil, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, Input, Modal, Screen, ThemeToggle } from '@/components/shared';
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

function SettingsGroup({ label, children, delay = 0 }: { label: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.section
      className="mb-5"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.smooth, delay }}
    >
      <p className="t-label-sm mb-2 px-1">{label}</p>
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-4">{children}</div>
    </motion.section>
  );
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
    <Screen>
      {/* Header */}
      <motion.header className="mb-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="t-label-sm mb-1">Account</p>
        <h1 className="t-title">{profile?.display_name || 'You'}</h1>
      </motion.header>

      {/* ── Profile ── */}
      <SettingsGroup label="Profile">
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
          <Button className="w-full mt-3" onClick={handleSaveDisplayName} loading={savingName}>
            Save name
          </Button>
        )}
        {nameMessage && <p className="mt-2 text-[11px] font-semibold text-[var(--color-sage)]">{nameMessage}</p>}
        {nameError && <p className="mt-2 text-[11px] font-semibold text-[var(--color-danger)]">{nameError}</p>}
      </SettingsGroup>

      {/* ── Appearance ── */}
      <SettingsGroup label="Appearance" delay={0.04}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Theme</p>
            <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
              {theme === 'light' ? 'Chalk paper light' : 'Charcoal rubber dark'}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </SettingsGroup>

      {/* ── Nutrition targets ── */}
      <SettingsGroup label="Nutrition targets" delay={0.08}>
        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {[
            { label: 'kcal', value: macros.calories },
            { label: 'protein', value: `${macros.protein}g` },
            { label: 'carbs', value: `${macros.carbs}g` },
            { label: 'fat', value: `${macros.fat}g` },
          ].map((cell) => (
            <div key={cell.label} className="well px-1 py-2.5 text-center">
              <p className="t-data text-[var(--color-text)]">{cell.value}</p>
              <p className="t-label-sm text-[9px] mt-0.5">{cell.label}</p>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pressable w-full flex items-center gap-3 px-3.5 py-3 rounded-[var(--radius-md)] bg-sage-tint border border-[color-mix(in_srgb,var(--color-sage)_28%,transparent)] text-left mb-3"
          onClick={() => {
            clearMacroFeedback();
            setShowNutritionWizard(true);
          }}
        >
          <Wand2 className="w-4 h-4 shrink-0 text-[var(--color-sage)]" strokeWidth={1.75} />
          <span>
            <span className="block text-[13px] font-semibold text-[var(--color-text)]">Calculate my targets</span>
            <span className="block text-[11px] text-[var(--color-muted)] mt-0.5">A short guided pass — body stats to macros</span>
          </span>
        </button>

        <div className="grid grid-cols-2 gap-2.5 mb-3">
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

        {macrosChanged && (
          <Button className="w-full" onClick={handleSaveMacros} loading={savingMacros}>
            Save targets
          </Button>
        )}
        {macroMessage && <p className="mt-2 text-[11px] font-semibold text-[var(--color-sage)]">{macroMessage}</p>}
        {macroError && <p className="mt-2 text-[11px] font-semibold text-[var(--color-danger)]">{macroError}</p>}
      </SettingsGroup>

      {/* ── Saved meals ── */}
      <SettingsGroup label="Saved meals" delay={0.12}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Reusable meals</p>
            <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{savedMealsCountLabel}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={openManageMeals}>
            Manage
          </Button>
        </div>
      </SettingsGroup>

      {/* ── Account ── */}
      <SettingsGroup label="Account" delay={0.16}>
        <button
          type="button"
          className="pressable w-full flex items-center justify-center gap-2 min-h-11 rounded-[var(--radius-md)] text-sm font-semibold text-[var(--color-danger)] bg-rose-tint"
          onClick={handleSignOut}
        >
          <LogOut className="w-4 h-4" strokeWidth={2} />
          Sign out
        </button>
      </SettingsGroup>

      {/* App info */}
      <motion.footer
        className="mt-10 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...springs.smooth, delay: 0.2 }}
      >
        <p className="t-display text-[1.25rem] text-[var(--color-text-dim)]">hyPer</p>
        <p className="text-[10px] font-medium text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)] mt-1">
          Built on peer-reviewed research
        </p>
      </motion.footer>

      {/* Macro calculator — focused sheet */}
      <Modal
        isOpen={showNutritionWizard}
        onClose={() => setShowNutritionWizard(false)}
        title="Calculate targets"
      >
        <div className="pt-1 pb-2">
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
              setMacroMessage('Targets calculated — review and save.');
            }}
            onCancel={() => setShowNutritionWizard(false)}
          />
        </div>
      </Modal>

      {/* Saved meals manager */}
      <Modal isOpen={manageMealsOpen} onClose={closeManageMeals} title="Saved meals">
        <div className="pt-1 pb-2 space-y-3">
          {mealManagerMessage && <p className="text-[11px] font-semibold text-[var(--color-sage)]">{mealManagerMessage}</p>}
          {mealManagerError && <p className="text-[11px] font-semibold text-[var(--color-danger)]">{mealManagerError}</p>}

          {loadingSavedMeals ? (
            <div className="space-y-2">
              <div className="h-[56px] rounded-[var(--radius-md)] shimmer" />
              <div className="h-[56px] rounded-[var(--radius-md)] shimmer" />
              <div className="h-[56px] rounded-[var(--radius-md)] shimmer" />
            </div>
          ) : savedMeals.length === 0 ? (
            <p className="text-sm italic text-[var(--color-text-dim)] text-center py-8">
              Meals you save from the food logger will appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {savedMeals.map((meal) => (
                <div
                  key={meal.id}
                  className="px-3.5 py-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hairline"
                >
                  {editingMealId === meal.id ? (
                    <div className="space-y-3">
                      <Input
                        label="Meal name"
                        value={editingMealDraft.name}
                        onChange={(e) => setEditingMealDraft({ ...editingMealDraft, name: e.target.value })}
                      />
                      <div className="grid grid-cols-2 gap-2.5">
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">{meal.name}</p>
                        <p className="t-data-sm text-[10px] text-[var(--color-muted)] mt-0.5">
                          {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                        </p>
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => beginEditingMeal(meal)}
                          className="pressable p-2.5 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                          aria-label={`Edit ${meal.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSavedMeal(meal)}
                          className="pressable p-2.5 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-colors"
                          aria-label={`Remove ${meal.name}`}
                        >
                          <Archive className="w-3.5 h-3.5" strokeWidth={1.75} />
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
    </Screen>
  );
}
