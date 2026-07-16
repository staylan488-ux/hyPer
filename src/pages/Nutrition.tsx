import { useMemo, useEffect, useState, useCallback } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileUp, Layers3, Plus, UtensilsCrossed } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, EmptyState, Modal, RailStrip, Screen, Toast } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { FoodLogger } from '@/components/nutrition/FoodLogger';
import { getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
import { CronometerImporter } from '@/components/nutrition/CronometerImporter';
import { NutritionGroupLedger } from '@/components/nutrition/NutritionGroupLedger';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';
import { legacyMealTypeForGroup, nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import type { NutritionGroup } from '@/types';
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
  group_id?: string | null;
  sort_order?: number;
  source?: string;
  external_id?: string | null;
  import_batch_id?: string | null;
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
  const [monthGroups, setMonthGroups] = useState<NutritionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [editingEntry, setEditingEntry] = useState<NutritionLogEntry | null>(null);
  const [showMonthSheet, setShowMonthSheet] = useState(false);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  const [showCronometerImport, setShowCronometerImport] = useState(false);

  const fetchMonthLogs = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const from = format(startOfMonth(month), 'yyyy-MM-dd');
      const to = format(endOfMonth(month), 'yyyy-MM-dd');

      const [logsResult, groupsResult] = await Promise.all([
        supabase
          .from('nutrition_logs')
          .select('*')
          .eq('user_id', user.id)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('nutrition_groups')
          .select('*')
          .eq('user_id', user.id)
          .gte('date', from)
          .lte('date', to)
          .order('sort_order', { ascending: true }),
      ]);
      const { data: logs, error: logsError } = logsResult;
      const { data: groups, error: groupsError } = groupsResult;

      if (groupsError) console.error('Error fetching nutrition groups:', groupsError);
      setMonthGroups((groups || []) as NutritionGroup[]);

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

  const selectedDayGroups = useMemo(
    () => sortNutritionGroups(monthGroups.filter((group) => group.date === selectedDateKey)),
    [monthGroups, selectedDateKey],
  );

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

  const createGroup = async (kind: 'meal' | 'snack', label: NutritionGroup['label']) => {
    if (label && selectedDayGroups.some((group) => group.label === label)) {
      setShowGroupSheet(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from('nutrition_groups').insert({
      user_id: user.id,
      date: selectedDateKey,
      kind,
      label,
      sort_order: selectedDayGroups.length,
    }).select('*').single();

    if (error || !data) {
      console.error('Error creating nutrition group:', error);
      return;
    }

    setMonthGroups((current) => [...current, data as NutritionGroup]);
    setShowGroupSheet(false);
  };

  const moveEntry = async (logId: string, groupId: string | null) => {
    const group = groupId ? selectedDayGroups.find((candidate) => candidate.id === groupId) || null : null;
    const nextSortOrder = selectedDayLogs.filter((log) => (log.group_id || null) === groupId).length;
    const patch = {
      group_id: groupId,
      sort_order: nextSortOrder,
      meal_type: legacyMealTypeForGroup(group),
    };
    const { error } = await supabase.from('nutrition_logs').update(patch).eq('id', logId);
    if (error) {
      console.error('Error moving nutrition entry:', error);
      return;
    }
    setMonthLogs((current) => current.map((log) => log.id === logId ? { ...log, ...patch } : log));
  };

  const deleteGroup = async (group: NutritionGroup) => {
    const name = nutritionGroupLabel(group, selectedDayGroups);
    if (!confirm(`Delete ${name}? Its foods will move to Unassigned.`)) return;
    const { error: moveError } = await supabase.from('nutrition_logs')
      .update({ group_id: null, meal_type: null })
      .eq('user_id', group.user_id)
      .eq('group_id', group.id);
    if (moveError) {
      console.error('Error unassigning group entries:', moveError);
      return;
    }
    const { error } = await supabase.from('nutrition_groups').delete().eq('id', group.id).eq('user_id', group.user_id);
    if (error) {
      console.error('Error deleting nutrition group:', error);
      return;
    }
    setMonthGroups((current) => current.filter((candidate) => candidate.id !== group.id));
    setMonthLogs((current) => current.map((log) => log.group_id === group.id ? { ...log, group_id: null, meal_type: null } : log));
  };

  const targetKcal = macroTarget?.calories || 2000;
  const targetProtein = macroTarget?.protein || 150;
  const targetCarbs = macroTarget?.carbs || 200;
  const targetFat = macroTarget?.fat || 65;
  const remainingKcal = Math.max(0, Math.round(targetKcal - dayTotals.calories));

  const macroFigures: { label: string; current: number; target: number }[] = [
    { label: 'Protein', current: dayTotals.protein, target: targetProtein },
    { label: 'Carbs', current: dayTotals.carbs, target: targetCarbs },
    { label: 'Fat', current: dayTotals.fat, target: targetFat },
  ];

  return (
    <Screen>
      <Toast show={showSuccess} message="Entry saved" />

      {/* ── Dateline ── */}
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">{isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE')}</span>
          <span className="t-label-sm">{format(selectedDate, 'MMM d')}</span>
        </div>
        <h1 className="t-title mt-3 pt-5 border-t border-[var(--color-text)]">Fuel</h1>
      </motion.header>

      {/* ── Energy hero — the day's calories, big ── */}
      <motion.section
        className="mt-9"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.05 }}
      >
        {loading ? (
          <div className="space-y-4">
            <div className="shimmer h-3 w-24" />
            <div className="shimmer h-16 w-44" />
            <div className="shimmer h-px w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <span className="t-label block mb-3">Energy remaining</span>
                <div className="flex items-baseline gap-2.5">
                  <span className="number-hero text-[var(--color-text)]">{remainingKcal.toLocaleString()}</span>
                  <span className="[font-family:var(--font-display)] italic text-lg text-[var(--color-text-dim)]">kcal</span>
                </div>
              </div>
              <div className="text-right shrink-0 pb-1.5">
                <span className="t-data-sm text-[var(--color-text-dim)]">
                  {Math.round(dayTotals.calories).toLocaleString()}
                </span>
                <span className="t-label-sm block mt-1">of {Math.round(targetKcal).toLocaleString()} eaten</span>
              </div>
            </div>
            <RailStrip
              value={dayTotals.calories / Math.max(targetKcal * 1.18, dayTotals.calories)}
              notch={targetKcal / Math.max(targetKcal * 1.18, dayTotals.calories)}
              tone={dayTotals.calories > targetKcal ? 'berry' : 'chalk'}
              size="md"
              className="mt-6"
            />
          </>
        )}
      </motion.section>

      {/* ── Macro ledger — protein / carbs / fat as serif figures ── */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.09 }}
      >
        <span className="t-label block mb-5">Macros</span>
        {loading ? (
          <div className="grid grid-cols-3 gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2.5">
                <div className="shimmer h-2.5 w-10" />
                <div className="shimmer h-8 w-14" />
                <div className="shimmer h-px w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {macroFigures.map((macro) => {
              const max = Math.max(macro.target * 1.18, macro.current);
              const over = macro.current > macro.target;
              return (
                <div key={macro.label}>
                  <span className="t-label-sm block mb-2">{macro.label}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="number-medium text-[var(--color-text)]">{Math.round(macro.current)}</span>
                    <span className="[font-family:var(--font-display)] italic text-sm text-[var(--color-text-dim)]">g</span>
                  </div>
                  <span className="t-data-sm text-[var(--color-muted)] block mb-2.5">/ {Math.round(macro.target)}</span>
                  <RailStrip
                    value={macro.current / max}
                    notch={macro.target / max}
                    tone={over ? 'berry' : 'chalk'}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </motion.section>

      {/* ── Primary action ── */}
      <motion.div
        className="mt-9"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.12 }}
      >
        <Button
          size="lg"
          className="w-full"
          onClick={() => {
            setEditingEntry(null);
            setShowLogger(true);
          }}
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
          Log food
        </Button>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Button variant="secondary" onClick={() => setShowGroupSheet(true)}>
            <Layers3 className="w-4 h-4" strokeWidth={1.5} />
            Add meal
          </Button>
          <Button variant="secondary" onClick={() => setShowCronometerImport(true)}>
            <FileUp className="w-4 h-4" strokeWidth={1.5} />
            Cronometer
          </Button>
        </div>
      </motion.div>

      {/* ── Week strip + month jump ── */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.16 }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <span className="t-label">{format(weekStart, 'MMMM')}</span>
          <div className="flex items-center">
            <button
              type="button"
              aria-label="Previous week"
              className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setWeekAnchor((current) => addDays(current, -7))}
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Next week"
              className="pressable p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setWeekAnchor((current) => addDays(current, 7))}
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Open month calendar"
              className="pressable p-2 ml-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setShowMonthSheet(true)}
            >
              <CalendarDays className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-t border-[var(--color-border)]">
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
                className={`relative flex flex-col items-center gap-1.5 py-3 transition-colors ${
                  isSelected ? 'bg-[var(--color-text)]' : 'pressable'
                }`}
              >
                {dayIsToday && !isSelected && (
                  <span className="absolute top-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                )}
                <span className={`t-label-sm ${isSelected ? 'text-[var(--color-base)]' : 'text-[var(--color-muted)]'}`}>
                  {format(day, 'EEEEE')}
                </span>
                <span className={`t-data ${isSelected ? 'text-[var(--color-base)]' : 'text-[var(--color-text-dim)]'}`}>
                  {format(day, 'd')}
                </span>
                <span
                  className={`w-1 h-1 rounded-full ${hasLogs ? '' : 'opacity-0'}`}
                  style={{ backgroundColor: isSelected ? 'var(--color-base)' : 'var(--color-text-dim)' }}
                />
              </button>
            );
          })}
        </div>
      </motion.section>

      {/* ── Unified food inbox + meal groups ── */}
      <motion.section
        className="mt-10 pt-8 border-t border-[var(--color-border)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.smooth, delay: 0.2 }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <span className="t-label">Meals</span>
          {!loading && selectedDayLogs.length > 0 && (
            <span className="t-data-sm text-[var(--color-muted)]">
              {selectedDayLogs.length} {selectedDayLogs.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-px">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4 border-t border-[var(--color-border)]">
                <div className="shimmer h-3 w-12" />
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-3.5 w-2/3" />
                  <div className="shimmer h-2.5 w-1/3" />
                </div>
                <div className="shimmer h-6 w-12" />
              </div>
            ))}
          </div>
        ) : selectedDayLogs.length === 0 && selectedDayGroups.length === 0 ? (
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
                <Plus className="w-4 h-4" strokeWidth={1.75} />
                Add entry
              </Button>
            }
          />
        ) : (
          <NutritionGroupLedger
            logs={selectedDayLogs}
            groups={selectedDayGroups}
            deletedId={deletedId}
            onEdit={(entry) => {
              const fullEntry = selectedDayLogs.find((candidate) => candidate.id === entry.id);
              if (!fullEntry) return;
              setEditingEntry(fullEntry);
              setShowLogger(true);
            }}
            onDelete={(id) => void handleDeleteEntry(id)}
            onMove={(id, groupId) => void moveEntry(id, groupId)}
            onDeleteGroup={(group) => void deleteGroup(group)}
          />
        )}
      </motion.section>

      {/* Month jump sheet */}
      <Modal isOpen={showMonthSheet} onClose={() => setShowMonthSheet(false)} title="Jump to date">
        <div className="pt-1 pb-2">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelectedMonth((prev) => subMonths(prev, 1))}
              className="pressable p-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="t-heading">{format(selectedMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
              className="pressable p-2.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={`${d}-${i}`} className="t-label-sm text-center py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7">
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
                  className={`relative h-10 t-data transition-colors ${
                    isSelected
                      ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                      : inMonth
                        ? 'text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)]'
                        : 'text-[var(--color-muted)] opacity-50'
                  }`}
                >
                  {format(day, 'd')}
                  {hasLogs && !isSelected && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-1.5 w-1 h-1 rounded-full bg-[var(--color-text-dim)]" />
                  )}
                  {isToday(day) && !isSelected && (
                    <span className="absolute left-1/2 -translate-x-1/2 top-1.5 w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal isOpen={showGroupSheet} onClose={() => setShowGroupSheet(false)} title="Add meal or snack">
        <div className="space-y-px pb-2">
          {[
            { kind: 'meal' as const, label: null, title: 'Numbered meal', description: 'Meal 1, Meal 2, Meal 3…' },
            { kind: 'meal' as const, label: 'breakfast' as const, title: 'Breakfast', description: 'Named meal' },
            { kind: 'meal' as const, label: 'lunch' as const, title: 'Lunch', description: 'Named meal' },
            { kind: 'meal' as const, label: 'dinner' as const, title: 'Dinner', description: 'Named meal' },
            { kind: 'snack' as const, label: null, title: 'Numbered snack', description: 'Snack 1, Snack 2, Snack 3…' },
          ].map((option) => {
            const alreadyExists = option.label !== null && selectedDayGroups.some((group) => group.label === option.label);
            return (
              <button
                key={`${option.kind}-${option.label || 'numbered'}`}
                type="button"
                disabled={alreadyExists}
                className="pressable w-full flex items-center justify-between gap-4 py-4 border-t border-[var(--color-border)] text-left disabled:opacity-40"
                onClick={() => void createGroup(option.kind, option.label)}
              >
                <span>
                  <span className="t-heading block">{option.title}</span>
                  <span className="t-caption block mt-0.5">{option.description}</span>
                </span>
                <span className="t-data-sm text-[var(--color-muted)]">{alreadyExists ? 'Added' : 'Add'}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal isOpen={showCronometerImport} onClose={() => setShowCronometerImport(false)} title="Import Cronometer">
        <CronometerImporter onImported={() => void fetchMonthLogs(selectedMonth)} />
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
          groups={selectedDayGroups}
          onComplete={handleLogComplete}
        />
      </Modal>
    </Screen>
  );
}
