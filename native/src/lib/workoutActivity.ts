// The live workout on the lock screen and in the Dynamic Island, as the web
// Train page mirrors it: the movement that's up, the shared detail line and
// the session clock. The rest timer layers its countdown onto the same card
// (lib/rest.ts). The card comes down when the workout ends.
import { useEffect } from 'react';

import { sessionTonnage } from '@/lib/workoutProgress';
import { workoutActivityDetailLine, type WorkoutActivityState } from '@/lib/workoutActivitySync';

import { endWorkoutActivity, syncWorkoutActivity } from '~/platform/liveActivity';

import { useAccountDay } from './accountData';
import { relabelRest, restLabel } from './rest';
import type { SessionModel } from './session';

export function workoutCard(session: SessionModel): WorkoutActivityState {
  const next = session.current;
  return {
    exerciseName: next?.movement.name ?? session.dayName,
    detailLine: workoutActivityDetailLine({
      nextSetNumber: next?.setNumber ?? null,
      completedSets: session.doneCount,
      totalSets: session.sets.length,
      tonnage: sessionTonnage(session.sets),
    }),
    sessionStartedAtEpochMs: session.startedAt.getTime(),
  };
}

/** Mounted once (tab layout), with the live workout. */
export function useWorkoutActivity(session: SessionModel | null) {
  // Before the account has loaded there is no workout yet, not a finished one.
  const loading = useAccountDay((state) => state.loading);
  const card = session ? workoutCard(session) : null;
  const key = card ? JSON.stringify(card) : null;

  useEffect(() => {
    if (card) syncWorkoutActivity(card);
    else if (!loading) endWorkoutActivity();
    // The key stands for the card's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading]);

  // A rest names the set that's up; if that changes mid-rest, the "Rest over"
  // notification follows.
  const next = session?.current;
  const label = next ? restLabel(next.movement.name, next.setNumber) : null;
  useEffect(() => {
    if (label) relabelRest(label);
  }, [label]);
}
