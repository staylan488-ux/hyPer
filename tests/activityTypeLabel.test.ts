import { describe, expect, it } from 'vitest';

import { activityTypeLabel, customActivityTypeSuggestions } from '@/lib/activityMetrics';
import { resolveActivityTitle } from '@/lib/activitySessions';

describe('activityTypeLabel', () => {
  it('uses the fixed label for a known type', () => {
    expect(activityTypeLabel({ activity_type: 'bike_ride' })).toBe('Bike ride');
  });

  it('uses the user name for a custom "other" activity', () => {
    expect(activityTypeLabel({ activity_type: 'other', custom_type: 'Yoga' })).toBe('Yoga');
  });

  it('falls back to "Other" when the custom name is blank', () => {
    expect(activityTypeLabel({ activity_type: 'other', custom_type: '   ' })).toBe('Other');
    expect(activityTypeLabel({ activity_type: 'other', custom_type: null })).toBe('Other');
  });

  it('ignores a stray custom name on a known type', () => {
    // the DB constraint forbids this pairing, but the UI must not mislabel it
    expect(activityTypeLabel({ activity_type: 'golf', custom_type: 'Yoga' })).toBe('Golf');
  });
});

describe('customActivityTypeSuggestions', () => {
  it('collects distinct custom names, ignoring known types and blanks', () => {
    expect(customActivityTypeSuggestions([
      { activity_type: 'other', custom_type: 'Yoga' },
      { activity_type: 'other', custom_type: 'Surfing' },
      { activity_type: 'other', custom_type: 'Yoga' },
      { activity_type: 'other', custom_type: '  ' },
      { activity_type: 'golf', custom_type: 'Ignored' },
      { activity_type: 'run' },
    ])).toEqual(['Yoga', 'Surfing']);
  });

  it('returns nothing when there are no custom activities', () => {
    expect(customActivityTypeSuggestions([{ activity_type: 'run' }])).toEqual([]);
  });
});

describe('resolveActivityTitle', () => {
  it('shows the custom name rather than "Other" for a named activity', () => {
    // regression: the row title fell back to the raw type label, so a WHOOP
    // ski import read "Other" even though its type label said "Skiing"
    expect(resolveActivityTitle({
      activity_type: 'other', custom_type: 'Skiing', title: null,
    })).toBe('Skiing');
  });

  it('still prefers an explicit user title', () => {
    expect(resolveActivityTitle({
      activity_type: 'other', custom_type: 'Skiing', title: 'Backcountry day',
    })).toBe('Backcountry day');
  });

  it('falls back to the type label for mapped types and unnamed others', () => {
    expect(resolveActivityTitle({ activity_type: 'run', custom_type: null, title: null })).toBe('Run');
    expect(resolveActivityTitle({ activity_type: 'other', custom_type: null, title: null })).toBe('Other');
  });
});
