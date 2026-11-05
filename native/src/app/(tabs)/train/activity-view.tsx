import { format, isValid, parseISO } from 'date-fns';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  activityTypeLabel,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  formatSegmentDistance,
  paceSecondsPerMile,
} from '@/lib/activityMetrics';
import { formatActivityStartTime, getActivitySessionDateKey, resolveActivityTitle } from '@/lib/activitySessions';
import { isRestSegment } from '@/lib/runDisplay';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySegment } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { speak, spokenClock, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatMinutes } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useHistoryStore } from '~/lib/history';
import { space, useBlanc } from '~/theme/blanc';

const SOURCE_LABELS: Record<string, string> = { whoop: 'WHOOP', gps: 'Recorded in hyPer', manual: 'Added by hand' };

/** A pace ("7:32 /mi") in words: "7 minutes 32 seconds per mile". */
function spokenPace(secondsPerMile: number | null): string | null {
  return secondsPerMile !== null && formatPace(secondsPerMile) ? `${spokenClock(Math.round(secondsPerMile))} per mile` : null;
}

/** A split's distance with metres in words ("400 meters"); Row speaks miles itself. */
function spokenSegmentDistance(distanceM: number | null): string | null {
  const shown = formatSegmentDistance(distanceM);
  return shown?.endsWith(' m') ? `${shown.slice(0, -2)} meters` : shown;
}

/**
 * One activity as History keeps it: what WHOOP or the run recorder measured,
 * its notes, and a run's splits (the web History's expanded row). Edit opens
 * the activity sheet.
 */
export default function ActivityViewScreen() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useHistoryStore((state) => state.activities.find((entry) => entry.id === id) ?? null);
  // The last one seen: deleted from its edit sheet, it stays drawn under the
  // sheet, and this screen goes back as soon as it is showing again.
  const [seen, setSeen] = useState(stored);
  if (stored && stored !== seen) setSeen(stored);
  const activity = stored ?? seen;
  const gone = stored === null && seen !== null;
  useFocusEffect(
    useCallback(() => {
      if (gone) router.back();
    }, [gone]),
  );
  const [segments, setSegments] = useState<ActivitySegment[] | null | undefined>(undefined);
  useAnnounce(segments === null && 'Splits could not load');

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
        {/* In the screen's scroll view, so it sits below the header as the activity would. */}
        <TabScroll>
          <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
            This activity is no longer here.
          </BlancText>
        </TabScroll>
      </>
    );
  }

  const title = resolveActivityTitle(activity);
  const typeLabel = activityTypeLabel(activity);
  const duration = activity.duration_seconds && activity.duration_seconds > 0 ? formatMinutes(Math.max(1, Math.round(activity.duration_seconds / 60))) : null;
  const paceSeconds = activity.activity_type === 'run' ? paceSecondsPerMile(activity.distance_m, activity.duration_seconds) : null;
  const pace = activity.activity_type === 'run' ? formatPace(paceSeconds) : null;
  // The head the past workout has: the day, when it started and how long it ran.
  const day = parseISO(getActivitySessionDateKey(activity));
  const startedAt = formatActivityStartTime(activity.started_at);
  const meta = [isValid(day) ? format(day, 'EEE · MMM d') : null, startedAt, duration].filter(Boolean).join(' · ');
  // VoiceOver hears the day and month in full and the length in words:
  // "Tuesday, October 27, 7:00 AM, 45 minutes".
  const spokenMeta = speak([isValid(day) ? format(day, 'EEEE, MMMM d') : null, startedAt, duration].filter(Boolean).join(', '));
  // What VoiceOver says for a row whose value is shorthand ("7:32 /mi", "bpm").
  const spokenValues: Record<string, string | null> = {
    Pace: spokenPace(paceSeconds),
    'Average heart rate': activity.avg_hr != null ? `${activity.avg_hr} beats per minute` : null,
    'Max heart rate': activity.max_hr != null ? `${activity.max_hr} beats per minute` : null,
  };
  const rows: [string, string][] = [
    ...(typeLabel !== title ? [['Activity', typeLabel] as [string, string]] : []),
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
  const edit = () => router.push({ pathname: '/activity', params: { id: activity.id } });

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
                edit();
              },
            },
          ],
        }}
      />
      <TabScroll>
        <BlancText variant="meta" size={13} tone="graphite" accessibilityLabel={spokenMeta} style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {meta}
        </BlancText>
        <Label style={{ marginTop: 18 }}>
          {rows.map(([label, value], index) => (
            <View key={label}>
              {index > 0 ? <Hairline inset={18} /> : null}
              <ValueRow label={label} value={value} accessibilityLabel={spokenValues[label] ? `${label}, ${spokenValues[label]}` : undefined} />
            </View>
          ))}
        </Label>

        {activity.notes?.trim() ? (
          <Section title="Notes">
            {/* The note opens the editor, as Edit does. */}
            <Label style={{ overflow: 'hidden' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Edit activity"
                onPress={() => {
                  haptics.tap();
                  edit();
                }}
                style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: 14, backgroundColor: pressed ? c.pressed : 'transparent' })}>
                <BlancText variant="body">{activity.notes.trim()}</BlancText>
              </Pressable>
            </Label>
          </Section>
        ) : null}

        {splits.length >= 2 ? (
          <Section title="Splits">
            <Label>
              {splits.map((segment, index) => {
                // A rest reads as on the finished run: its time, no distance or pace.
                const rest = isRestSegment(segment);
                const time = formatClockDuration(segment.duration_seconds);
                const distance = rest ? null : formatSegmentDistance(segment.distance_m);
                const pace = rest ? null : formatPace(paceSecondsPerMile(segment.distance_m, segment.duration_seconds));
                const spokenTime =
                  segment.duration_seconds != null && segment.duration_seconds >= 0 ? spokenClock(Math.round(segment.duration_seconds)) : null;
                return (
                  <View key={segment.id}>
                    {index > 0 ? <Hairline inset={18} /> : null}
                    <ValueRow
                      label={rest ? '·' : `${index + 1}`}
                      detail={rest ? 'rest' : distance ?? undefined}
                      value={[time, pace].filter(Boolean).join(' · ')}
                      accessibilityLabel={
                        rest
                          ? ['Rest', spokenTime].filter(Boolean).join(', ')
                          : `Split ${index + 1}, ${[
                              spokenSegmentDistance(segment.distance_m),
                              spokenTime,
                              spokenPace(paceSecondsPerMile(segment.distance_m, segment.duration_seconds)),
                            ]
                              .filter(Boolean)
                              .join(', ')}`
                      }
                    />
                  </View>
                );
              })}
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

/**
 * A measured value as the receipt at Finish writes one: the label in graphite, the figure in ink, read as one
 * and in words ("Energy, 450 calories"). At the accessibility text sizes the figure goes under the label.
 */
function ValueRow({ label, detail, value, accessibilityLabel }: { label: string; detail?: string; value: string; accessibilityLabel?: string }) {
  const large = useLargeText();
  const figure = (
    <BlancText variant="body" style={{ fontVariant: ['tabular-nums'] }}>
      {value}
    </BlancText>
  );
  return (
    <View accessible accessibilityLabel={speak(accessibilityLabel ?? `${label}, ${value}`)}>
      <Row title={label} detail={detail} quiet trailing={large ? undefined : figure} />
      {large ? <View style={{ paddingLeft: 18, paddingRight: 16, paddingBottom: 12 }}>{figure}</View> : null}
    </View>
  );
}
