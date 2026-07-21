import { Capacitor, registerPlugin } from '@capacitor/core';

/** Bridge to the in-app RestActivityPlugin (ios/App/App/RestActivityPlugin.swift):
 *  a lock-screen / Dynamic Island countdown for the running rest timer. iOS
 *  renders the ticking itself from the absolute end time — no updates needed. */
interface RestActivityBridge {
  start(options: { startedAtEpochMs: number; endsAtEpochMs: number; nextUpLabel?: string }): Promise<void>;
  end(): Promise<void>;
}

const RestActivity = registerPlugin<RestActivityBridge>('RestActivity');

export async function startRestLiveActivity(
  startedAtIso: string,
  endsAtIso: string,
  nextUpLabel?: string | null,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const startedAtEpochMs = new Date(startedAtIso).getTime();
  const endsAtEpochMs = new Date(endsAtIso).getTime();
  if (!Number.isFinite(endsAtEpochMs) || endsAtEpochMs <= Date.now()) return;

  try {
    await RestActivity.start({
      startedAtEpochMs: Number.isFinite(startedAtEpochMs) ? startedAtEpochMs : Date.now(),
      endsAtEpochMs,
      nextUpLabel: nextUpLabel ?? undefined,
    });
  } catch {
    // Live Activity is garnish on top of the in-app timer — fail quietly.
  }
}

export async function endRestLiveActivity(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await RestActivity.end();
  } catch {
    // Nothing running, or plugin unavailable — either way we're done.
  }
}
