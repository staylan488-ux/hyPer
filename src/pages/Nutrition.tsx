import { useMemo, useEffect, useState, useCallback } from 'react';
import { Plus, Check, X, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardTitle, Modal } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { FoodLogger } from '@/components/nutrition/FoodLogger';
import { getLogDate, getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
import { MacroGauge } from '@/components/dashboard/MacroGauge';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

interface NutritionLogEntry {
  id: string;
  user_id: string;
  date: string;
  logged_at: string | null;
  created_at?: string | null;
  food_id: string;
  servings: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  food: {
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

function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildCalendarDays(baseDate: Date): Date[] {
  const monthStart = startOfMonth(baseDate);
  const monthEnd = endOfMonth(baseDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = startDate;
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

export function Nutrition() {
  const { macroTarget, fetchMacroTarget } = useAppStore();
  const [showLogger, setShowLogger] = useState(false);
  const [monthLogs, setMonthLogs] = useState<NutritionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [editingEntry, setEditingEntry] = useState<NutritionLogEntry | null>(null);
  const [monthDirection, setMonthDirection] = useState(0);

  const fetchMonthLogs = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const from = format(startOfMonth(month), 'yyyy-MM-dd');
      const to = format(endOfMonth(month), 'yyyy-MM-dd');

      const { data: logs, error: logsError } = await supabase
        .from('nutrition_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', from)
        .lte('date', to);

      if (logsError) {
        console.error('Error fetching logs:', logsError);
        setLoading(false);
        return;
      }

      if (!logs || logs.length === 0) {
        setMonthLogs([]);
        setLoading(false);
        return;
      }

      const foodIds = [...new Set(logs.map((log) => log.food_id))];
      const { data: foods, error: foodsError } = await supabase
        .from('foods')
        .select('id, name, calories, protein, carbs, fat, serving_size, serving_unit')
        .in('id', foodIds);

      if (foodsError) {
        console.error('Error fetching foods:', foodsError);
      }

      const foodMap = new Map((foods || []).map((food) => [food.id, food]));
      const mergedLogs: NutritionLogEntry[] = logs.map((log) => ({
        ...log,
        food: foodMap.get(log.food_id) || null,
      }));

      setMonthLogs(mergedLogs);
    } catch (error) {
      console.error('Error fetching nutrition logs:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMacroTarget();
  }, [fetchMacroTarget]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMonthLogs(selectedMonth);
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchMonthLogs, selectedMonth]);

  const handleLogComplete = () => {
    setShowLogger(false);
    setEditingEntry(null);
    fetchMonthLogs(selectedMonth);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const handleDeleteEntry = async (logId: string) => {
    setDeletedId(logId);
    try {
      const { error } = await supabase.from('nutrition_logs').delete().eq('id', logId);
      if (error) {
        console.error('Error deleting entry:', error);
        setDeletedId(null);
      } else {
        setTimeout(() => {
          setMonthLogs((prev) => prev.filter((log) => log.id !== logId));
          setDeletedId(null);
        }, 300);
      }
    } catch (error) {
      console.error('Error deleting entry:', error);
      setDeletedId(null);
    }
  };

  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);
  const selectedDateKey = getDateKey(selectedDate);

  const selectedDayLogs = useMemo(() => {
    return monthLogs
      .filter((log) => log.date === selectedDateKey)
      .sort((a, b) => getLogTimestamp(a) - getLogTimestamp(b));
  }, [monthLogs, selectedDateKey]);

  const dayTotals = useMemo(
    () =>
      selectedDayLogs.reduce(
        (acc, log) => {
          const food = log.food;
          return {
            calories: acc.calories + (food?.calories || 0) * log.servings,
            protein: acc.protein + (food?.protein || 0) * log.servings,
            carbs: acc.carbs + (food?.carbs || 0) * log.servings,
            fat: acc.fat + (food?.fat || 0) * log.servings,
          };
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [selectedDayLogs]
  );

  const logsByDay = useMemo(() => {
    return monthLogs.reduce<Record<string, NutritionLogEntry[]>>((acc, log) => {
      if (!acc[log.date]) acc[log.date] = [];
      acc[log.date].push(log);
      return acc;
    }, {});
  }, [monthLogs]);

  const mealTagLabel = (meal?: string | null) => {
    if (!meal) return 'No tag';
    return meal.charAt(0).toUpperCase() + meal.slice(1);
  };

  return (
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            className="fixed safe-area-top-offset left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-[#8B9A7D] text-[#1A1A1A] rounded-[20px] text-xs tracking-wider shadow-lg"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={springs.smooth}
          >
            <Check className="w-4 h-4" />
            Entry Saved
          </motion.div>
        )}
      </AnimatePresence>

      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
          {format(selectedDate, 'EEEE').toUpperCase()}
        </p>
        <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Nutrition</h1>
        <p className="text-xs text-[#6B6B6B] mt-1">{format(selectedDate, 'MMMM d, yyyy')}</p>
      </motion.header>

      <motion.div className="mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <CardTitle className="mb-4">Daily Intake</CardTitle>
        <div className="grid grid-cols-4 gap-2">
          <MacroGauge label="KCAL" current={dayTotals.calories} target={macroTarget?.calories || 2000} unit="" color="default" loading={loading} />
          <MacroGauge label="PROTEIN" current={dayTotals.protein} target={macroTarget?.protein || 150} unit="g" color="accent" loading={loading} />
          <MacroGauge label="CARBS" current={dayTotals.carbs} target={macroTarget?.carbs || 200} unit="g" color="default" loading={loading} />
          <MacroGauge label="FAT" current={dayTotals.fat} target={macroTarget?.fat || 65} unit="g" color="default" loading={loading} />
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <motion.button
              onClick={() => {
                setMonthDirection(-1);
                setSelectedMonth((prev) => subMonths(prev, 1));
              }}
              className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
              whileTap={{ scale: 0.9, x: -2 }}
            >
              <ChevronLeft className="w-4 h-4 text-[#9A9A9A]" />
            </motion.button>
            <AnimatePresence mode="wait">
              <motion.h3
                key={format(selectedMonth, 'yyyy-MM')}
                className="text-xs tracking-[0.15em] uppercase text-[#E8E4DE]"
                initial={{ opacity: 0, x: monthDirection * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: monthDirection * -20 }}
                transition={{ duration: 0.2 }}
              >
                {format(selectedMonth, 'MMMM yyyy')}
              </motion.h3>
            </AnimatePresence>
            <motion.button
              onClick={() => {
                setMonthDirection(1);
                setSelectedMonth((prev) => addMonths(prev, 1));
              }}
              className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
              whileTap={{ scale: 0.9, x: 2 }}
            >
              <ChevronRight className="w-4 h-4 text-[#9A9A9A]" />
            </motion.button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <div key={`${day}-${i}`} className="text-center text-[10px] text-[#6B6B6B] py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const dayLogs = logsByDay[key] || [];
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const isTodayDate = isToday(day);

              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedDate(day);
                    if (!isSameMonth(day, selectedMonth)) {
                      setSelectedMonth(startOfMonth(day));
                    }
                  }}
                  className={`h-10 rounded-[12px] text-xs tabular-nums transition-all relative ${
                    isSelected
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : inMonth
                      ? 'text-[#E8E4DE] hover:bg-white/5 active:bg-white/10'
                      : 'text-[#5A5A5A] hover:bg-white/5 active:bg-white/10'
                  } ${isTodayDate && !isSelected ? 'ring-1 ring-[#C4A484]/30' : ''}`}
                >
                  {isSelected && (
                    <motion.div
                      className="absolute inset-0 bg-[#E8E4DE] rounded-[12px]"
                      layoutId="calendar-day-selected"
                      transition={springs.smooth}
                    />
                  )}
                  <span className="relative z-10">{format(day, 'd')}</span>
                  {dayLogs.length > 0 && (
                    <motion.span
                      className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full z-10 ${
                        isSelected ? 'bg-[#1A1A1A]' : 'bg-[#8B9A7D]'
                      }`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={springs.bouncy}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {loading ? (
        <div className="text-center py-8 text-[#6B6B6B] text-xs tracking-wider">Loading...</div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <Card variant="slab">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">Day Timeline</h3>
                <p className="text-xs text-[#6B6B6B] mt-1">{selectedDayLogs.length} entries</p>
              </div>
              <motion.button
                className="px-3 py-2 rounded-[14px] bg-[#2E2E2E] hover:bg-[#383838] text-[10px] tracking-[0.1em] uppercase text-[#E8E4DE] transition-colors"
                onClick={() => {
                  setEditingEntry(null);
                  setShowLogger(true);
                }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus className="w-3 h-3 inline-block mr-1" />
                Add
              </motion.button>
            </div>

            {selectedDayLogs.length === 0 ? (
              <motion.button
                className="w-full py-8 rounded-[20px] border border-dashed border-white/10 hover:border-white/20 hover:text-[#9A9A9A] transition-colors"
                onClick={() => {
                  setEditingEntry(null);
                  setShowLogger(true);
                }}
                whileTap={{ scale: 0.98 }}
              >
                <p className="text-editorial mb-2">Nothing logged yet.</p>
                <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">
                  <Plus className="w-3 h-3 inline-block mr-1" />
                  Add First Entry
                </p>
              </motion.button>
            ) : (
              <div className="space-y-1">
                <AnimatePresence>
                  {selectedDayLogs.map((log, index) => {
                    const mealTypeColors = {
                      breakfast: '#C4A484',
                      lunch: '#8B9A7D',
                      dinner: '#A68B8B',
                      snack: '#8B8580',
                    };
                    const borderColor = log.meal_type ? mealTypeColors[log.meal_type] : '#6B6B6B';

                    return (
                    <motion.div
                      key={log.id}
                      className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0 border-l-[3px] pl-3"
                      style={{ borderLeftColor: borderColor }}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{
                        opacity: deletedId === log.id ? 0 : 1,
                        x: deletedId === log.id ? 60 : 0,
                        y: 0,
                        height: deletedId === log.id ? 0 : 'auto',
                      }}
                      exit={{ opacity: 0, x: 60, height: 0 }}
                      transition={{
                        ...springs.smooth,
                        delay: deletedId === log.id ? 0 : index * 0.04,
                      }}
                    >
                      <div className="w-14 text-center">
                        <p className="text-[11px] tabular-nums text-[#9A9A9A]">
                          {format(getLogDate(log), 'hh:mm a')}
                        </p>
                        <p className="text-[9px] uppercase tracking-[0.1em] text-[#6B6B6B]">{mealTagLabel(log.meal_type)}</p>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#E8E4DE] truncate">{log.food?.name || 'Unknown Food'}</p>
                        <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">
                          {log.servings} serving{log.servings !== 1 ? 's' : ''}
                        </p>
                      </div>

                      <div className="text-right tabular-nums">
                        <p className="text-xs text-[#9A9A9A]">
                          {Math.round((log.food?.calories || 0) * log.servings)} <span className="text-[9px] text-[#6B6B6B]">kcal</span>
                        </p>
                        <p className="text-[10px] text-[#6B6B6B]">{Math.round((log.food?.protein || 0) * log.servings)}g P</p>
                      </div>

                      <motion.button
                        className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 text-[#6B6B6B] hover:text-[#9A9A9A] active:text-[#E8E4DE] transition-colors"
                        onClick={() => {
                          setEditingEntry(log);
                          setShowLogger(true);
                        }}
                        title="Edit entry"
                        whileTap={{ scale: 0.9 }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </motion.button>

                      <motion.button
                        className="p-2 rounded-[12px] hover:bg-[#8B6B6B]/20 text-[#6B6B6B] hover:text-[#8B6B6B] transition-colors"
                        onClick={() => handleDeleteEntry(log.id)}
                        title="Remove entry"
                        whileTap={{ scale: 0.9 }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </motion.button>
                    </motion.div>
                  )})}
                </AnimatePresence>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      <Modal
        isOpen={showLogger}
        onClose={() => {
          setShowLogger(false);
          setEditingEntry(null);
        }}
        title={editingEntry ? 'Edit Entry' : 'Log Entry'}
      >
        <FoodLogger
          selectedDate={selectedDate}
          initialEntry={editingEntry}
          onComplete={handleLogComplete}
        />
      </Modal>
    </motion.div>
  );
}
