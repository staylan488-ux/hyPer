import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal, Toast, SealMark } from '@/components/shared';
import { HeroFigure, LineButton, MetalRail, MetalSection, MetalTitle, useCommandCapsule } from '@/components/metal';
import { useTargetSeal } from '@/hooks/useTargetSeal';
import { useAppStore } from '@/stores/appStore';
import { MealLogger } from '@/components/nutrition/MealLogger';
import { getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';
import { NutritionGroupLedger } from '@/components/nutrition/NutritionGroupLedger';
import '@/components/nutrition/fuel.css';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { missingDefaultNamedMeals, nutritionGroupLabel, sortNutritionGroups } from '@/lib/nutritionGroups';
import { buildCalendarDays, getDateKey } from '@/lib/nutritionCalendar';
import {
  createNutritionGroup,
  deleteNutritionEntry,
  deleteNutritionGroup,
  ensureDefaultGroups,
  mergeGroups,
  moveEntryToGroup,
  moveEntryToPreviousDay,
  offersMoveToPreviousDay,
  reorderNutritionGroup,
} from '@/lib/nutritionDay';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { sumMacros } from '@/lib/nutritionMacros';
import { createLatestRequestGate, nextMonthGroups, nutritionMonthKey, shouldEnsureDefaultGroups } from '@/lib/nutritionMonthLoad';
import { DEFAULT_MACRO_TARGET, type NutritionGroup } from '@/types';
import {
  addDays,
  addMonths,
  endOfMonth,
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
    if (!await deleteNutritionEntry(logId)) {
      setDeletedId(null);
      return;
    }
    setTimeout(() => {
      setMonthLogs((prev) => prev.filter((log) => log.id !== logId));
      setDeletedId(null);
    }, 300);
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

    const createDefaults = async () => {
      try {
        const userId = await getSessionUserId();
        if (!userId) return;

        const result = await ensureDefaultGroups(userId, selectedDateKey, selectedDayGroups);
        if (!result) return;
        if (!result.ok) {
          if (!result.inserted) defaultGroupsFailed.current.add(selectedDateKey);
          if (cancelled) return;
          await fetchMonthLogs(selectedMonthRef.current);
          return;
        }
        if (cancelled) return;
        setMonthGroups((current) => mergeGroups(current, result.groups));
      } finally {
        defaultGroupsInFlight.current.delete(selectedDateKey);
      }
    };

    void createDefaults();
    return () => {
      cancelled = true;
    };
  }, [fetchMonthLogs, loadedMonthKey, loading, selectedDateKey, selectedDayGroups, selectedMonth]);

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
    const result = await createNutritionGroup(userId, selectedDateKey, kind, selectedDayGroups);
    if (!result.ok) {
      if (result.inserted) await fetchMonthLogs(selectedMonthRef.current);
      return;
    }
    setMonthGroups((current) => mergeGroups(current, result.groups));
    setShowGroupSheet(false);
  };

  // Food eaten after midnight on a night that has not ended yet belongs to the
  // day before. Offered only on late-night entries, so it cannot be mis-tapped
  // on an ordinary lunch.
  const moveLogToPreviousDay = async (logId: string) => {
    const log = selectedDayLogs.find((candidate) => candidate.id === logId);
    if (!log) return;
    if (!await moveEntryToPreviousDay(log)) return;
    await fetchMonthLogs(selectedMonthRef.current);
  };

  const moveEntry = async (logId: string, groupId: string | null) => {
    const patch = await moveEntryToGroup(logId, groupId, selectedDayGroups, selectedDayLogs);
    if (!patch) return;
    setMonthLogs((current) => current.map((log) => log.id === logId ? { ...log, ...patch } : log));
  };

  const reorderGroup = async (groupId: string, direction: -1 | 1) => {
    const result = await reorderNutritionGroup(selectedDayGroups, groupId, direction);
    if (!result) return;
    if (!result.ok) {
      await fetchMonthLogs(selectedMonthRef.current);
      return;
    }
    setMonthGroups((current) => mergeGroups(current, result.groups));
  };

  const deleteGroup = async (group: NutritionGroup) => {
    if (group.label) return;
    const name = nutritionGroupLabel(group, selectedDayGroups);
    if (!confirm(`Delete ${name}? Its foods will move to Unassigned.`)) return;
    if (!await deleteNutritionGroup(group)) return;
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

  const liveDay = isToday(selectedDate);
  const calorieSeal = useTargetSeal({ macro: 'calories', current: dayTotals.calories, target: targetKcal, dayKey: selectedDateKey, live: liveDay && !loading });
  const proteinSeal = useTargetSeal({
    macro: 'protein',
    current: dayTotals.protein,
    target: macroFigures.find((macro) => macro.label === 'Protein')?.target ?? 0,
    dayKey: selectedDateKey,
    live: liveDay && !loading,
  });

  const eatenKcal = Math.round(dayTotals.calories);
  const roundedTarget = Math.round(targetKcal);
  const kcalLeft = Math.max(0, roundedTarget - eatenKcal);
  const kcalOver = Math.max(0, eatenKcal - roundedTarget);
  const proteinLeft = Math.max(0, Math.round(targetProtein - dayTotals.protein));
  // One segment per 100 kcal of target (the hairline caps long runs); on
  // today the segment being filled is the live one.
  const energySegments = Math.max(1, Math.round(targetKcal / 100));
  const energyOn = Math.min(energySegments, Math.floor(dayTotals.calories / 100));
  const openLogger = () => {
    setEditingEntry(null);
    setShowLogger(true);
  };
  const capsuleSublabel = loading
    ? undefined
    : !liveDay
      ? `Adds to ${format(selectedDate, 'EEEE, MMM d')}`
      : kcalOver > 0
        ? `${kcalOver.toLocaleString()} kcal over target`
        : `${kcalLeft.toLocaleString()} kcal left${proteinLeft > 0 ? ` · ${proteinLeft} g protein to go` : ''}`;
  const otherYear = format(selectedDate, 'yyyy') !== format(new Date(), 'yyyy');

  return (
    <div className="metal-page fuel-page pb-nav">
      <FuelCommand sublabel={capsuleSublabel} onPress={openLogger} />
      <Toast show={showSuccess} message="Entry saved" />

      {/* ── Dateline ── */}
      <header>
        <MetalTitle
          note={[
            liveDay ? `Today · ${format(selectedDate, 'MMM d')}` : format(selectedDate, 'EEEE, MMM d'),
            otherYear ? format(selectedDate, 'yyyy') : null,
          ].filter(Boolean).join(' · ')}
        >
          Fuel
        </MetalTitle>
      </header>

      {/* ── Energy — the day's calories, as the one huge figure ── */}
      <section className="fuel-hero" aria-label="Energy">
        {loading ? (
          <div aria-hidden>
            <div className="shimmer h-[90px] w-48 mt-5" />
            <div className="shimmer h-[2px] w-full mt-[18px]" />
          </div>
        ) : (
          <>
            {/* Today's hero, set the same way: plain proportional figures, two short caption lines.
                What's left rides in the capsule; an overage gets the flag below. */}
            <HeroFigure
              value={eatenKcal.toLocaleString()}
              caption={<>
                <span>
                  kcal eaten
                  <SealMark show={calorieSeal.met} label="Calorie target met" anchorRef={calorieSeal.anchorRef} />
                </span>
                {calorieSeal.met ? <b>On target</b> : <>of {roundedTarget.toLocaleString()}</>}
              </>}
              segments={{
                total: energySegments,
                on: energyOn,
                now: liveDay && kcalOver === 0 && energyOn < energySegments ? energyOn : undefined,
                label: `${eatenKcal.toLocaleString()} of ${roundedTarget.toLocaleString()} kcal`,
              }}
            />
            {kcalOver > 0 && (
              <p className="metal-flag"><span><b>{kcalOver.toLocaleString()} kcal</b> over the daily target</span></p>
            )}
          </>
        )}
      </section>

      {/* ── Macros — hairline bars under the energy figure ── */}
      <MetalSection label="Macros">
        {loading ? (
          <div className="fuel-macros" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2.5">
                <div className="shimmer h-3 w-full" />
                <div className="shimmer h-[2px] w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="fuel-macros">
            {macroFigures.map((macro) => (
              <MetalRail
                key={macro.label}
                label={macro.label}
                value={macro.current}
                target={macro.target}
                unit=" g"
                extra={macro.label === 'Protein'
                  ? <SealMark show={proteinSeal.met} label="Protein target met" anchorRef={proteinSeal.anchorRef} />
                  : undefined}
              />
            ))}
          </div>
        )}
      </MetalSection>

      {/* ── Week strip + month jump ── */}
      <MetalSection
        label={format(weekStart, 'MMMM')}
        right={(
          <div className="fuel-head-tools">
            <button
              type="button"
              aria-label="Previous week"
              className="fuel-icon-btn"
              onClick={() => setWeekAnchor((current) => addDays(current, -7))}
            >
              <ChevronLeft strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Next week"
              className="fuel-icon-btn"
              onClick={() => setWeekAnchor((current) => addDays(current, 7))}
            >
              <ChevronRight strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Open month calendar"
              className="fuel-icon-btn"
              onClick={() => setShowMonthSheet(true)}
            >
              <CalendarDays strokeWidth={1.5} />
            </button>
          </div>
        )}
      >
        <div className="fuel-week">
          {weekDays.map((day) => {
            const key = getDateKey(day);
            const isSelected = isSameDay(day, selectedDate);
            const hasLogs = (logsByDay[key] || []).length > 0;

            return (
              <button
                key={key}
                type="button"
                onClick={() => pickDate(day)}
                aria-label={format(day, 'EEEE, MMMM d')}
                aria-pressed={isSelected}
                aria-current={isToday(day) ? 'date' : undefined}
                className={`fuel-day${isSelected ? ' is-selected' : ''}${isToday(day) ? ' is-today' : ''}`}
              >
                <span className="fuel-day-letter" aria-hidden>{format(day, 'EEEEE')}</span>
                <span className="fuel-day-num">{format(day, 'd')}</span>
                <span className={`fuel-day-dot${hasLogs ? '' : ' is-off'}`} aria-hidden />
              </button>
            );
          })}
        </div>
      </MetalSection>

      {/* ── Unified food inbox + meal groups ── */}
      <MetalSection
        label="Meals"
        right={(
          <>
            {!loading && selectedDayLogs.length > 0 && (
              <span>{selectedDayLogs.length} {selectedDayLogs.length === 1 ? 'entry' : 'entries'}</span>
            )}
            <LineButton plus onClick={() => setShowGroupSheet(true)}>Add meal</LineButton>
          </>
        )}
      >
        {loading ? (
          <div aria-hidden className="mt-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4 border-t-[0.5px] border-[var(--metal-rule)]">
                <div className="flex-1 space-y-1.5">
                  <div className="shimmer h-3.5 w-2/3" />
                  <div className="shimmer h-2.5 w-1/3" />
                </div>
                <div className="shimmer h-4 w-14" />
              </div>
            ))}
          </div>
        ) : selectedDayLogs.length === 0 && selectedDayGroups.length === 0 ? (
          <div className="mt-1">
            <p className="metal-row-title">Nothing logged yet</p>
            <p className="metal-note mt-1">
              {liveDay ? 'Your first entry sets the tone for the day.' : `No entries on ${format(selectedDate, 'MMM d')}.`}
            </p>
          </div>
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
            onMoveToPreviousDay={
              offersMoveToPreviousDay(selectedDayLogs)
                ? (id) => void moveLogToPreviousDay(id)
                : undefined
            }
            onReorderGroup={(groupId, direction) => void reorderGroup(groupId, direction)}
            onDeleteGroup={(group) => void deleteGroup(group)}
          />
        )}
      </MetalSection>

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
        <div className="fuel-month pb-2">
          <div className="fuel-month-head">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelectedMonth((prev) => subMonths(prev, 1))}
              className="metal-step-btn pressable flex items-center justify-center w-11 h-11 text-[var(--metal-ink)]"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <span className="fuel-month-title">{format(selectedMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelectedMonth((prev) => addMonths(prev, 1))}
              className="metal-step-btn pressable flex items-center justify-center w-11 h-11 text-[var(--metal-ink)]"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="fuel-month-letters" aria-hidden>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={`${d}-${i}`} className="fuel-day-letter py-1">{d}</span>
            ))}
          </div>
          <div className="fuel-week">
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
                  aria-current={isToday(day) ? 'date' : undefined}
                  onClick={() => {
                    pickDate(day);
                    setShowMonthSheet(false);
                  }}
                  className={`fuel-day${isSelected ? ' is-selected' : ''}${isToday(day) ? ' is-today' : ''}${inMonth ? '' : ' is-outside'}`}
                >
                  <span className="fuel-day-num">{format(day, 'd')}</span>
                  <span className={`fuel-day-dot${hasLogs ? '' : ' is-off'}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal isOpen={showGroupSheet} onClose={() => setShowGroupSheet(false)} title="Add meal or snack">
        <div className="pb-2">
          {[
            { kind: 'meal' as const, title: 'Meal', description: 'Inserted by time and numbered by its place in the day' },
            { kind: 'snack' as const, title: 'Snack', description: 'Inserted by time and numbered with other snacks' },
          ].map((option) => (
            <button
              key={option.kind}
              type="button"
              className="fuel-option"
              onClick={() => void createGroup(option.kind)}
            >
              <span className="min-w-0">
                <span className="metal-row-title">{option.title}</span>
                <span className="metal-row-detail">{option.description}</span>
              </span>
              <span className="fuel-option-value">Add</span>
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
    </div>
  );
}

/** Fuel's one primary action on the command capsule: Log food. */
function FuelCommand({ sublabel, onPress }: { sublabel?: string; onPress: () => void }) {
  useCommandCapsule({
    key: 'fuel-log-food',
    label: 'Log food',
    sublabel,
    glyph: 'plus',
    dock: 'tabbar',
    onPress,
  });
  return null;
}
