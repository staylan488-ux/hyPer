// The live workout on the lock screen and in the Dynamic Island, as the web
// Train page mirrors it: the movement that's up, the shared detail line and
// the session clock. The rest timer layers its countdown onto the same card
// (lib/rest.ts). The card comes down when the workout ends.
import { useEffect, useRef } from 'react';

import { workoutActivityDetailLine, type WorkoutActivityState } from '@/lib/workoutActivitySync';
import { sessionTonnage } from '@/lib/workoutProgress';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { endWorkoutActivity, syncWorkoutActivity } from '~/platform/liveActivity';

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
  // Only the workout read decides whether the old card is still live. A
  // failed program or nutrition read must not keep a finished workout up.
  const userId = useAuthStore((state) => state.user?.id);
  const loaded = useAppStore((state) => Boolean(userId) && state.workoutLoadedForUserId === userId);
  const shownForUser = useRef<string | undefined>(undefined);
  const card = session ? workoutCard(session) : null;
  const key = card ? JSON.stringify(card) : null;

  useEffect(() => {
    if (card && userId) {
      shownForUser.current = userId;
      syncWorkoutActivity(card);
    } else if (userId && (loaded || shownForUser.current === userId)) {
      endWorkoutActivity();
    }
    // The key stands for the card's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, loaded]);

  // A rest names the set that's up; if that changes mid-rest, the "Rest over"
  // notification follows.
  const next = session?.current;
  const label = next ? restLabel(next.movement.name, next.setNumber) : null;
  useEffect(() => {
    if (label) relabelRest(label);
  }, [label]);
}
