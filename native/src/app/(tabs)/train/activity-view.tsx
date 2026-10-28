import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  activityTypeLabel,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  formatSegmentDistance,
  paceSecondsPerMile,
} from '@/lib/activityMetrics';
import { formatActivityDuration, formatActivityStartTime, resolveActivityTitle } from '@/lib/activitySessions';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySegment } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { useHistoryStore } from '~/lib/history';
import { space } from '~/theme/blanc';

const SOURCE_LABELS: Record<string, string> = { whoop: 'WHOOP', gps: 'Recorded in hyPer', manual: 'Added by hand' };

/**
 * One activity as History keeps it: what WHOOP or the run recorder measured,
 * its notes, and a run's splits (the web History's expanded row). Edit opens
 * the activity sheet.
 */
export default function ActivityViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const activity = useHistoryStore((state) => state.activities.find((entry) => entry.id === id) ?? null);
  const [segments, setSegments] = useState<ActivitySegment[] | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let current = true;
    void useAppStore
      .getState()
      .fetchActivitySegmentsBySessionIds([id])
      .then((loaded) => {
        if (current) setSegments(loaded);
      });
    return () => {
      current = false;
    };
  }, [id]);

  if (!activity) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
          This activity is no longer here.
        </BlancText>
      </>
    );
  }

  const title = resolveActivityTitle(activity);
  const typeLabel = activityTypeLabel(activity);
  const duration = formatActivityDuration(activity.duration_seconds);
  const pace = activity.activity_type === 'run' ? formatPace(paceSecondsPerMile(activity.distance_m, activity.duration_seconds)) : null;
  const rows: [string, string][] = [
    ...(typeLabel !== title ? [['Activity', typeLabel] as [string, string]] : []),
    ...(activity.started_at ? [['Started', formatActivityStartTime(activity.started_at)] as [string, string]] : []),
    ...(duration !== '-' ? [['Duration', duration] as [string, string]] : []),
    ...(formatDistanceMi(activity.distance_m) ? [['Distance', formatDistanceMi(activity.distance_m) as string] as [string, string]] : []),
    ...(pace ? [['Pace', pace] as [string, string]] : []),
    ...(activity.strain != null ? [['Strain', activity.strain.toFixed(1)] as [string, string]] : []),
    ...(activity.avg_hr != null ? [['Average heart rate', `${activity.avg_hr} bpm`] as [string, string]] : []),
    ...(activity.max_hr != null ? [['Max heart rate', `${activity.max_hr} bpm`] as [string, string]] : []),
    ...(activity.energy_kcal != null ? [['Energy', `${Math.round(activity.energy_kcal)} kcal`] as [string, string]] : []),
    ['Source', SOURCE_LABELS[activity.source] ?? activity.source],
  ];
  // As on the web: only the recording's own laps are splits; a WHOOP record
  // absorbed into a run adds its numbers, not rows. One segment is the whole run.
  const splits = (segments ?? []).filter((segment) => segment.source === activity.source);

  return (
    <>
      <Stack.Screen
        options={{
          title,
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Edit',
              onPress: () => {
                haptics.tap();
                router.push({ pathname: '/activity', params: { id: activity.id } });
              },
            },
          ],
        }}
      />
      <TabScroll>
        <Section title="Summary">
          <Label>
            {rows.map(([label, value], index) => (
              <View key={label}>
                {index > 0 ? <Hairline inset={18} /> : null}
                <Row title={label} quiet value={value} />
              </View>
            ))}
          </Label>
        </Section>

        {activity.notes?.trim() ? (
          <Section title="Notes">
            <Label>
              <BlancText variant="body" style={{ paddingHorizontal: 18, paddingVertical: 14 }}>
                {activity.notes.trim()}
              </BlancText>
            </Label>
          </Section>
        ) : null}

        {splits.length >= 2 ? (
          <Section title="Splits">
            <Label>
              {splits.map((segment, index) => (
                <View key={segment.id}>
                  {index > 0 ? <Hairline inset={18} /> : null}
                  <Row
                    title={`${index + 1}`}
                    quiet
                    detail={formatSegmentDistance(segment.distance_m) ?? undefined}
                    value={[
                      formatClockDuration(segment.duration_seconds),
                      formatPace(paceSecondsPerMile(segment.distance_m, segment.duration_seconds)),
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                    accessibilityLabel={`Split ${index + 1}, ${[
                      formatSegmentDistance(segment.distance_m),
                      formatClockDuration(segment.duration_seconds),
                      formatPace(paceSecondsPerMile(segment.distance_m, segment.duration_seconds)),
                    ]
                      .filter(Boolean)
                      .join(', ')}`}
                  />
                </View>
              ))}
            </Label>
          </Section>
        ) : null}
        {segments === null ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 12 }}>
            Splits could not load. Check your connection.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}
