import { useEffect, useState } from 'react';
import { LogOut, User, Target } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardTitle, Button, Input } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { springs } from '@/lib/animations';

export function Settings() {
  const { profile, signOut, updateDisplayName } = useAuthStore();
  const { macroTarget, fetchMacroTarget, updateMacroTarget } = useAppStore();

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

  useEffect(() => {
    fetchMacroTarget();
  }, [fetchMacroTarget]);

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
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Account</p>
        <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Profile</h1>
      </motion.header>

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
          {nameError && <p className="mt-2 text-[10px] tracking-[0.1em] uppercase text-[#8B6B6B]">{nameError}</p>}
        </Card>
      </motion.div>

      {/* Macro Targets */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-4 h-4 text-sage" strokeWidth={1.5} />
            <CardTitle>Daily Targets</CardTitle>
          </div>

          <div className="space-y-4">
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
            {macroError && <p className="text-[10px] tracking-[0.1em] uppercase text-[#8B6B6B]">{macroError}</p>}
          </div>
        </Card>
      </motion.div>

      {/* Sign Out */}
      <motion.div className="mt-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Button
          variant="ghost"
          className="w-full text-[#8B6B6B] hover:text-[#E8E4DE]"
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
        <p className="text-[10px] tracking-[0.15em] text-[#6B6B6B]">
          hyPer
        </p>
        <p className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]/60 mt-1">
          Built on peer-reviewed research
        </p>
      </motion.div>
    </motion.div>
  );
}
