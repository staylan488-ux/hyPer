import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, LogOut, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { Button, Input, Modal, Screen, ThemeToggle } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { normalizeFoodName, shouldDropColumn } from '@/components/nutrition/foodLoggerUtils';
import { NutritionWizard } from '@/components/nutrition/NutritionWizard';
import { tapHaptic } from '@/lib/haptics';

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
  index,
  children,
  delay = 0,
}: {
  label: string;
  index: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      className="mt-10 pt-8 border-t border-[var(--color-border)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.smooth, delay }}
    >
      <div className="flex items-baseline justify-between mb-5">
        <span className="t-label">{label}</span>
        <span className="t-data-sm text-[var(--color-muted)]">{index}</span>
      </div>
      {children}
    </motion.section>
  );
}

export function Settings() {
  const { profile, signOut, updateDisplayName } = useAuthStore();
  const {
    macroTarget,
    fetchMacroTarget,
    updateMacroTarget,
    whoopConnection,
    fetchWhoopConnection,
    connectWhoop,
    disconnectWhoop,
    syncWhoop,
    stravaConnection,
    fetchStravaConnection,
    connectStrava,
    disconnectStrava,
    syncStrava,
  } = useAppStore();
  const theme = useThemeStore((state) => state.theme);
  const [searchParams, setSearchParams] = useSearchParams();

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
  const [whoopBusy, setWhoopBusy] = useState(false);
  const [whoopMessage, setWhoopMessage] = useState<string | null>(null);
  const [whoopError, setWhoopError] = useState<string | null>(null);
  const [stravaBusy, setStravaBusy] = useState(false);
  const [stravaMessage, setStravaMessage] = useState<string | null>(null);
  const [stravaError, setStravaError] = useState<string | null>(null);

  useEffect(() => {
    fetchMacroTarget();
  }, [fetchMacroTarget]);

  useEffect(() => {
    void fetchWhoopConnection();
    void fetchStravaConnection();
  }, [fetchWhoopConnection, fetchStravaConnection]);

  // landing back from a consent screen: /settings?whoop=… or ?strava=…
  useEffect(() => {
    const whoopParam = searchParams.get('whoop');
    const stravaParam = searchParams.get('strava');
    if (!whoopParam && !stravaParam) return;

    if (whoopParam === 'connected') {
      setWhoopMessage('WHOOP connected.');
      void fetchWhoopConnection();
    } else if (whoopParam) {
      setWhoopError('WHOOP connection failed. Try again.');
    }

    if (stravaParam === 'connected') {
      setStravaMessage('Strava connected.');
      void fetchStravaConnection();
    } else if (stravaParam) {
      setStravaError('Strava connection failed. Try again.');
    }

    const next = new URLSearchParams(searchParams);
    next.delete('whoop');
    next.delete('strava');
    setSearchParams(next, { replace: true });
  }, [fetchWhoopConnection, fetchStravaConnection, searchParams, setSearchParams]);

  const clearWhoopFeedback = () => {
    setWhoopMessage(null);
    setWhoopError(null);
  };

  const handleWhoopConnect = async () => {
    clearWhoopFeedback();
    setWhoopBusy(true);
    try {
      const authorizeUrl = await connectWhoop();
      if (authorizeUrl) {
        // production: hand the browser to WHOOP's consent screen
        window.location.href = authorizeUrl;
        return;
      }
      setWhoopMessage('WHOOP connected.');
    } catch (error) {
      console.error('Error connecting WHOOP:', error);
      setWhoopError('Could not start the WHOOP connection.');
    } finally {
      setWhoopBusy(false);
    }
  };

  const handleWhoopDisconnect = async () => {
    clearWhoopFeedback();
    setWhoopBusy(true);
    try {
      await disconnectWhoop();
      setWhoopMessage('WHOOP disconnected.');
    } catch (error) {
      console.error('Error disconnecting WHOOP:', error);
      setWhoopError('Could not disconnect WHOOP.');
    } finally {
      setWhoopBusy(false);
    }
  };

  const handleWhoopSyncNow = async () => {
    clearWhoopFeedback();
    setWhoopBusy(true);
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
      setWhoopBusy(false);
    }
  };

  const whoopStatusLabel = whoopConnection
    ? `Connected${whoopConnection.last_synced_at ? ` • synced ${formatDistanceToNowStrict(new Date(whoopConnection.last_synced_at), { addSuffix: true })}` : ' • never synced'}`
    : 'Not connected';

  const clearStravaFeedback = () => {
    setStravaMessage(null);
    setStravaError(null);
  };

  const handleStravaConnect = async () => {
    clearStravaFeedback();
    setStravaBusy(true);
    try {
      const authorizeUrl = await connectStrava();
      if (authorizeUrl) {
        // production: hand the browser to Strava's consent screen
        window.location.href = authorizeUrl;
        return;
      }
      setStravaMessage('Strava connected.');
    } catch (error) {
      console.error('Error connecting Strava:', error);
      setStravaError('Could not start the Strava connection.');
    } finally {
      setStravaBusy(false);
    }
  };

  const handleStravaDisconnect = async () => {
    clearStravaFeedback();
    setStravaBusy(true);
    try {
      await disconnectStrava();
      setStravaMessage('Strava disconnected.');
    } catch (error) {
      console.error('Error disconnecting Strava:', error);
      setStravaError('Could not disconnect Strava.');
    } finally {
      setStravaBusy(false);
    }
  };

  const handleStravaSyncNow = async () => {
    clearStravaFeedback();
    setStravaBusy(true);
    try {
      const result = await syncStrava();
      if (!result) {
        setStravaError('Sync unavailable.');
        return;
      }
      const changes = result.created + result.updated + result.absorbed;
      setStravaMessage(
        changes > 0
          ? `Synced — ${result.created} new, ${result.updated} updated${result.absorbed > 0 ? `, ${result.absorbed} merged` : ''}.`
          : 'Up to date.',
      );
    } catch (error) {
      console.error('Error syncing Strava:', error);
      setStravaError('Sync failed. Try again later.');
    } finally {
      setStravaBusy(false);
    }
  };

  const stravaStatusLabel = stravaConnection
    ? `Connected${stravaConnection.last_synced_at ? ` • synced ${formatDistanceToNowStrict(new Date(stravaConnection.last_synced_at), { addSuffix: true })}` : ' • never synced'}`
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
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">Account</span>
          <span className="t-label-sm">Settings</span>
        </div>
        <h1 className="t-title mt-3 pt-5 border-t border-[var(--color-text)]">{profile?.display_name || 'You'}</h1>
      </motion.header>

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
          <p className="mt-4 border-l-2 border-[var(--color-text)] pl-4 t-caption text-[var(--color-text)]">{nameMessage}</p>
        )}
        {nameError && (
          <p className="mt-4 border-l-2 border-[var(--color-accent)] pl-4 t-caption text-[var(--color-accent)]">{nameError}</p>
        )}
      </SettingsGroup>

      {/* ── Appearance ── */}
      <SettingsGroup label="Appearance" index="02" delay={0.04}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-heading">Theme</p>
            <p className="t-caption mt-1">
              {theme === 'light' ? 'Chalk paper light' : 'Charcoal rubber dark'}
            </p>
          </div>
          <ThemeToggle />
        </div>
      </SettingsGroup>

      {/* ── Nutrition targets ── */}
      <SettingsGroup label="Daily targets" index="03" delay={0.08}>
        {/* Targets as serif numerals — the data is the hero */}
        <dl>
          {[
            { label: 'Calories', value: macros.calories.toLocaleString(), unit: 'kcal' },
            { label: 'Protein', value: String(macros.protein), unit: 'g' },
            { label: 'Carbs', value: String(macros.carbs), unit: 'g' },
            { label: 'Fat', value: String(macros.fat), unit: 'g' },
          ].map((cell) => (
            <div
              key={cell.label}
              className="flex items-baseline justify-between gap-4 py-4 border-t border-[var(--color-border)]"
            >
              <dt className="t-label-sm">{cell.label}</dt>
              <dd className="flex items-baseline gap-1.5">
                <span className="number-medium text-[var(--color-text)]">{cell.value}</span>
                <span className="t-data-sm text-[var(--color-muted)]">{cell.unit}</span>
              </dd>
            </div>
          ))}
        </dl>

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

        <div className="mt-8 mb-1">
          <span className="t-label-sm">Set manually</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 mt-4">
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
          <Button className="w-full mt-6" onClick={handleSaveMacros} loading={savingMacros}>
            Save targets
          </Button>
        )}
        {macroMessage && (
          <p className="mt-4 border-l-2 border-[var(--color-text)] pl-4 t-caption text-[var(--color-text)]">{macroMessage}</p>
        )}
        {macroError && (
          <p className="mt-4 border-l-2 border-[var(--color-accent)] pl-4 t-caption text-[var(--color-accent)]">{macroError}</p>
        )}
      </SettingsGroup>

      {/* ── Saved meals ── */}
      <SettingsGroup label="Saved meals" index="04" delay={0.12}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-heading">Reusable meals</p>
            <p className="t-caption mt-1">{savedMealsCountLabel}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={openManageMeals}>
            Manage
          </Button>
        </div>
      </SettingsGroup>

      {/* ── Connected services ── */}
      <SettingsGroup label="Connected services" index="05" delay={0.16}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-heading">WHOOP</p>
            <p className="t-caption mt-1">{whoopStatusLabel}</p>
          </div>
          {whoopConnection ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={whoopBusy} onClick={() => { void handleWhoopSyncNow(); }}>
                Sync now
              </Button>
              <Button variant="ghost" size="sm" disabled={whoopBusy} onClick={() => { void handleWhoopDisconnect(); }}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" disabled={whoopBusy} onClick={() => { void handleWhoopConnect(); }}>
              Connect
            </Button>
          )}
        </div>
        {whoopMessage && <p className="t-caption mt-3">{whoopMessage}</p>}
        {whoopError && <p className="t-caption mt-3 text-[var(--color-accent)]">{whoopError}</p>}

        <div className="flex items-center justify-between gap-4 mt-8 pt-8 border-t border-[var(--color-border)]">
          <div>
            <p className="t-heading">Strava</p>
            <p className="t-caption mt-1">{stravaStatusLabel}</p>
          </div>
          {stravaConnection ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={stravaBusy} onClick={() => { void handleStravaSyncNow(); }}>
                Sync now
              </Button>
              <Button variant="ghost" size="sm" disabled={stravaBusy} onClick={() => { void handleStravaDisconnect(); }}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" disabled={stravaBusy} onClick={() => { void handleStravaConnect(); }}>
              Connect
            </Button>
          )}
        </div>
        {stravaMessage && <p className="t-caption mt-3">{stravaMessage}</p>}
        {stravaError && <p className="t-caption mt-3 text-[var(--color-accent)]">{stravaError}</p>}
      </SettingsGroup>

      {/* ── Account ── */}
      <SettingsGroup label="Session" index="06" delay={0.2}>
        <Button variant="danger" size="lg" className="w-full" onClick={handleSignOut}>
          <LogOut className="w-4 h-4" strokeWidth={1.75} />
          Sign out
        </Button>
      </SettingsGroup>

      {/* App info — colophon */}
      <motion.footer
        className="mt-12 pt-8 border-t border-[var(--color-text)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...springs.smooth, delay: 0.2 }}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="[font-family:var(--font-display)] text-[2rem] leading-none font-light tracking-[-0.04em] text-[var(--color-text-dim)]">
            hy<span className="italic text-[var(--color-accent)]">P</span>er
          </h2>
          {/* Tapping the build stamp fires a test haptic — handy for verifying device support */}
          <button
            type="button"
            onClick={() => tapHaptic()}
            className="t-data-sm text-[var(--color-muted)] py-2"
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
        <div className="pt-1 pb-2">
          {mealManagerMessage && (
            <p className="mb-4 border-l-2 border-[var(--color-text)] pl-4 t-caption text-[var(--color-text)]">{mealManagerMessage}</p>
          )}
          {mealManagerError && (
            <p className="mb-4 border-l-2 border-[var(--color-accent)] pl-4 t-caption text-[var(--color-accent)]">{mealManagerError}</p>
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
                    <div className="border-l-2 border-[var(--color-accent)] pl-5 space-y-5">
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="t-heading truncate normal-case tracking-normal text-[var(--color-text)]">{meal.name}</p>
                        <p className="t-data-sm text-[var(--color-muted)] mt-1.5">
                          {Math.round(meal.calories)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
                        </p>
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          onClick={() => beginEditingMeal(meal)}
                          className="pressable p-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                          aria-label={`Edit ${meal.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSavedMeal(meal)}
                          className="pressable p-2.5 text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
                          aria-label={`Remove ${meal.name}`}
                        >
                          <Archive className="w-3.5 h-3.5" strokeWidth={1.75} />
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
