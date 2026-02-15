import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dumbbell, UtensilsCrossed, TrendingUp, ArrowRight, History } from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Card, CardTitle } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { MacroGauge } from '@/components/dashboard/MacroGauge';
import { VolumeChart } from '@/components/dashboard/VolumeChart';
import { DashboardMonolithIntro } from '@/components/intro/DashboardMonolithIntro';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function Dashboard() {
  const { profile } = useAuthStore();
  const {
    activeSplit,
    currentWorkout,
    macroTarget,
    weeklyVolume,
    fetchMacroTarget,
    fetchVolumeLandmarks,
    calculateWeeklyVolume,
    fetchSplits,
    fetchCurrentWorkout
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });

  const fetchNutritionTotals = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = format(new Date(), 'yyyy-MM-dd');

      const { data: logs, error: logsError } = await supabase
        .from('nutrition_logs')
        .select('food_id, servings')
        .eq('user_id', user.id)
        .eq('date', today);

      if (logsError || !logs || logs.length === 0) {
        setNutritionTotals({ calories: 0, protein: 0, carbs: 0, fat: 0 });
        return;
      }

      const foodIds = [...new Set(logs.map((log) => log.food_id))];

      const { data: foods } = await supabase
        .from('foods')
        .select('id, calories, protein, carbs, fat')
        .in('id', foodIds);

      if (!foods) return;

      const foodMap = new Map(foods.map((food) => [food.id, food]));

      const totals = logs.reduce((acc, log) => {
        const food = foodMap.get(log.food_id);
        if (!food) return acc;

        return {
          calories: acc.calories + (food.calories || 0) * log.servings,
          protein: acc.protein + (food.protein || 0) * log.servings,
          carbs: acc.carbs + (food.carbs || 0) * log.servings,
          fat: acc.fat + (food.fat || 0) * log.servings,
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      setNutritionTotals(totals);
    } catch (error) {
      console.error('Error fetching nutrition totals:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      await Promise.all([
        fetchSplits(),
        fetchMacroTarget(),
        fetchVolumeLandmarks(),
        calculateWeeklyVolume(),
        fetchCurrentWorkout(),
        fetchNutritionTotals(),
      ]);
      setLoading(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [calculateWeeklyVolume, fetchCurrentWorkout, fetchMacroTarget, fetchNutritionTotals, fetchSplits, fetchVolumeLandmarks]);

  return (
    <>
      <motion.div
        className="pb-24 px-5 pt-8"
      >
      {/* Header */}
      <motion.header className="mb-12" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
          {activeSplit ? activeSplit.name.toUpperCase() : 'NO PROGRAM ACTIVE'}
        </p>
        <h1 className="text-4xl font-display-italic text-[#E8E4DE] tracking-tight">
          {profile?.display_name ? `Welcome, ${profile.display_name}` : 'Welcome Back'}
        </h1>
        <p className="text-body text-dim mt-2">{format(new Date(), 'EEEE, MMMM d')}</p>
      </motion.header>

      {/* Quick Actions */}
      <motion.div className="grid grid-cols-2 gap-3 mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Link to="/workout">
          <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }} transition={springs.snappy}>
            <Card variant="slab" className="flex flex-col items-center justify-center py-6 hover:border-white/10 transition-all cursor-pointer group bg-accent-tint border-l-accent">
              <motion.div
                className="p-4 rounded-[20px] bg-[#2E2E2E] mb-3 group-hover:bg-[#383838] transition-colors"
                whileHover={{ rotate: -12 }}
                transition={springs.bouncy}
              >
                <Dumbbell className="w-5 h-5 text-[#E8E4DE]" strokeWidth={1.5} />
              </motion.div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                {currentWorkout ? 'Continue' : 'Begin'}
              </p>
            </Card>
          </motion.div>
        </Link>

        <Link to="/nutrition">
          <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }} transition={springs.snappy}>
            <Card variant="slab" className="flex flex-col items-center justify-center py-6 hover:border-white/10 transition-all cursor-pointer group bg-sage-tint border-l-sage">
              <motion.div
                className="p-4 rounded-[20px] bg-[#2E2E2E] mb-3 group-hover:bg-[#383838] transition-colors"
                whileHover={{ rotate: 12 }}
                transition={springs.bouncy}
              >
                <UtensilsCrossed className="w-5 h-5 text-[#E8E4DE]" strokeWidth={1.5} />
              </motion.div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                Nutrition
              </p>
            </Card>
          </motion.div>
        </Link>

        <Link to="/history" className="col-span-2">
          <motion.div whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }} transition={springs.snappy}>
            <Card variant="slab" className="flex items-center justify-center py-4 hover:border-white/10 transition-all cursor-pointer group border-l-rose">
              <div className="p-3 rounded-[16px] bg-[#2E2E2E] mr-3 group-hover:bg-[#383838] transition-colors">
                <History className="w-4 h-4 text-[#E8E4DE]" strokeWidth={1.5} />
              </div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                Training History
              </p>
            </Card>
          </motion.div>
        </Link>
      </motion.div>

      {/* Daily Macros */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-center justify-between mb-4">
          <CardTitle>Today's Intake</CardTitle>
        </div>
        {/* Calories - full width hero */}
        <div className="mb-4">
          <MacroGauge
            label="CALORIES"
            current={nutritionTotals.calories}
            target={macroTarget?.calories || 2000}
            unit=" kcal"
            color="default"
            variant="hero"
            loading={loading}
          />
        </div>
        {/* Protein, Carbs, Fat - 3 columns */}
        <div className="grid grid-cols-3 gap-4">
          <MacroGauge
            label="PROTEIN"
            current={nutritionTotals.protein}
            target={macroTarget?.protein || 150}
            unit="g"
            color="accent"
            variant="hero"
            loading={loading}
          />
          <MacroGauge
            label="CARBS"
            current={nutritionTotals.carbs}
            target={macroTarget?.carbs || 200}
            unit="g"
            color="sage"
            variant="hero"
            loading={loading}
          />
          <MacroGauge
            label="FAT"
            current={nutritionTotals.fat}
            target={macroTarget?.fat || 65}
            unit="g"
            color="rose"
            variant="hero"
            loading={loading}
          />
        </div>
      </motion.div>

      {/* Weekly Volume */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <CardTitle>Weekly Volume</CardTitle>
            <Link
              to="/analysis"
              className="flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] transition-colors"
            >
              Details
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            <div className="flex items-end gap-3 h-32">
              <div className="shimmer flex-1 h-[60%]" />
              <div className="shimmer flex-1 h-[85%]" />
              <div className="shimmer flex-1 h-[45%]" />
            </div>
          ) : (
            <VolumeChart volumeData={weeklyVolume} />
          )}
        </Card>
      </motion.div>

      {/* Recommendations */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-[#C4A484]" strokeWidth={1.5} />
            <CardTitle>Insights</CardTitle>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0 pl-3">
                  <div className="flex-1">
                    <div className="shimmer h-3.5 w-24 mb-2" />
                    <div className="shimmer h-5 w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {weeklyVolume.length === 0 ? (
                <p className="text-editorial">
                  Complete a workout to receive personalized volume recommendations based on your training landmarks.
                </p>
              ) : (
                weeklyVolume.slice(0, 3).map((mv, index) => (
                  <motion.div
                    key={mv.muscle_group}
                    className="flex items-center justify-between py-3 border-b border-white/5 last:border-0 border-l-4 pl-3"
                    style={{ borderLeftColor: getVolumeStatusColor(mv.status) }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.08, ...springs.smooth }}
                  >
                    <div>
                      <p className="text-body text-[#E8E4DE] capitalize">
                        {mv.muscle_group.replace('_', ' ')}
                      </p>
                      <p className="number-medium text-[#9A9A9A] tabular-nums">
                        {mv.weekly_sets} <span className="text-[10px] uppercase tracking-wider">sets/wk</span>
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          )}
        </Card>
      </motion.div>
      </motion.div>
      <DashboardMonolithIntro />
    </>
  );
}

function getVolumeStatusColor(status: string): string {
  switch (status) {
    case 'below_mev':
      return '#8B6B6B';
    case 'mev_mav':
      return '#A68B6B';
    case 'mav':
      return '#8B9A7D';
    case 'approaching_mrv':
      return '#9A8B7D';
    case 'above_mrv':
      return '#7D6B6B';
    default:
      return '#6B6B6B';
  }
}
