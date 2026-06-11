import { useMemo, useEffect, useState, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, UtensilsCrossed, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, EmptyState, MacroBar, Modal, Screen, Toast } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { FoodLogger } from '@/components/nutrition/FoodLogger';
import { getLogDate, getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
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

const MEAL_TONES: Record<string, string> = {
  breakfast: 'var(--color-accent)',
  lunch: 'var(--color-sage)',
  dinner: 'var(--color-rose)',
  snack: 'var(--color-stone)',
};

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
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [editingEntry, setEditingEntry] = useState<NutritionLogEntry | null>(null);
  const [showMonthSheet, setShowMonthSheet] = useState(false);

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

  const pickDate = (day: Date) => {
    setSelectedDate(day);
    setWeekAnchor(day);
    if (!isSameMonth(day, selectedMonth)) {
      setSelectedMonth(startOfMonth(day));
    }
  };

  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);
  const weekStart = useMemo(() => startOfWeek(weekAnchor), [weekAnchor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
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
    if (!meal) return null;
    return meal.charAt(0).toUpperCase() + meal.slice(1);
  };

  const remainingKcal = Math.max(0, Math.round((macroTarget?.calories || 2000) - dayTotals.calories));

  return (
    <Screen>
      <Toast show={showSuccess} message="Entry saved" />

      {/* Header */}
      <motion.header
        className="mb-5 flex items-start justify-between gap-3"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.smooth}
      >
        <div className="min-w-0">
          <p className="t-label-sm mb-1">{isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE')} · {format(selectedDate, 'MMM d')}</p>
          <h1 className="t-title">Fuel</h1>
        </div>
        {!loading && (
          <div className="text-right shrink-0 pt-0.5">
            <p className="t-data-lg text-[var(--color-text)]">{remainingKcal.toLocaleString()}</p>
            <p className="t-label-sm text-[10px]">kcal left</p>
          </div>
        )}
      </motion.header>

      {/* Macro strips */}
      <motion.section
        className="panel p-4 mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.04 }}
      >
        <MacroBar
          label="Calories"
          current={dayTotals.calories}
          target={macroTarget?.calories || 2000}
          tone="amber"
          loading={loading}
          className="mb-3.5"
        />
        <div className="grid grid-cols-3 gap-3">
          <MacroBar label="Protein" current={dayTotals.protein} target={macroTarget?.protein || 150} unit="g" tone="sage" size="sm" loading={loading} />
          <MacroBar label="Carbs" current={dayTotals.carbs} target={macroTarget?.carbs || 200} unit="g" tone="stone" size="sm" loading={loading} />
          <MacroBar label="Fat" current={dayTotals.fat} target={macroTarget?.fat || 65} unit="g" tone="stone" size="sm" loading={loading} />
        </div>
      </motion.section>

      {/* Primary action */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.smooth, delay: 0.08 }}>
        <Button
          size="lg"
          className="w-full mb-4"
          onClick={() => {
            setEditingEntry(null);
            setShowLogger(true);
          }}
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.5} />
          Log food
        </Button>
      </motion.div>

      {/* Week strip + month jump */}
      <motion.section
        className="mb-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.12 }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous week"
            className="pressable p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)]"
            onClick={() => setWeekAnchor((current) => addDays(current, -7))}
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
          </button>

          <div className="grid grid-cols-7 gap-1 flex-1">
            {weekDays.map((day) => {
              const key = getDateKey(day);
              const isSelected = isSameDay(day, selectedDate);
              const hasLogs = (logsByDay[key] || []).length > 0;
              const dayIsToday = isToday(day);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pickDate(day)}
                  className={`relative flex flex-col items-center gap-0.5 rounded-[var(--radius-sm)] py-2 border transition-colors ${
                    isSelected
                      ? 'bg-[var(--color-text)] border-transparent'
                      : dayIsToday
                        ? 'bg-[var(--color-surface-2)] border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)]'
                  }`}
                >
                  <span className={`text-[9px] font-semibold uppercase ${isSelected ? 'text-[var(--color-base)]' : 'text-[var(--color-muted)]'}`}>
                    {format(day, 'EEEEE')}
                  </span>
                  <span className={`t-data-sm ${isSelected ? 'text-[var(--color-base)] font-semibold' : 'text-[var(--color-text-dim)]'}`}>
                    {format(day, 'd')}
                  </span>
                  <span
                    className={`w-1 h-1 rounded-full ${hasLogs ? '' : 'opacity-0'}`}
                    style={{ backgroundColor: isSelected ? 'var(--color-base)' : 'var(--color-sage)' }}
                  />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Next week"
            className="pressable p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)]"
            onClick={() => setWeekAnchor((current) => addDays(current, 7))}
          >
            <ChevronRight className="w-4 h-4" strokeWidth={2} />
          </button>

          <button
            type="button"
            aria-label="Open month calendar"
            className="pressable p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            onClick={() => setShowMonthSheet(true)}
          >
            <CalendarDays className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </motion.section>

      {/* Timeline */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.smooth, delay: 0.16 }}>
        {loading ? (
          <div className="panel p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="shimmer h-8 w-12" />
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-3.5 w-2/3" />
                  <div className="shimmer h-2.5 w-1/3" />
                </div>
                <div className="shimmer h-3.5 w-12" />
              </div>
            ))}
          </div>
        ) : selectedDayLogs.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="Nothing logged yet"
            body={isToday(selectedDate) ? 'Your first entry sets the tone for the day.' : `No entries on ${format(selectedDate, 'MMM d')}.`}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setEditingEntry(null);
                  setShowLogger(true);
                }}
              >
                <Plus className="w-4 h-4" strokeWidth={2.25} />
                Add entry
              </Button>
            }
          />
        ) : (
          <div className="panel px-4 py-2">
            <div className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)]">
              <span className="t-label-sm">Timeline</span>
              <span className="t-data-sm text-[var(--color-muted)]">
                {selectedDayLogs.length} {selectedDayLogs.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <AnimatePresence>
              {selectedDayLogs.map((log, index) => {
                const tone = log.meal_type ? MEAL_TONES[log.meal_type] : 'var(--color-muted)';
                const tagLabel = mealTagLabel(log.meal_type);

                return (
                  <motion.div
                    key={log.id}
                    className="flex items-center gap-3 py-3 border-b border-[var(--color-border-soft)] last:border-0"
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
                      delay: deletedId === log.id ? 0 : Math.min(index * 0.03, 0.25),
                    }}
                  >
                    {/* meal tick */}
                    <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ backgroundColor: tone }} />

                    <div className="w-14 shrink-0">
                      <p className="t-data-sm text-[var(--color-text-dim)]">{format(getLogDate(log), 'h:mm a')}</p>
                      {tagLabel && (
                        <p className="text-[9px] font-semibold uppercase tracking-[0.06em] mt-0.5" style={{ color: tone }}>
                          {tagLabel}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{log.food?.name || 'Unknown Food'}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">
                        {log.servings} serving{log.servings !== 1 ? 's' : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="t-data-sm text-[var(--color-text)]">
                        {Math.round((log.food?.calories || 0) * log.servings)} <span className="text-[10px] text-[var(--color-muted)]">kcal</span>
                      </p>
                      <p className="t-data-sm text-[10px] text-[var(--color-muted)]">{Math.round((log.food?.protein || 0) * log.servings)}g P</p>
                    </div>

                    <div className="flex shrink-0 -mr-1">
                      <motion.button
                        className="p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                        onClick={() => {
                          setEditingEntry(log);
                          setShowLogger(true);
                        }}
                        aria-label="Edit entry"
                        whileTap={{ scale: 0.9 }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </motion.button>
                      <motion.button
                        className="p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)] hover:text-[var(--color-danger)] transition-colors"
                        onClick={() => handleDeleteEntry(log.id)}
                        aria-label="Remove entry"
                        whileTap={{ scale: 0.9 }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.section>

      {/* Month jump sheet */}
      <Modal isOpen={showMonthSheet} onClose={() => setShowMonthSheet(false)} title="Jump to date">
        <div className="pt-1 pb-2">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelectedMonth((prev) => subMonths(prev, 1))}
              className="pressable p-2.5 rounded-[var(--radius-sm)] text-[var(--color-muted)]"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            </button>
            <span className="t-heading">{format(selectedMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
              className="pressable p-2.5 rounded-[var(--radius-sm)] text-[var(--color-muted)]"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={`${d}-${i}`} className="t-label-sm text-center py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const hasLogs = (logsByDay[key] || []).length > 0;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    pickDate(day);
                    setShowMonthSheet(false);
                  }}
                  className={`relative h-10 rounded-[var(--radius-sm)] t-data-sm transition-colors ${
                    isSelected
                      ? 'bg-[var(--color-text)] text-[var(--color-base)] font-semibold'
                      : inMonth
                        ? 'text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)]'
                        : 'text-[var(--color-muted)]'
                  }`}
                >
                  {format(day, 'd')}
                  {hasLogs && !isSelected && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[var(--color-sage)]" />
                  )}
                  {isToday(day) && !isSelected && (
                    <span className="absolute left-1/2 -translate-x-1/2 top-1 w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Logger sheet */}
      <Modal
        isOpen={showLogger}
        onClose={() => {
          setShowLogger(false);
          setEditingEntry(null);
        }}
        title={editingEntry ? 'Edit entry' : 'Log food'}
      >
        <FoodLogger
          selectedDate={selectedDate}
          initialEntry={editingEntry}
          onComplete={handleLogComplete}
        />
      </Modal>
    </Screen>
  );
}
