import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Layers3, Plus } from 'lucide-react';
import { Button, EmptyState, MetalRing, Modal, RailStrip, RollingNumber, Screen, Toast, PageTitle, SealMark } from '@/components/shared';
import { useTargetSeal } from '@/hooks/useTargetSeal';
import { useAppStore } from '@/stores/appStore';
import { MealLogger } from '@/components/nutrition/MealLogger';
import { getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
import { NutritionGroupLedger } from '@/components/nutrition/NutritionGroupLedger';
import '@/components/nutrition/nutrition-ledger.css';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import {
  changedGroupOrders,
  insertNutritionGroupByTime,
  legacyMealTypeForGroup,
  missingDefaultNamedMeals,
  moveNutritionGroup,
  normalizeNutritionGroupOrder,
  nutritionGroupLabel,
  sortNutritionGroups,
} from '@/lib/nutritionGroups';
import { isLateNightEntry, planEntryDayMove } from '@/lib/entryDay';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { sumMacros } from '@/lib/nutritionMacros';
import { createLatestRequestGate, nextMonthGroups, nutritionMonthKey, shouldEnsureDefaultGroups } from '@/lib/nutritionMonthLoad';
import { DEFAULT_MACRO_TARGET, type NutritionGroup } from '@/types';
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
    description?: string | null;
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
  const [loggerBusy, setLoggerBusy] = useState(false);
  // a photo, describe or AI analysis is running in the sheet
  const [loggerAnalysisBusy, setLoggerAnalysisBusy] = useState(false);
  // a finished photo estimate waits unseen on the sheet's Photo tab
  const [loggerResultWaiting, setLoggerResultWaiting] = useState(false);
  const [monthLogs, setMonthLogs] = useState<NutritionLogEntry[]>([]);
  const [monthGroups, setMonthGroups] = useState<NutritionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const selectedMonthRef = useRef(selectedMonth);
  useEffect(() => { selectedMonthRef.current = selectedMonth; }, [selectedMonth]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());
  const [editingEntry, setEditingEntry] = useState<NutritionLogEntry | null>(null);
  const [showMonthSheet, setShowMonthSheet] = useState(false);
  const [showGroupSheet, setShowGroupSheet] = useState(false);
  // Move, reorder and delete controls stay hidden until the list is in Edit mode.
  const [editingMeals, setEditingMeals] = useState(false);
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null);
  const loadedMonthKeyRef = useRef<string | null>(null);
  const [requestGate] = useState(createLatestRequestGate);
  const defaultGroupsInFlight = useRef(new Set<string>());
  const defaultGroupsFailed = useRef(new Set<string>());

  const fetchMonthLogs = useCallback(async (month: Date) => {
    const key = nutritionMonthKey(month);
    // A mutation from a month already left must not supersede the selected
    // month's request, even if its failure arrives after that request started.
    if (key !== nutritionMonthKey(selectedMonthRef.current)) return;
    const token = requestGate.begin();
    const isCurrent = () => requestGate.isCurrent(token)
      && key === nutritionMonthKey(selectedMonthRef.current);
    // Only a month that is not on screen yet shows the skeleton. A refresh
    // after a save keeps the page mounted so the numbers roll on from their
    // current values instead of replaying from zero.
    if (loadedMonthKeyRef.current !== key) setLoading(true);
    try {
      const userId = await getSessionUserId();
      if (!userId || !isCurrent()) return;

      const from = format(startOfMonth(month), 'yyyy-MM-dd');
      const to = format(endOfMonth(month), 'yyyy-MM-dd');

      const [logsResult, groupsResult] = await Promise.all([
        fetchNutritionLogsWithFoods<Omit<NutritionLogEntry, 'food'>, NonNullable<NutritionLogEntry['food']>>(
          userId,
          { from, to },
          '*',
          'id, name, description, calories, protein, carbs, fat, serving_size, serving_unit',
        ),
        supabase
          .from('nutrition_groups')
          .select('*')
          .eq('user_id', userId)
          .gte('date', from)
          .lte('date', to)
          .order('sort_order', { ascending: true }),
      ]);
      if (!isCurrent()) return;
      const { data: logs, error: logsError } = logsResult;
      const { data: groups, error: groupsError } = groupsResult;

      if (groupsError) console.error('Error fetching nutrition groups:', groupsError);
      setMonthGroups((current) => nextMonthGroups(current, groups as NutritionGroup[] | null, Boolean(groupsError)));
      // Groups that failed to load are not the month's real groups, so they
      // must not trigger default meal creation.
      const appliedMonthKey = groupsError ? null : key;
      loadedMonthKeyRef.current = appliedMonthKey;
      setLoadedMonthKey(appliedMonthKey);

      if (logsError) {
        console.error('Error fetching logs:', logsError);
        return;
      }

      setMonthLogs(logs || []);
    } catch (error) {
      console.error('Error fetching nutrition logs:', error);
    } finally {
      // Cleared on every exit, including signed-out or offline, so the page
      // can never stay on its skeleton; a superseded request leaves it to the
      // newest one.
      if (isCurrent()) setLoading(false);
    }
  }, [requestGate]);

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
    fetchMonthLogs(selectedMonthRef.current);
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

  const persistGroupOrder = useCallback(async (groups: NutritionGroup[]): Promise<boolean> => {
    const results = await Promise.all(groups.map((group) => (
      supabase
        .from('nutrition_groups')
        .update({ sort_order: group.sort_order })
        .eq('id', group.id)
        .eq('user_id', group.user_id)
    )));
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error('Error ordering nutrition groups:', failed.error);
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!shouldEnsureDefaultGroups({
      loading,
      loadedMonthKey,
      selectedDateKey,
      failedDates: defaultGroupsFailed.current,
    })) return;
    if (defaultGroupsInFlight.current.has(selectedDateKey)) return;
    const missingLabels = missingDefaultNamedMeals(selectedDayGroups);
    if (missingLabels.length === 0) return;

    defaultGroupsInFlight.current.add(selectedDateKey);
    let cancelled = false;

    const ensureDefaultGroups = async () => {
      try {
        const userId = await getSessionUserId();
        if (!userId) return;

        const { data, error } = await supabase.from('nutrition_groups').insert(
          missingLabels.map((label, index) => ({
            user_id: userId,
            date: selectedDateKey,
            kind: 'meal' as const,
            label,
            sort_order: selectedDayGroups.length + index,
          })),
        ).select('*');

        if (error || !data) {
          console.error('Error creating default nutrition groups:', error);
          defaultGroupsFailed.current.add(selectedDateKey);
          if (cancelled) return;
          await fetchMonthLogs(selectedMonthRef.current);
          return;
        }

        const inserted = data as NutritionGroup[];
        const normalized = normalizeNutritionGroupOrder([...selectedDayGroups, ...inserted]);
        if (!await persistGroupOrder(changedGroupOrders([...selectedDayGroups, ...inserted], normalized))) {
          if (cancelled) return;
          await fetchMonthLogs(selectedMonthRef.current);
          return;
        }
        if (cancelled) return;

        const normalizedById = new Map(normalized.map((group) => [group.id, group]));
        setMonthGroups((current) => [
          ...current.map((group) => normalizedById.get(group.id) || group),
          ...inserted
            .filter((group) => !current.some((candidate) => candidate.id === group.id))
            .map((group) => normalizedById.get(group.id) || group),
        ]);
      } finally {
        defaultGroupsInFlight.current.delete(selectedDateKey);
      }
    };

    void ensureDefaultGroups();
    return () => {
      cancelled = true;
    };
  }, [fetchMonthLogs, loadedMonthKey, loading, persistGroupOrder, selectedDateKey, selectedDayGroups, selectedMonth]);

  const dayTotals = useMemo(() => sumMacros(selectedDayLogs), [selectedDayLogs]);

  const logsByDay = useMemo(() => {
    return monthLogs.reduce<Record<string, NutritionLogEntry[]>>((acc, log) => {
      if (!acc[log.date]) acc[log.date] = [];
      acc[log.date].push(log);
      return acc;
    }, {});
  }, [monthLogs]);

  const createGroup = async (kind: 'meal' | 'snack') => {
    const userId = await getSessionUserId();
    if (!userId) return;
    const { data, error } = await supabase.from('nutrition_groups').insert({
      user_id: userId,
      date: selectedDateKey,
      kind,
      label: null,
      sort_order: selectedDayGroups.length,
    }).select('*').single();

    if (error || !data) {
      console.error('Error creating nutrition group:', error);
      return;
    }

    const normalized = insertNutritionGroupByTime(selectedDayGroups, data as NutritionGroup);
    if (!await persistGroupOrder(changedGroupOrders([...selectedDayGroups, data as NutritionGroup], normalized))) {
      await fetchMonthLogs(selectedMonthRef.current);
      return;
    }

    const normalizedById = new Map(normalized.map((group) => [group.id, group]));
    setMonthGroups((current) => [
      ...current.map((group) => normalizedById.get(group.id) || group),
      ...(current.some((group) => group.id === data.id) ? [] : [normalizedById.get(data.id) || data as NutritionGroup]),
    ]);
    setShowGroupSheet(false);
  };

  // Food eaten after midnight on a night that has not ended yet belongs to the
  // day before. Offered only on late-night entries, so it cannot be mis-tapped
  // on an ordinary lunch.
  const moveEntryToPreviousDay = async (logId: string) => {
    const log = selectedDayLogs.find((candidate) => candidate.id === logId);
    if (!log) return;
    const patch = planEntryDayMove({ date: log.date, logged_at: log.logged_at }, -1);
    if (!patch) return;

    const { error } = await supabase.from('nutrition_logs').update(patch).eq('id', logId);
    if (error) {
      console.error('Error moving nutrition entry to the previous day:', error);
      return;
    }
    await fetchMonthLogs(selectedMonthRef.current);
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

  const reorderGroup = async (groupId: string, direction: -1 | 1) => {
    const reordered = moveNutritionGroup(selectedDayGroups, groupId, direction);
    if (!reordered) return;

    if (!await persistGroupOrder(changedGroupOrders(selectedDayGroups, reordered))) {
      await fetchMonthLogs(selectedMonthRef.current);
      return;
    }

    const reorderedById = new Map(reordered.map((group) => [group.id, group]));
    setMonthGroups((current) => current.map((group) => reorderedById.get(group.id) || group));
  };

  const deleteGroup = async (group: NutritionGroup) => {
    if (group.label) return;
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

  const targetKcal = macroTarget?.calories || DEFAULT_MACRO_TARGET.calories;
  const targetProtein = macroTarget?.protein || DEFAULT_MACRO_TARGET.protein;
  const targetCarbs = macroTarget?.carbs || DEFAULT_MACRO_TARGET.carbs;
  const targetFat = macroTarget?.fat || DEFAULT_MACRO_TARGET.fat;
  const macroFigures: { label: string; current: number; target: number }[] = [
    { label: 'Protein', current: dayTotals.protein, target: targetProtein },
    { label: 'Carbs', current: dayTotals.carbs, target: targetCarbs },
    { label: 'Fat', current: dayTotals.fat, target: targetFat },
  ];

  const energyPct = targetKcal > 0 ? Math.round((dayTotals.calories / targetKcal) * 100) : 0;
  const energyOver = dayTotals.calories > targetKcal;

  const liveDay = isToday(selectedDate);
  const calorieSeal = useTargetSeal({ macro: 'calories', current: dayTotals.calories, target: targetKcal, dayKey: selectedDateKey, live: liveDay && !loading });
  const proteinSeal = useTargetSeal({
    macro: 'protein',
    current: dayTotals.protein,
    target: macroFigures.find((macro) => macro.label === 'Protein')?.target ?? 0,
    dayKey: selectedDateKey,
    live: liveDay && !loading,
  });

  return (
    <Screen>
      <Toast show={showSuccess} message="Entry saved" />

      {/* ── Dateline ── */}
      <header>
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">{isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE')}</span>
          <span className="t-label-sm">{format(selectedDate, 'MMM d')}</span>
        </div>
        <PageTitle className="mt-5">Fuel</PageTitle>
      </header>

      {/* ── Energy hero — the day's calories, big, with the page's one metal action ── */}
      <section className="platter mt-5">
        {loading ? (
          <div className="space-y-4" aria-hidden>
            <div className="shimmer h-3 w-24" />
            <div className="flex items-center justify-between gap-4">
              <div className="shimmer h-12 w-40" />
              <div className="shimmer h-[84px] w-[84px] rounded-full" />
            </div>
          </div>
        ) : (
          <>
            <span className="t-label block mb-4">Energy consumed</span>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2.5">
                  <RollingNumber value={Math.round(dayTotals.calories).toLocaleString()} className="number-hero text-[var(--color-text)]" />
                  <span className="t-caption text-[var(--color-text-dim)]">kcal</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="t-data-sm text-[var(--color-text-dim)]">
                    / {Math.round(targetKcal).toLocaleString()}
                  </span>
                  <span className="t-label-sm">{calorieSeal.met ? 'On target' : 'Daily target'}</span>
                  <SealMark show={calorieSeal.met} label="Calorie target met" anchorRef={calorieSeal.anchorRef} />
                </div>
              </div>
              <MetalRing
                progress={targetKcal > 0 ? dayTotals.calories / targetKcal : 0}
                label={`${Math.round(dayTotals.calories).toLocaleString()} of ${Math.round(targetKcal).toLocaleString()} kcal eaten`}
                size={84}
                thickness={6}
                reveal="fuel-energy-ring"
              >
                <span className={`t-data-lg ${energyOver ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>{energyPct}%</span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-dim)]">{energyOver ? 'over' : 'eaten'}</span>
              </MetalRing>
            </div>
          </>
        )}

        <Button
          size="lg"
          metal
          className="w-full mt-6"
          onClick={() => {
            setEditingEntry(null);
            setShowLogger(true);
          }}
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
          Log food
        </Button>
      </section>

      {/* Supporting macro ledger keeps energy as the single hero. */}
      <section className="platter mt-4">
        <span className="t-label block mb-5">Macros</span>
        {loading ? (
          <div className="space-y-5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2.5">
                <div className="flex justify-between">
                  <div className="shimmer h-3.5 w-14" />
                  <div className="shimmer h-3.5 w-16" />
                </div>
                <div className="shimmer h-1 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {macroFigures.map((macro) => {
              const max = Math.max(macro.target * 1.18, macro.current);
              const over = macro.current > macro.target;
              return (
                <div key={macro.label}>
                  <div className="flex items-baseline justify-between gap-3 mb-2.5">
                    <span className="t-body flex items-center gap-2">
                      {macro.label}
                      {macro.label === 'Protein' && (
                        <SealMark show={proteinSeal.met} label="Protein target met" anchorRef={proteinSeal.anchorRef} />
                      )}
                    </span>
                    <span className="t-data-sm text-[var(--color-text)]">
                      {Math.round(macro.current)} <span className="text-[var(--color-text-dim)]">/ {Math.round(macro.target)} g</span>
                    </span>
                  </div>
                  <RailStrip
                    value={macro.current / max}
                    notch={macro.target / max}
                    tone={over ? 'berry' : 'chalk'}
                    size="sm"
                    reveal={`fuel-macro-${macro.label}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Week strip + month jump ── */}
      <section className="platter mt-4 px-3 pt-3 pb-3">
        <div className="flex items-center justify-between pl-2 -mr-1.5 mb-1">
          <span className="t-label">{format(weekStart, 'MMMM')}</span>
          <div className="flex items-center">
            <button
              type="button"
              aria-label="Previous week"
              className="pressable studio-row-action flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setWeekAnchor((current) => addDays(current, -7))}
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Next week"
              className="pressable studio-row-action flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setWeekAnchor((current) => addDays(current, 7))}
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Open month calendar"
              className="pressable studio-row-action flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setShowMonthSheet(true)}
            >
              <CalendarDays className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
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
                aria-label={`${format(day, 'EEEE, MMMM d')}${dayIsToday ? ', today' : ''}${hasLogs ? ', has entries' : ''}`}
                aria-pressed={isSelected}
                className="fuel-day pressable"
                data-today={dayIsToday || undefined}
              >
                <span className="fuel-day-letter">{format(day, 'EEEEE')}</span>
                <span className="fuel-day-number">{format(day, 'd')}</span>
                <span className="fuel-day-dot" data-on={hasLogs || undefined} />
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Unified food inbox + meal groups ── */}
      <section className="mt-9">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-baseline gap-2">
            <span className="t-label">Meals</span>
            {!loading && selectedDayLogs.length > 0 && (
            <span className="t-data-sm text-[var(--color-muted)]">
              {selectedDayLogs.length} {selectedDayLogs.length === 1 ? 'entry' : 'entries'}
            </span>
            )}
          </div>
          <div className="fuel-list-actions">
            {editingMeals ? (
              <button type="button" className="is-done" onClick={() => setEditingMeals(false)}>Done</button>
            ) : <>
              <button type="button" onClick={() => setShowGroupSheet(true)}>
                <Layers3 className="w-4 h-4" strokeWidth={1.5} aria-hidden />
                Add meal
              </button>
              {!loading && (selectedDayLogs.length > 0 || selectedDayGroups.length > 0) && (
                <button type="button" onClick={() => setEditingMeals(true)}>Edit</button>
              )}
            </>}
          </div>
        </div>

        {loading ? (
          <div className="platter platter-flush" aria-hidden>
            {[1, 2, 3].map((i) => (
              <div key={i} className="platter-row flex items-center gap-4 px-5 py-4">
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
            className="platter"
            art="plate"
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
            editing={editingMeals}
            onEdit={(entry) => {
              const fullEntry = selectedDayLogs.find((candidate) => candidate.id === entry.id);
              if (!fullEntry) return;
              setEditingEntry(fullEntry);
              setShowLogger(true);
            }}
            onDelete={(id) => void handleDeleteEntry(id)}
            onMove={(id, groupId) => void moveEntry(id, groupId)}
            onMoveToPreviousDay={
              selectedDayLogs.some((log) => isLateNightEntry({ date: log.date, logged_at: log.logged_at }, new Date()))
                ? (id) => void moveEntryToPreviousDay(id)
                : undefined
            }
            onReorderGroup={(groupId, direction) => void reorderGroup(groupId, direction)}
            onDeleteGroup={(group) => void deleteGroup(group)}
          />
        )}
      </section>

      {/* Month jump sheet */}
      <Modal
        isOpen={showMonthSheet}
        onClose={() => {
          setShowMonthSheet(false);
          // Closing without a pick returns the page to the selected date's month.
          setSelectedMonth((current) => isSameMonth(current, selectedDate) ? current : startOfMonth(selectedDate));
        }}
        title="Jump to date"
      >
        <div className="pt-1 pb-2">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelectedMonth((prev) => subMonths(prev, 1))}
              className="pressable studio-row-action flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="t-heading">{format(selectedMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
              className="pressable studio-row-action flex items-center justify-center w-11 h-11 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={`${d}-${i}`} className="t-label-sm text-center py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const hasLogs = (logsByDay[key] || []).length > 0;

              return (
                <button
                  key={key}
                  type="button"
                  aria-label={format(day, 'EEEE, MMMM d')}
                  aria-pressed={isSelected}
                  onClick={() => {
                    pickDate(day);
                    setShowMonthSheet(false);
                  }}
                  className={`relative mx-auto w-11 h-11 rounded-[var(--radius-capsule)] t-data transition-[background-color,box-shadow] duration-200 ${
                    isSelected
                      ? 'bg-[var(--color-text)] text-[var(--color-base)] font-semibold'
                      : inMonth
                        ? 'text-[var(--color-text-dim)] active:bg-[var(--material-inset)]'
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
        <div className="platter platter-flush mb-2">
          {[
            { kind: 'meal' as const, title: 'Meal', description: 'Inserted by time and numbered by its place in the day' },
            { kind: 'snack' as const, title: 'Snack', description: 'Inserted by time and numbered with other snacks' },
          ].map((option) => (
            <button
              key={option.kind}
              type="button"
              className="platter-row pressable w-full flex items-center justify-between gap-4 px-5 py-4 min-h-11 text-left"
              onClick={() => void createGroup(option.kind)}
            >
              <span>
                <span className="t-heading block">{option.title}</span>
                <span className="t-caption block mt-0.5">{option.description}</span>
              </span>
              <span className="t-label-sm text-[var(--color-text-dim)] shrink-0">Add</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Logger sheet */}
      <Modal
        isOpen={showLogger}
        onClose={() => {
          if (loggerBusy) return;
          if (loggerAnalysisBusy && !window.confirm('Analysis in progress. Close and discard it?')) return;
          if (!loggerAnalysisBusy && loggerResultWaiting
            && !window.confirm('A photo estimate is waiting on the Photo tab. Close and discard it?')) return;
          setLoggerAnalysisBusy(false);
          setLoggerResultWaiting(false);
          setShowLogger(false);
          setEditingEntry(null);
        }}
        title={editingEntry ? 'Edit entry' : 'Log food'}
      >
        <MealLogger
          onBusyChange={setLoggerBusy}
          onAnalysisBusyChange={setLoggerAnalysisBusy}
          onUnreviewedResultChange={setLoggerResultWaiting}
          onCancel={() => { setShowLogger(false); setEditingEntry(null); }}
          selectedDate={selectedDate}
          initialEntry={editingEntry}
          groups={selectedDayGroups}
          onComplete={handleLogComplete}
        />
      </Modal>
    </Screen>
  );
}
