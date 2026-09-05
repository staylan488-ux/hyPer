import { format, parseISO } from 'date-fns';
import { Card, CardTitle } from '@/components/shared';
import { useWeeklyNutrition } from '@/hooks/useWeeklyNutrition';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_MACRO_TARGET } from '@/types';

export function WeeklyNutrition() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const macroTarget = useAppStore((state) => state.macroTarget) ?? DEFAULT_MACRO_TARGET;

  return (
    <Card variant="slab" className="overflow-hidden">
      <CardTitle>Nutrition · Last 7 days</CardTitle>
      <p className="t-caption mt-2 mb-6">Logged totals against your current daily targets. Dashed lines mark each target.</p>
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
            const scale = Math.max(1, target * 1.3, ...weeklyNutrition.map((day) => day[key]));
            return (
              <div key={key}>
                <p className="t-label-sm mb-3">{label} · {target.toLocaleString()} {unit} target</p>
                <div className="flex gap-px">
                  {weeklyNutrition.map((day) => (
                    <div key={day.date} className="flex-1 min-w-0 text-center" aria-label={`${format(parseISO(day.date), 'EEEE, MMM d')}: ${Math.round(day[key])} ${unit} logged`}>
                      <div className="relative h-20 border-b border-[var(--color-border-strong)]" aria-hidden>
                        {target > 0 && (
                          <div className="absolute w-full border-t border-dashed border-[var(--color-border-strong)]" style={{ bottom: `${target / scale * 100}%` }} />
                        )}
                        <div className="absolute bottom-0 w-full bg-[var(--color-text)] opacity-70" style={{ height: `${day[key] / scale * 100}%` }} />
                      </div>
                      <span className="t-caption block mt-2" aria-hidden>{format(parseISO(day.date), 'EEE')}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
