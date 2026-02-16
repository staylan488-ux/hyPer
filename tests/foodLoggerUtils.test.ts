import { describe, expect, it } from 'vitest';

import {
  buildLoggedAt,
  hasMissingColumnError,
  shouldDropColumn,
  toLocalTimeInput,
} from '@/components/nutrition/foodLoggerUtils';

describe('foodLoggerUtils', () => {
  it('builds logged_at string from selected day and time', () => {
    const date = new Date(2026, 1, 14, 9, 30);
    const loggedAt = buildLoggedAt(date, '07:45');
    const parsed = new Date(loggedAt);

    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(loggedAt.endsWith('Z')).toBe(true);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(1);
    expect(parsed.getDate()).toBe(14);
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(45);
  });

  it('falls back to noon when time is empty', () => {
    const date = new Date(2026, 5, 1, 8, 0);
    const parsed = new Date(buildLoggedAt(date, ''));

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(1);
    expect(parsed.getHours()).toBe(12);
    expect(parsed.getMinutes()).toBe(0);
  });

  it('formats fallback date into local HH:mm', () => {
    const fallbackDate = new Date(2026, 1, 14, 16, 5);
    expect(toLocalTimeInput(null, fallbackDate)).toBe('16:05');
  });

  it('returns noon for invalid date inputs', () => {
    expect(toLocalTimeInput('invalid-date', new Date(2026, 1, 14, 8, 0))).toBe('12:00');
  });

  it('detects missing-column schema errors', () => {
    const error = { message: 'column nutrition_logs.logged_at does not exist in schema cache' };
    expect(hasMissingColumnError(error, 'logged_at')).toBe(true);
    expect(shouldDropColumn(error, 'logged_at')).toBe(true);
  });

  it('ignores unrelated errors when deciding retries', () => {
    const error = { message: 'permission denied for table nutrition_logs' };
    expect(hasMissingColumnError(error, 'logged_at')).toBe(false);
    expect(shouldDropColumn(error, 'meal_type')).toBe(false);
  });
});
