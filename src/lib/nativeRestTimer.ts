import { NativeTimer, isNativeIOS } from '@/lib/nativeBridge';
import type { RestTimerSession } from '@/lib/restTimer';

export function nativeRestTimerID(workoutId: string): string {
  return workoutId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'workout';
}

export async function syncNativeRestTimerNotification(
  session: Pick<RestTimerSession, 'workoutId' | 'endsAt' | 'status'> | null,
): Promise<void> {
  if (!isNativeIOS() || !session) return;
  const id = nativeRestTimerID(session.workoutId);

  if (session.status !== 'running' || Date.parse(session.endsAt) <= Date.now()) {
    await NativeTimer.cancel({ id });
    return;
  }

  const { granted } = await NativeTimer.requestPermissions();
  if (!granted) return;
  await NativeTimer.schedule({
    id,
    title: 'Rest complete',
    body: 'Your next set is ready.',
    fireAt: session.endsAt,
  });
}

export async function cancelNativeRestTimerNotification(workoutId: string): Promise<void> {
  if (!isNativeIOS()) return;
  await NativeTimer.cancel({ id: nativeRestTimerID(workoutId) });
}
