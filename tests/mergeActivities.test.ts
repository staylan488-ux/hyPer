import { describe, expect, it } from 'vitest';

import { planActivityMerge } from '@/lib/mergeActivities';
import type { ActivitySession } from '@/types';

function session(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: 'a',
    user_id: 'user-1',
    activity_type: 'swimming',
    custom_type: null,
    title: null,
    date: '2026-07-08',
    started_at: '2026-07-08T14:00:00.000Z',
    ended_at: '2026-07-08T14:30:00.000Z',
    duration_seconds: 1800,
    source: 'whoop',
    notes: null,
    strain: 8,
    avg_hr: 130,
    max_hr: 150,
    energy_kcal: 300,
    distance_m: 1000,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: '2026-07-08T14:00:00.000Z',
    updated_at: '2026-07-08T14:00:00.000Z',
    ...overrides,
  };
}

describe('planActivityMerge', () => {
  it('merges two same-day swims into the earlier one', () => {
    const first = session({ id: 'first' });
    const second = session({
      id: 'second',
      started_at: '2026-07-08T14:40:00.000Z',
      ended_at: '2026-07-08T15:00:00.000Z',
      duration_seconds: 1200,
      distance_m: 600,
      energy_kcal: 200,
    });

    const plan = planActivityMerge([second, first])!;

    expect(plan.keepId).toBe('first');
    expect(plan.absorbIds).toEqual(['second']);
    // spans the whole window, not just the first record
    expect(plan.patch.started_at).toBe('2026-07-08T14:00:00.000Z');
    expect(plan.patch.ended_at).toBe('2026-07-08T15:00:00.000Z');
    // additive metrics sum
    expect(plan.patch.duration_seconds).toBe(3000);
    expect(plan.patch.distance_m).toBe(1600);
    expect(plan.patch.energy_kcal).toBe(500);
  });

  it('weights average HR by duration instead of averaging naively', () => {
    const long = session({ id: 'long', duration_seconds: 3000, avg_hr: 120 });
    const short = session({
      id: 'short',
      started_at: '2026-07-08T15:00:00.000Z',
      ended_at: '2026-07-08T15:02:00.000Z',
      duration_seconds: 120,
      avg_hr: 170,
      max_hr: 175,
    });

    const plan = planActivityMerge([long, short])!;

    // naive mean would be 145; duration-weighted is ~122
    expect(plan.patch.avg_hr).toBe(122);
    expect(plan.patch.max_hr).toBe(175);
  });

  it('keeps the largest strain rather than summing it', () => {
    // WHOOP strain is a logarithmic daily-load score; summing invents a value
    const a = session({ id: 'a', strain: 8 });
    const b = session({ id: 'b', started_at: '2026-07-08T15:00:00.000Z', strain: 11 });

    expect(planActivityMerge([a, b])!.patch.strain).toBe(11);
  });

  it('marks the survivor user_edited so a later sync cannot split it again', () => {
    const plan = planActivityMerge([session({ id: 'a' }), session({ id: 'b', started_at: '2026-07-08T15:00:00.000Z' })])!;
    expect(plan.patch.user_edited).toBe(true);
  });

  it('carries over a title or custom name from any of the merged records', () => {
    const a = session({ id: 'a', activity_type: 'other', custom_type: null });
    const b = session({
      id: 'b', activity_type: 'other', custom_type: 'Open water', title: 'Lake swim',
      started_at: '2026-07-08T15:00:00.000Z',
    });

    const plan = planActivityMerge([a, b])!;
    expect(plan.patch.title).toBe('Lake swim');
    expect(plan.patch.custom_type).toBe('Open water');
  });

  it('refuses to merge across different days or fewer than two records', () => {
    expect(planActivityMerge([session()])).toBeNull();
    expect(planActivityMerge([session({ id: 'a' }), session({ id: 'b', date: '2026-07-09' })])).toBeNull();
  });
});
