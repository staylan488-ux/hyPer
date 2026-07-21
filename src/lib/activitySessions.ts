import { format } from 'date-fns';

import { type ActivitySession } from '@/types';
import { activityTypeLabel } from '@/lib/activityMetrics';

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getActivitySessionDateKey(session: Pick<ActivitySession, 'date' | 'started_at'>): string {
  if (session.date) return session.date;

  const startedAt = parseDate(session.started_at);
  return startedAt ? format(startedAt, 'yyyy-MM-dd') : '';
}

export function resolveActivityTitle(
  session: Pick<ActivitySession, 'activity_type' | 'custom_type' | 'title'>,
): string {
  const trimmedTitle = session.title?.trim();
  if (trimmedTitle) return trimmedTitle;
  // a user-named or WHOOP-named "other" activity must not fall back to "Other"
  return activityTypeLabel(session) || 'Activity';
}

export function formatActivityDuration(durationSeconds?: number | null): string {
  if (!durationSeconds || durationSeconds <= 0) return '-';

  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${totalMinutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatActivityStartTime(startedAt?: string | null): string | null {
  const parsed = parseDate(startedAt);
  return parsed ? format(parsed, 'h:mm a') : null;
}

export function sortActivitySessionsByStart<T extends Pick<ActivitySession, 'started_at' | 'created_at' | 'date'>>(sessions: T[]): T[] {
  return sessions.slice().sort((a, b) => {
    const left = parseDate(a.started_at) || parseDate(a.created_at) || parseDate(`${a.date}T00:00:00`);
    const right = parseDate(b.started_at) || parseDate(b.created_at) || parseDate(`${b.date}T00:00:00`);
    return (left?.getTime() || 0) - (right?.getTime() || 0);
  });
}
