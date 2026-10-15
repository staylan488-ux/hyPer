import { useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { MetalSection } from '@/components/metal';
import { BarChart } from '@/components/shared/charts';
import { useWeeklyNutrition } from '@/hooks/useWeeklyNutrition';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_MACRO_TARGET } from '@/types';

/** Progress: the last seven days of logged calories and protein against target. */
export function WeeklyNutrition() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const macroTarget = useAppStore((state) => state.macroTarget) ?? DEFAULT_MACRO_TARGET;
  const fetchMacroTarget = useAppStore((state) => state.fetchMacroTarget);

  // Progress can be opened directly, before Today has loaded the targets.
  useEffect(() => {
    void fetchMacroTarget();
  }, [fetchMacroTarget]);

  return (
    <MetalSection label="Nutrition" right="Last 7 days">
      <p className="metal-note !mt-1 !max-w-[40ch]">Logged totals against your current daily targets. Dashed lines mark each target. Drag across a chart to read each day.</p>
      {loading ? (
        <div className="shimmer h-48 mt-5" aria-label="Loading nutrition totals" />
      ) : error ? (
        <p className="metal-flag mt-4" role="alert"><span>{error}</span></p>
      ) : weeklyNutrition.length === 0 ? (
        <p className="metal-line mt-4 text-[var(--metal-ink-2)]">Log your meals to see your weekly nutrition trend.</p>
      ) : (
        <div className="mt-2">
          {([
            { key: 'calories', label: 'Calories', unit: 'kcal', target: macroTarget.calories },
            { key: 'protein', label: 'Protein', unit: 'g', target: macroTarget.protein },
          ] as const).map(({ key, label, unit, target }, index) => {
            const logged = weeklyNutrition.filter((day) => day[key] > 0);
            const average = logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
            return (
              <div key={key} className={index > 0 ? 'mt-7' : 'mt-4'}>
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] leading-[1.35] font-medium text-[var(--metal-ink)]">{label}</span>
                  <span className="text-[13px] text-[var(--metal-ink-2)] tabular-nums">{target.toLocaleString()} {unit} target</span>
                </p>
                <BarChart
                  height={80}
                  max={Math.max(1, target * 1.3)}
                  target={target > 0 ? target : undefined}
                  reveal={`weekly-nutrition-${key}`}
                  label={`${label} logged per day, last 7 days`}
                  summary={
                    <span className="flex justify-between gap-3">
                      <span className="text-[var(--metal-ink-2)]">Daily average</span>
                      <span>
                        {Math.round(average).toLocaleString()} {unit}
                        {target > 0 && average > 0 && (
                          <span className="text-[var(--metal-ink-2)]"> · {Math.round((average / target) * 100)}%</span>
                        )}
                      </span>
                    </span>
                  }
                  data={weeklyNutrition.map((day) => {
                    const amount = Math.round(day[key]);
                    const share = target > 0 ? Math.round((day[key] / target) * 100) : null;
                    const date = parseISO(day.date);
                    return {
                      key: day.date,
                      label: format(date, 'EEE'),
                      value: day[key],
                      ariaLabel: `${format(date, 'EEEE, MMM d')}: ${amount} ${unit} logged`,
                      readout: (
                        <span className="flex justify-between gap-3">
                          <span>{format(date, 'EEEE, MMM d')}</span>
                          <span>
                            {amount.toLocaleString()} {unit}
                            {share !== null && <span className="text-[var(--metal-ink-2)]"> · {share}%</span>}
                          </span>
                        </span>
                      ),
                    };
                  })}
                />
              </div>
            );
          })}
        </div>
      )}
    </MetalSection>
  );
}
