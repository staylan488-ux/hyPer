// Pure aggregation + formatting helpers for activity segments and session
// metrics. Shared by the WHOOP import grouping engine, the GPS run tracker,
// and the History splits ledger.
import type { ActivitySegment } from '@/types';

export interface SegmentAggregates {
  duration_seconds: number | null;
  distance_m: number | null;
  energy_kcal: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
}

type AggregatableSegment = Pick<
  ActivitySegment,
  'started_at' | 'ended_at' | 'duration_seconds' | 'strain' | 'avg_hr' | 'max_hr' | 'energy_kcal' | 'distance_m'
>;

function segmentDurationSeconds(segment: AggregatableSegment): number | null {
  if (segment.duration_seconds != null && segment.duration_seconds >= 0) return segment.duration_seconds;

  const start = Date.parse(segment.started_at);
  const end = Date.parse(segment.ended_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

// rolls child segments up to session-level metrics. avg_hr is duration-weighted,
// max_hr is the max, kcal/distance/duration are sums over ACTIVE segments only
// (rest between laps is excluded), and strain is the max — strain is WHOOP's
// non-additive 0-21 scale, so max is a documented approximation, not a sum
export function aggregateSegments(segments: AggregatableSegment[]): SegmentAggregates {
  const empty: SegmentAggregates = {
    duration_seconds: null,
    distance_m: null,
    energy_kcal: null,
    avg_hr: null,
    max_hr: null,
    strain: null,
  };
  if (segments.length === 0) return empty;

  let totalDuration = 0;
  let hasDuration = false;
  let distance = 0;
  let hasDistance = false;
  let kcal = 0;
  let hasKcal = false;
  let hrWeighted = 0;
  let hrWeight = 0;
  let maxHr: number | null = null;
  let strain: number | null = null;

  for (const segment of segments) {
    const duration = segmentDurationSeconds(segment);
    if (duration != null) {
      totalDuration += duration;
      hasDuration = true;
    }
    if (segment.distance_m != null) {
      distance += segment.distance_m;
      hasDistance = true;
    }
    if (segment.energy_kcal != null) {
      kcal += segment.energy_kcal;
      hasKcal = true;
    }
    if (segment.avg_hr != null && duration != null && duration > 0) {
      hrWeighted += segment.avg_hr * duration;
      hrWeight += duration;
    }
    if (segment.max_hr != null) {
      maxHr = maxHr == null ? segment.max_hr : Math.max(maxHr, segment.max_hr);
    }
    if (segment.strain != null) {
      strain = strain == null ? segment.strain : Math.max(strain, segment.strain);
    }
  }

  return {
    duration_seconds: hasDuration ? totalDuration : null,
    distance_m: hasDistance ? distance : null,
    energy_kcal: hasKcal ? Math.round(kcal) : null,
    avg_hr: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null,
    max_hr: maxHr,
    strain: strain == null ? null : Math.round(strain * 10) / 10,
  };
}

export const MILE_M = 1609.344;

// user preference: paces and long distances read in miles
export function formatDistanceMi(distanceM?: number | null): string | null {
  if (distanceM == null || distanceM <= 0) return null;

  const miles = distanceM / MILE_M;
  if (miles < 10) return `${miles.toFixed(2)} mi`;
  return `${miles.toFixed(1)} mi`;
}

// seconds-per-mile -> "7:32 /mi"; guards absurd paces from GPS noise
export function formatPace(secondsPerMile?: number | null): string | null {
  if (secondsPerMile == null || !Number.isFinite(secondsPerMile) || secondsPerMile <= 0) return null;
  if (secondsPerMile > 3600) return null;

  const rounded = Math.round(secondsPerMile);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} /mi`;
}

export function paceSecondsPerMile(distanceM?: number | null, durationSeconds?: number | null): number | null {
  if (!distanceM || !durationSeconds || distanceM <= 0 || durationSeconds <= 0) return null;
  return durationSeconds / (distanceM / MILE_M);
}

// compact seconds -> "12:04" or "1:02:31" for split/lap tables
export function formatClockDuration(totalSeconds?: number | null): string | null {
  if (totalSeconds == null || totalSeconds < 0) return null;

  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function sortSegmentsByStart<T extends Pick<ActivitySegment, 'started_at'>>(segments: T[]): T[] {
  return segments.slice().sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}
