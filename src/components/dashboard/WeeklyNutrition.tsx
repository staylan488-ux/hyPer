import { format, parseISO } from 'date-fns';
import { Card, CardTitle } from '@/components/shared';
import { BarChart } from '@/components/shared/charts';
import { useWeeklyNutrition } from '@/hooks/useWeeklyNutrition';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_MACRO_TARGET } from '@/types';

export function WeeklyNutrition() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const macroTarget = useAppStore((state) => state.macroTarget) ?? DEFAULT_MACRO_TARGET;

  return (
    <Card variant="slab" className="overflow-hidden">
      <CardTitle>Nutrition · Last 7 days</CardTitle>
      <p className="t-caption mt-2 mb-4">Logged totals against your current daily targets. Dashed lines mark each target. Drag across a chart to read each day.</p>
      {loading ? (
        <div className="shimmer h-48" aria-label="Loading nutrition totals" />
      ) : error ? (
        <p className="t-caption py-4" role="alert">{error}</p>
      ) : weeklyNutrition.length === 0 ? (
        <p className="t-caption py-4">Log your meals to see your weekly nutrition trend.</p>
      ) : (
        <div className="space-y-6">
          {([
            { key: 'calories', label: 'Calories', unit: 'kcal', target: macroTarget.calories },
            { key: 'protein', label: 'Protein', unit: 'g', target: macroTarget.protein },
          ] as const).map(({ key, label, unit, target }) => {
            const logged = weeklyNutrition.filter((day) => day[key] > 0);
            const average = logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
            return (
              <div key={key}>
                <p className="t-label-sm">{label} · {target.toLocaleString()} {unit} target</p>
                <BarChart
                  height={80}
                  max={Math.max(1, target * 1.3)}
                  target={target > 0 ? target : undefined}
                  reveal={`weekly-nutrition-${key}`}
                  label={`${label} logged per day, last 7 days`}
                  summary={
                    <span className="flex justify-between gap-3">
                      <span className="text-[var(--color-text-dim)]">Daily average</span>
                      <span>
                        {Math.round(average).toLocaleString()} {unit}
                        {target > 0 && average > 0 && (
                          <span className="text-[var(--color-text-dim)]"> · {Math.round((average / target) * 100)}%</span>
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
                            {share !== null && <span className="text-[var(--color-text-dim)]"> · {share}%</span>}
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
    </Card>
  );
}
