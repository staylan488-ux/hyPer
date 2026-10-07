import { format, parseISO } from 'date-fns';
import { BarChart, type BarDatum } from '@/components/shared/charts';
import { hoursInTenthsTogether, type TrainingHoursPoint } from '@/lib/workoutSessions';

interface TrainingHoursHistogramProps {
  points: TrainingHoursPoint[];
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function TrainingHoursHistogram({ points }: TrainingHoursHistogramProps) {
  const hasTraining = points.some((point) => point.totalMinutes > 0);
  const peakMinutes = Math.max(...points.map((point) => point.totalMinutes), 0);

  if (!hasTraining) {
    return (
      <p className="t-caption mt-3">No completed sessions yet. Finish a workout to chart your weekly time.</p>
    );
  }

  // Bars and total are rounded together, so the captions add up to the total.
  const hours = hoursInTenthsTogether(points.map((point) => point.totalMinutes));
  const data: BarDatum[] = points.map((point, index) => {
    const isPeak = point.totalMinutes > 0 && point.totalMinutes === peakMinutes;
    const start = parseISO(point.weekStart);
    const week = format(start, 'MMM d');
    // Axis labels name the month only where it changes, so eight weeks fit
    // on one crisp line ("Aug 17 · 24 · 31 · Sep 7 …").
    const previous = index > 0 ? parseISO(points[index - 1].weekStart) : null;
    const axisLabel = !previous || previous.getMonth() !== start.getMonth() ? week : format(start, 'd');
    return {
      key: point.weekStart,
      label: axisLabel,
      value: point.totalMinutes,
      // Empty weeks carry only a quiet zero stub: no bar and no caption.
      caption: hours.parts[index] > 0 ? (
        <>
          {hours.parts[index]}
          <span className="text-[var(--color-muted)] ml-px">h</span>
        </>
      ) : undefined,
      ariaLabel: `Week of ${week}: ${formatMinutes(point.totalMinutes)}${isPeak ? ', peak week' : ''}`,
      readout: (
        <span className="flex justify-between gap-3">
          <span>Week of {week}</span>
          <span>
            {formatMinutes(point.totalMinutes)}
            {isPeak && <span className="text-[var(--color-text-dim)]"> · peak</span>}
          </span>
        </span>
      ),
    };
  });

  return (
    <div>
      <BarChart
        data={data}
        height={120}
        zeroStub
        max={Math.max(peakMinutes, 60)}
        label="Completed session time per week, last 8 weeks"
        reveal="coaching-training-hours"
        summary={
          <span className="flex justify-between gap-3">
            <span className="text-[var(--color-text-dim)]">8-week total</span>
            <span>{hours.total} h</span>
          </span>
        }
      />
    </div>
  );
}
