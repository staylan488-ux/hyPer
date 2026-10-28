import { useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';

import { confirmAlert } from './program';

type LeaveAction = Parameters<NonNullable<Parameters<typeof usePreventRemove>[1]>>[0]['data']['action'];

/**
 * Holds a screen with unsaved edits: closing it (a button, swipe down or swipe
 * back) asks first. After Discard the guard steps aside before the close runs
 * again; dispatching straight from the question let the still-active guard
 * stop it and ask again, forever (the owner hit that on 2026-10-27).
 */
export function useLeaveGuard(
  dirty: boolean,
  question: { title: string; message?: string } = { title: 'Discard your changes?' },
  options: { busy?: boolean } = {},
) {
  const navigation = useNavigation();
  const [leaving, setLeaving] = useState<LeaveAction | null>(null);

  usePreventRemove(dirty && leaving === null, ({ data }) => {
    if (options.busy) return;
    void confirmAlert({ ...question, confirmLabel: 'Discard', cancelLabel: 'Keep editing', destructive: true }).then((discard) => {
      if (discard) setLeaving(data.action);
    });
  });

  useEffect(() => {
    if (leaving) navigation.dispatch(leaving);
  }, [leaving, navigation]);
}
