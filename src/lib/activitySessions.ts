import { format } from 'date-fns';

import { type ActivitySession, type ActivitySessionInput, type ActivityType } from '@/types';
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

/** "HH:mm" in local time for a timestamp, or '' without one. */
export function activityTimeValue(value?: string | null): string {
  const parsed = parseDate(value);
  return parsed ? format(parsed, 'HH:mm') : '';
}

/** A local day plus "HH:mm" as an ISO timestamp, or null for a missing or bad time. */
export function localDateTimeToIso(date: Date, timeValue: string): string | null {
  if (!timeValue) return null;
  const [hour, minute] = timeValue.split(':').map((value) => Number.parseInt(value, 10));
  if (![hour, minute].every(Number.isFinite)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const local = new Date(date);
  local.setHours(hour, minute, 0, 0);
  return local.toISOString();
}

/** Typed minutes as seconds, capped at a day; null when empty or not positive. */
export function parseDurationSeconds(durationMinutes: string): number | null {
  if (!durationMinutes.trim()) return null;
  const parsed = Number.parseInt(durationMinutes, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 24 * 60) * 60;
}

export interface ActivityForm {
  activityType: ActivityType;
  customType: string;
  title: string;
  date: Date;
  /** "HH:mm", or '' for no start time. */
  startTime: string;
  /** Whole minutes as typed. */
  durationMinutes: string;
  notes: string;
}

/**
 * The activity editor's fields as a save: a custom name only for "other"
 * (40 characters), the end from start plus duration, and the existing source
 * kept (else manual).
 */
export function buildActivityInput(form: ActivityForm, existing: Pick<ActivitySession, 'source'> | null): ActivitySessionInput {
  const durationSeconds = parseDurationSeconds(form.durationMinutes);
  const startedAt = localDateTimeToIso(form.date, form.startTime);
  const endedAt = startedAt && durationSeconds
    ? new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()
    : null;
  return {
    activity_type: form.activityType,
    custom_type: form.activityType === 'other' ? form.customType.trim().slice(0, 40) || null : null,
    title: form.title.trim() || null,
    date: format(form.date, 'yyyy-MM-dd'),
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    source: existing?.source || 'manual',
    notes: form.notes.trim() || null,
  };
}

/** Manual edits to an auto-grouped WHOOP import are marked so later syncs keep them. */
export function guardActivityEdit(input: ActivitySessionInput, editing: Pick<ActivitySession, 'source' | 'auto_grouped'> | null): ActivitySessionInput {
  return editing && editing.source === 'whoop' && editing.auto_grouped ? { ...input, user_edited: true } : input;
}
