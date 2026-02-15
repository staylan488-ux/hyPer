import { useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { springs } from '@/lib/animations';
import type { WorkoutSet } from '@/types';

interface SetLoggerProps {
  set: WorkoutSet;
  setNumber: number;
  onComplete?: () => void;
}

export function SetLogger({ set, setNumber, onComplete }: SetLoggerProps) {
  const { logSet } = useAppStore();
  const [weight, setWeight] = useState(set.weight?.toString() || '');
  const [reps, setReps] = useState(set.reps?.toString() || '');
  const [rpe, setRpe] = useState(set.rpe?.toString() || '');
  const [isEditing, setIsEditing] = useState(!set.completed);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!weight || !reps || saving) return;

    try {
      setSaving(true);
      await logSet(
        set.exercise_id,
        set.set_number,
        parseFloat(weight),
        parseInt(reps),
        rpe ? parseFloat(rpe) : undefined
      );

      setIsEditing(false);
      onComplete?.();
    } catch (error) {
      console.error('Failed to log set:', error);
    } finally {
      setSaving(false);
    }
  };

  if (set.completed && !isEditing) {
    return (
      <motion.div
        className="flex items-center justify-between py-3 px-4 bg-[#2E2E2E] rounded-[16px]"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springs.smooth}
      >
        <div className="flex items-center gap-3">
          <motion.div
            className="w-6 h-6 rounded-[8px] bg-[#8B9A7D]/20 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.bouncy}
          >
            <svg className="w-3 h-3 text-[#8B9A7D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <motion.path
                d="M5 13l4 4L19 7"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
                strokeDasharray="0 1"
              />
            </svg>
          </motion.div>
          <span className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">Set {setNumber}</span>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums">
          <span className="text-[#E8E4DE]">{set.weight}<span className="text-[#6B6B6B] ml-1">lbs</span></span>
          <span className="text-[#E8E4DE]">{set.reps}<span className="text-[#6B6B6B] ml-1">reps</span></span>
          {set.rpe && <span className="text-[#6B6B6B]">@{set.rpe}</span>}
        </div>
        <motion.button
          className="p-2 hover:bg-white/5 rounded-[10px] transition-colors"
          onClick={() => setIsEditing(true)}
          whileTap={{ scale: 0.9 }}
        >
          <Pencil className="w-3 h-3 text-[#6B6B6B]" />
        </motion.button>
      </motion.div>
    );
  }

  return (
    <div className="py-3 px-4 bg-[#1A1A1A] rounded-[16px] border border-white/5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">Set {setNumber}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="relative">
          <input
            type="number"
            placeholder="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            disabled={saving}
            className="w-full text-center text-lg tabular-nums bg-transparent border-b border-white/10 focus:border-[#E8E4DE] outline-none py-2 text-[#E8E4DE] placeholder:text-[#6B6B6B]/40 transition-colors disabled:opacity-60"
          />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B] absolute -bottom-4 left-0 right-0 text-center">lbs</span>
        </div>
        <div className="relative">
          <input
            type="number"
            placeholder="0"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            disabled={saving}
            className="w-full text-center text-lg tabular-nums bg-transparent border-b border-white/10 focus:border-[#E8E4DE] outline-none py-2 text-[#E8E4DE] placeholder:text-[#6B6B6B]/40 transition-colors disabled:opacity-60"
          />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B] absolute -bottom-4 left-0 right-0 text-center">reps</span>
        </div>
        <div className="relative">
          <input
            type="number"
            placeholder="—"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            min="1"
            max="10"
            step="0.5"
            disabled={saving}
            className="w-full text-center text-lg tabular-nums bg-transparent border-b border-white/10 focus:border-[#E8E4DE] outline-none py-2 text-[#E8E4DE] placeholder:text-[#6B6B6B]/40 transition-colors disabled:opacity-60"
          />
          <span className="text-[9px] tracking-[0.1em] uppercase text-[#6B6B6B] absolute -bottom-4 left-0 right-0 text-center">rpe</span>
        </div>
      </div>

      <div className="pt-4">
        <Button
          variant="primary"
          className="w-full"
          onClick={handleSave}
          disabled={!weight || !reps || saving}
          loading={saving}
        >
          {!saving && <Check className="w-3 h-3 mr-2" strokeWidth={2} />}
          {saving ? 'Logging...' : 'Log Set'}
        </Button>
      </div>
    </div>
  );
}
