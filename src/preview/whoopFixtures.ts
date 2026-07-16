// DEV-ONLY WHOOP transport fixtures for the /preview sandbox. Each press of
// History's "Sync" steps to the next batch so the whole import lifecycle can
// be walked without WHOOP credentials:
//   batch 1  first import  -> interval run (8 laps) + tennis + single long run
//   batch 2  exact re-send -> zero changes (idempotence)
//   batch 3  late 9th lap  -> the SAME interval session grows to 9 splits
//   batch 4  sprint day    -> 6 short fast efforts group into one sprint session
//   batch 5  enrichment    -> a whoop record covering the last ~40 minutes; if
//                             you saved a tracked run just before syncing, its
//                             session gains strain/HR/kcal instead of a duplicate
import type { WhoopWorkoutRecord } from '@/lib/whoopImport';
import type { WhoopFetchBatchParams, WhoopFetchBatchResult } from '@/lib/whoopSync';

function daysAgoAt(days: number, hours: number, minutes: number, seconds = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, minutes, seconds, 0);
  return d;
}

function localOffsetString(date: Date): string {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(totalMinutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}:${m}`;
}

function workout(
  id: string,
  sport: string,
  start: Date,
  durationS: number,
  score: { strain: number; avgHr: number; maxHr: number; kilojoule: number; distanceM?: number },
): WhoopWorkoutRecord {
  const end = new Date(start.getTime() + durationS * 1000);
  return {
    id,
    sport_name: sport,
    start: start.toISOString(),
    end: end.toISOString(),
    timezone_offset: localOffsetString(start),
    score_state: 'SCORED',
    score: {
      strain: score.strain,
      average_heart_rate: score.avgHr,
      max_heart_rate: score.maxHr,
      kilojoule: score.kilojoule,
      distance_meter: score.distanceM ?? null,
    },
  };
}

const LAP_ACTIVE_S = 130;
const LAP_GAP_S = 85;

function lapRecords(count: number): WhoopWorkoutRecord[] {
  const firstLap = daysAgoAt(1, 7, 30);
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(firstLap.getTime() + i * (LAP_ACTIVE_S + LAP_GAP_S) * 1000);
    return workout(`wf-lap-${i + 1}`, 'running', start, LAP_ACTIVE_S, {
      strain: Math.round((5.2 + i * 0.4) * 10) / 10,
      avgHr: 166 + i * 2,
      maxHr: 177 + i * 2,
      kilojoule: 130,
      distanceM: 500 + i * 3,
    });
  });
}

const tennisRecord = workout('wf-tennis-1', 'tennis', daysAgoAt(1, 17, 30), 75 * 60, {
  strain: 10.1,
  avgHr: 132,
  maxHr: 168,
  kilojoule: 2170,
});

const longRunRecord = workout('wf-run-1', 'running', daysAgoAt(3, 6, 50), 45 * 60, {
  strain: 12.5,
  avgHr: 158,
  maxHr: 176,
  kilojoule: 2600,
  distanceM: 8200,
});

function sprintRecords(): WhoopWorkoutRecord[] {
  const firstSprint = daysAgoAt(0, 7, 10);
  return Array.from({ length: 6 }, (_, i) => {
    const start = new Date(firstSprint.getTime() + i * (58 + 150) * 1000);
    return workout(`wf-sprint-${i + 1}`, 'running', start, 58, {
      strain: Math.round((3.1 + i * 0.3) * 10) / 10,
      avgHr: 172 + i,
      maxHr: 186 + i,
      kilojoule: 60,
      distanceM: 330 + i * 4,
    });
  });
}

// spans "the last 40 minutes" at build time so it overlaps whatever run was
// just tracked and saved in the sandbox; no distance on purpose — GPS owns it
function enrichmentRecord(): WhoopWorkoutRecord {
  const end = new Date(Date.now() - 60 * 1000);
  const start = new Date(end.getTime() - 39 * 60 * 1000);
  return {
    id: 'wf-live-run',
    sport_name: 'running',
    start: start.toISOString(),
    end: end.toISOString(),
    timezone_offset: localOffsetString(start),
    score_state: 'SCORED',
    score: {
      strain: 11.3,
      average_heart_rate: 168,
      max_heart_rate: 190,
      kilojoule: 1850,
      distance_meter: null,
    },
  };
}

const batches: (() => WhoopWorkoutRecord[])[] = [
  () => [...lapRecords(8), tennisRecord, longRunRecord],
  () => [...lapRecords(8), tennisRecord, longRunRecord],
  () => lapRecords(9),
  () => sprintRecords(),
  () => [enrichmentRecord()],
];

let fixtureCursor = 0;

export const WHOOP_FIXTURE_BATCH_COUNT = batches.length;

export function getWhoopFixtureCursor(): number {
  return Math.min(fixtureCursor, batches.length - 1);
}

export function resetWhoopFixtures(): void {
  fixtureCursor = 0;
}

// fixture stand-in for the whoop-sync Edge Function transport; single page,
// advances one batch per sync run (clamps on the last batch)
export async function fetchWhoopFixtureBatch(params: WhoopFetchBatchParams): Promise<WhoopFetchBatchResult> {
  void params; // fixtures ignore the window; the real transport passes it to WHOOP
  const batch = batches[Math.min(fixtureCursor, batches.length - 1)]();
  fixtureCursor = Math.min(fixtureCursor + 1, batches.length);
  return { records: batch, nextToken: null };
}
