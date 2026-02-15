import { useState } from 'react';
import { LogOut, User, Target } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardTitle, Button, Input } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { springs } from '@/lib/animations';

export function Settings() {
  const { profile, signOut } = useAuthStore();
  const { macroTarget, updateMacroTarget } = useAppStore();

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [macros, setMacros] = useState({
    calories: macroTarget?.calories || 2000,
    protein: macroTarget?.protein || 150,
    carbs: macroTarget?.carbs || 200,
    fat: macroTarget?.fat || 65,
  });

  const handleSaveMacros = async () => {
    await updateMacroTarget(macros);
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
            <User className="w-4 h-4 text-[#6B6B6B]" strokeWidth={1.5} />
            <CardTitle>Identity</CardTitle>
          </div>
          <Input
            label="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
        </Card>
      </motion.div>

      {/* Macro Targets */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-4">
          <div className="flex items-center gap-2 mb-5">
            <Target className="w-4 h-4 text-[#6B6B6B]" strokeWidth={1.5} />
            <CardTitle>Daily Targets</CardTitle>
          </div>

          <div className="space-y-4">
            <Input
              label="Calories"
              type="number"
              value={macros.calories}
              onChange={(e) => setMacros({ ...macros, calories: parseInt(e.target.value) || 0 })}
            />

            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Protein (g)"
                type="number"
                value={macros.protein}
                onChange={(e) => setMacros({ ...macros, protein: parseInt(e.target.value) || 0 })}
              />
              <Input
                label="Carbs (g)"
                type="number"
                value={macros.carbs}
                onChange={(e) => setMacros({ ...macros, carbs: parseInt(e.target.value) || 0 })}
              />
              <Input
                label="Fat (g)"
                type="number"
                value={macros.fat}
                onChange={(e) => setMacros({ ...macros, fat: parseInt(e.target.value) || 0 })}
              />
            </div>

            <Button className="w-full" onClick={handleSaveMacros}>
              Save Targets
            </Button>
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
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">
          Hypertrophy Tracker
        </p>
        <p className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B]/60 mt-1">
          Based on Chris Beardsley's Hypertrophy Research
        </p>
      </motion.div>
    </motion.div>
  );
}
