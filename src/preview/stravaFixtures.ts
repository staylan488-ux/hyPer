// DEV-ONLY Strava transport fixtures for the /preview sandbox:
//   batch 1  first import  -> a long run (3 days ago) + a bike ride (yesterday).
//                             The long run shares its window with the WHOOP
//                             fixture run, so syncing both demos the merge.
//   batch 2  exact re-send -> zero changes (idempotence)
//   batch 3  fresh run     -> a run covering the last ~30 minutes; pairs with
//                             WHOOP fixture batch 5 for live cross-source merge
import type { StravaActivityRecord } from '@/lib/stravaImport';
import type { StravaFetchBatchParams, StravaFetchBatchResult } from '@/lib/stravaSync';

function daysAgoAt(days: number, hours: number, minutes: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function activity(
  id: string,
  name: string,
  sportType: string,
  start: Date,
  elapsedS: number,
  opts: { movingS?: number; distanceM?: number; avgHr?: number; maxHr?: number } = {},
): StravaActivityRecord {
  return {
    id,
    name,
    sport_type: sportType,
    start_date: start.toISOString(),
    utc_offset: -start.getTimezoneOffset() * 60,
    elapsed_time: elapsedS,
    moving_time: opts.movingS ?? elapsedS,
    distance: opts.distanceM ?? null,
    average_heartrate: opts.avgHr ?? null,
    max_heartrate: opts.maxHr ?? null,
  };
}

// same 06:50 window as the WHOOP fixture long run (wf-run-1) on purpose
const longRun = () =>
  activity('sf-long-run', 'Morning Long Run', 'Run', daysAgoAt(3, 6, 50), 45 * 60, {
    movingS: 44 * 60,
    distanceM: 8210,
    avgHr: 157,
    maxHr: 175,
  });

const ride = () =>
  activity('sf-ride', 'Evening Ride', 'Ride', daysAgoAt(1, 17, 0), 62 * 60, {
    movingS: 58 * 60,
    distanceM: 24100,
    avgHr: 141,
    maxHr: 166,
  });

// spans the recent past so it can merge with WHOOP fixture batch 5
function freshRun(): StravaActivityRecord {
  const start = new Date(Date.now() - 32 * 60 * 1000);
  return activity('sf-fresh-run', 'Tempo Run', 'Run', start, 27 * 60, {
    movingS: 26 * 60,
    distanceM: 5240,
    avgHr: 167,
    maxHr: 183,
  });
}

const batches: (() => StravaActivityRecord[])[] = [
  () => [longRun(), ride()],
  () => [longRun(), ride()],
  () => [freshRun()],
];

let fixtureCursor = 0;

export const STRAVA_FIXTURE_BATCH_COUNT = batches.length;

export function resetStravaFixtures(): void {
  fixtureCursor = 0;
}

export async function fetchStravaFixtureBatch(params: StravaFetchBatchParams): Promise<StravaFetchBatchResult> {
  void params;
  const batch = batches[Math.min(fixtureCursor, batches.length - 1)]();
  fixtureCursor = Math.min(fixtureCursor + 1, batches.length);
  return { records: batch, nextPage: null };
}
