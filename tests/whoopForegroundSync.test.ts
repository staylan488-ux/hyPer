import { describe, expect, it } from 'vitest';

import {
  WHOOP_AUTO_SYNC_INTERVAL_MS,
  shouldAttemptWhoopAutoSync,
} from '@/lib/whoopForegroundSync';

describe('WHOOP foreground sync throttling', () => {
  const now = Date.parse('2026-07-19T20:00:00Z');

  it('syncs a connection that has never synchronized', () => {
    expect(shouldAttemptWhoopAutoSync(now, undefined, null)).toBe(true);
  });

  it('does not duplicate a recent attempt or recent successful sync', () => {
    expect(shouldAttemptWhoopAutoSync(now, now - 1_000, null)).toBe(false);
    expect(shouldAttemptWhoopAutoSync(
      now,
      undefined,
      new Date(now - WHOOP_AUTO_SYNC_INTERVAL_MS + 1_000).toISOString(),
    )).toBe(false);
  });

  it('reconciles after the foreground interval elapses', () => {
    expect(shouldAttemptWhoopAutoSync(
      now,
      now - WHOOP_AUTO_SYNC_INTERVAL_MS,
      new Date(now - WHOOP_AUTO_SYNC_INTERVAL_MS).toISOString(),
    )).toBe(true);
  });
});
