import { BarChart, type BarDatum } from './BarChart';

export interface LapSample {
  key: string | number;
  durationS: number | null;
  distanceM: number | null;
  isRest?: boolean;
}

interface LapPaceChartProps {
  laps: LapSample[];
  /** Formats a pace in seconds per mile, or null when unknown. */
  formatPace: (secondsPerMile: number | null) => string | null;
  formatDistance: (meters: number | null) => string | null;
  formatDuration: (seconds: number | null) => string | null;
  reveal?: string;
  className?: string;
}

const METERS_PER_MILE = 1609.344;

/**
 * Lap-by-lap speed: taller is faster, the fastest lap is inked in Lacquer and
 * rest segments stay as gaps. Scrub to read each lap's pace.
 */
export function LapPaceChart({ laps, formatPace, formatDistance, formatDuration, reveal, className }: LapPaceChartProps) {
  const rows: { lap: LapSample; speed: number; number: number | null }[] = [];
  for (const lap of laps) {
    const moving = !lap.isRest && (lap.durationS ?? 0) > 0 && (lap.distanceM ?? 0) > 0;
    const speed = moving ? (lap.distanceM as number) / (lap.durationS as number) : 0;
    const previous = rows.filter((row) => row.number !== null).length;
    rows.push({ lap, speed, number: lap.isRest ? null : previous + 1 });
  }
  const moving = rows.filter((row) => row.speed > 0);
  if (moving.length < 2) return null;
  const fastest = moving.reduce((best, row) => (row.speed > best.speed ? row : best));
  const pace = (speed: number) => formatPace(speed > 0 ? METERS_PER_MILE / speed : null) ?? '—';

  const data: BarDatum[] = rows.map(({ lap, speed, number }) => {
    const label = number === null ? '·' : String(number);
    const isFastest = number !== null && fastest.number === number;
    const detail = number === null
      ? `Rest · ${formatDuration(lap.durationS) ?? '—'}`
      : `Lap ${number} · ${formatDuration(lap.durationS) ?? '—'} · ${formatDistance(lap.distanceM) ?? '—'}`;
    return {
      key: String(lap.key),
      label,
      value: speed,
      emphasis: isFastest,
      ariaLabel: number === null ? detail : `${detail}, pace ${pace(speed)}${isFastest ? ', fastest' : ''}`,
      readout: (
        <span className="flex justify-between gap-3">
          <span>{detail}</span>
          {number !== null && (
            <span className={isFastest ? 'text-[var(--color-accent)]' : ''}>{pace(speed)}</span>
          )}
        </span>
      ),
    };
  });

  return (
    <BarChart
      className={className}
      data={data}
      height={72}
      reveal={reveal}
      label="Pace per lap"
      summary={
        <span className="flex justify-between gap-3">
          <span className="text-[var(--color-text-dim)]">Fastest · lap {fastest.number}</span>
          <span className="text-[var(--color-accent)]">{pace(fastest.speed)}</span>
        </span>
      }
    />
  );
}
