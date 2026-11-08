// Movement history on native: the records the live workout's movements had
// before it (so Session complete can call out new ones), and one movement's
// history for its page. The rules are shared (src/lib/movementHistory).
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import { buildMovementHistory, fetchMovementSets, fetchPriorRecords, type MovementHistory, type MovementRecords } from '@/lib/movementHistory';
import { useAuthStore } from '@/stores/authStore';

import type { SessionModel } from './sessionModel';

/**
 * Each live movement's records before this workout, by exercise id. A
 * movement missing (the read hasn't landed, or it was added since) breaks no
 * record at Finish: a record is never called out on a guess.
 */
export const usePriorRecordsStore = create<{ workoutId: string | null; records: Record<string, MovementRecords> }>(() => ({
  workoutId: null,
  records: {},
}));

const NO_RECORDS: Record<string, MovementRecords> = {};

/**
 * Mounted once (tab layout): reads the live movements' records while a
 * workout is live. A failed read tries again on the next logged set.
 */
export function usePriorRecordsLookup(session: SessionModel | null) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [failed, setFailed] = useState(false);
  const exerciseKey = session ? session.movements.map((movement) => movement.exerciseId).sort().join(',') : '';
  const workoutId = session?.workoutId ?? null;
  const retry = failed ? (session?.doneCount ?? 0) : -1;

  useEffect(() => {
    if (!userId || !workoutId || !exerciseKey) return;
    let cancelled = false;
    const isCurrentAccount = captureAccountScope();
    void fetchPriorRecords(exerciseKey.split(','), workoutId).then((records) => {
      if (cancelled || !isCurrentAccount()) return;
      if (records) usePriorRecordsStore.setState({ workoutId, records });
      setFailed(!records);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, workoutId, exerciseKey, retry]);
}

/** The records before this workout ({} until the read lands), outside a component (Finish). */
export function priorRecordsFor(workoutId: string): Record<string, MovementRecords> {
  const state = usePriorRecordsStore.getState();
  return state.workoutId === workoutId ? state.records : NO_RECORDS;
}

export type MovementHistoryState = {
  history: MovementHistory | null;
  /** True until the first read lands or fails. */
  loading: boolean;
  /** The last read failed (an earlier history stays on screen). */
  failed: boolean;
  refreshing: boolean;
  /** Reads again: a pull to refresh, or Retry. */
  refresh: () => Promise<void>;
};

/**
 * One movement's finished sessions, records and trend, read when the page
 * opens and again each time it comes back into view (a past workout edited
 * from it), keeping what it shows while it reads.
 */
export function useMovementHistory(exerciseId: string | undefined): MovementHistoryState {
  const [history, setHistory] = useState<MovementHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest read may write.
  const request = useRef(0);

  const read = useCallback(async () => {
    if (!exerciseId) {
      setLoading(false);
      return;
    }
    const id = ++request.current;
    const isCurrentAccount = captureAccountScope();
    const rows = await fetchMovementSets([exerciseId]);
    if (id !== request.current || !isCurrentAccount()) return;
    if (rows) setHistory(buildMovementHistory(rows));
    setFailed(!rows);
    setLoading(false);
  }, [exerciseId]);

  // On the first focus and every return.
  useFocusEffect(
    useCallback(() => {
      void read();
    }, [read]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await read();
    } finally {
      setRefreshing(false);
    }
  }, [read]);

  return { history, loading, failed, refreshing, refresh };
}
