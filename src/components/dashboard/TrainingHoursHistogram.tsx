import { format, parseISO } from 'date-fns';
import { BarChart, type BarDatum } from '@/components/shared/charts';
import type { TrainingHoursPoint } from '@/lib/workoutSessions';

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
      <div className="mt-1">
        <p className="metal-line">No training hours yet.</p>
        <p className="metal-note mt-1">Complete a workout to chart your weekly time</p>
      </div>
    );
  }

  const totalMinutes = points.reduce((sum, point) => sum + point.totalMinutes, 0);
  const data: BarDatum[] = points.map((point) => {
    const isPeak = point.totalMinutes > 0 && point.totalMinutes === peakMinutes;
    const week = format(parseISO(point.weekStart), 'MMM d');
    return {
      key: point.weekStart,
      label: point.label,
      value: point.totalMinutes,
      emphasis: isPeak,
      caption: point.totalHours > 0 ? (
        <>
          {point.totalHours}
          <span className="text-[var(--metal-ink-2)] ml-0.5">h</span>
        </>
      ) : (
        <span className="text-[var(--metal-ink-3)]">0<span className="ml-0.5">h</span></span>
      ),
      ariaLabel: `Week of ${week}: ${formatMinutes(point.totalMinutes)}${isPeak ? ', peak week' : ''}`,
      readout: (
        <span className="flex justify-between gap-3">
          <span>Week of {week}</span>
          <span>
            {formatMinutes(point.totalMinutes)}
            {isPeak && <span className="text-[var(--metal-red)]"> · peak</span>}
          </span>
        </span>
      ),
    };
  });

  return (
    <div>
      <BarChart
        data={data}
        height={144}
        max={Math.max(peakMinutes, 60)}
        label="Completed session time per week, last 8 weeks"
        reveal="coaching-training-hours"
        summary={
          <span className="flex justify-between gap-3">
            <span className="text-[var(--metal-ink-2)]">8-week total</span>
            <span>{formatMinutes(totalMinutes)}</span>
          </span>
        }
      />
      <p className="mt-3 text-[12.5px] leading-[1.4] text-[var(--metal-ink-2)]">
        Completed session time · last 8 weeks
      </p>
    </div>
  );
}
