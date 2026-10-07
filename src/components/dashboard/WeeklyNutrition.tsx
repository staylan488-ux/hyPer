import { useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart } from '@/components/shared/charts';
import { useWeeklyNutrition } from '@/hooks/useWeeklyNutrition';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_MACRO_TARGET } from '@/types';

/** Fewer logged days than this read as a summary, not a chart. */
const MIN_CHART_DAYS = 3;

export function WeeklyNutrition() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const macroTarget = useAppStore((state) => state.macroTarget) ?? DEFAULT_MACRO_TARGET;
  const fetchMacroTarget = useAppStore((state) => state.fetchMacroTarget);

  // Progress can be opened directly, before Today has loaded the targets.
  useEffect(() => {
    void fetchMacroTarget();
  }, [fetchMacroTarget]);

  const metrics = ([
    { key: 'calories', label: 'Calories', unit: 'kcal', target: macroTarget.calories, overIsHigh: true },
    { key: 'protein', label: 'Protein', unit: 'g', target: macroTarget.protein, overIsHigh: false },
  ] as const).map((metric) => {
    const logged = weeklyNutrition.filter((day) => day[metric.key] > 0);
    const average = logged.length ? logged.reduce((sum, day) => sum + day[metric.key], 0) / logged.length : 0;
    return { ...metric, average, share: metric.target > 0 && average > 0 ? Math.round((average / metric.target) * 100) : null };
  });
  const logged = weeklyNutrition.filter((day) => day.calories > 0 || day.protein > 0);
  const loggedDays = logged.length;
  const sparse = loggedDays < MIN_CHART_DAYS;
  // One unfinished day is not an average: say what it is.
  const todayOnly = loggedDays === 1 && logged[0].date === format(new Date(), 'yyyy-MM-dd');

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="t-label">Nutrition</h3>
        <span className="t-caption">Last 7 days</span>
      </div>
      {loading ? (
        <div className="shimmer h-24 mt-5" aria-label="Loading nutrition totals" />
      ) : error ? (
        <p className="t-caption mt-4" role="alert">{error}</p>
      ) : weeklyNutrition.length === 0 || loggedDays === 0 ? (
        <p className="t-caption mt-3">Log your meals to see your weekly nutrition trend.</p>
      ) : sparse ? (
        // One or two days make a lonely chart; a short ledger says the same.
        <>
          <dl className="mt-4">
            {metrics.map((metric) => (
              <div key={metric.key} className="flex items-baseline justify-between gap-4 py-3 border-b border-[var(--color-border-soft)]">
                <dt className="t-caption">{metric.label} · {todayOnly ? 'today so far' : 'daily average'}</dt>
                <dd className="t-data-sm text-[var(--color-text)] tabular-nums">
                  {Math.round(metric.average).toLocaleString()} {metric.unit}
                  <span className="text-[var(--color-text-dim)]"> / {metric.target.toLocaleString()}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="t-caption mt-3">
            {loggedDays} of 7 days logged. Log {MIN_CHART_DAYS - loggedDays} more {MIN_CHART_DAYS - loggedDays === 1 ? 'day' : 'days'} to see the daily chart.
          </p>
        </>
      ) : (
        <div className="space-y-6 mt-1">
          {metrics.map(({ key, label, unit, target, average, share, overIsHigh }) => (
            <BarChart
              key={key}
              height={72}
              max={Math.max(1, target * 1.2)}
              target={target > 0 ? target : undefined}
              reveal={`weekly-nutrition-${key}`}
              label={`${label} logged per day against a ${target.toLocaleString()} ${unit} target, last 7 days`}
              summary={
                <span className="flex justify-between gap-3">
                  <span className="text-[var(--color-text-dim)]">{label} · {target.toLocaleString()} {unit} target</span>
                  <span>
                    {Math.round(average).toLocaleString()} {unit}
                    {share !== null && <span className="text-[var(--color-text-dim)]"> · {share}%</span>}
                  </span>
                </span>
              }
              data={weeklyNutrition.map((day) => {
                const amount = Math.round(day[key]);
                const dayShare = target > 0 ? Math.round((day[key] / target) * 100) : null;
                const date = parseISO(day.date);
                return {
                  key: day.date,
                  label: format(date, 'EEEEE'),
                  value: day[key],
                  // Lacquer only where calories ran over target.
                  emphasis: overIsHigh && target > 0 && day[key] > target * 1.05,
                  ariaLabel: `${format(date, 'EEEE, MMM d')}: ${amount} ${unit} logged`,
                  readout: (
                    <span className="flex justify-between gap-3">
                      <span>{format(date, 'EEEE, MMM d')}</span>
                      <span>
                        {amount.toLocaleString()} {unit}
                        {dayShare !== null && <span className="text-[var(--color-text-dim)]"> · {dayShare}%</span>}
                      </span>
                    </span>
                  ),
                };
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
