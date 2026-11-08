import { parseISO } from 'date-fns';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { TrendChart } from '~/components/TrendChart';
import { speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { selectHistoryDay } from '~/lib/history';
import { latestFigure, recordRows, sessionDate, setsLine, trendPointLabel, trendSummary } from '~/lib/movementLines';
import { useMovementHistory } from '~/lib/records';
import { figureLead, restingFigure, space, useBlanc } from '~/theme/blanc';

/**
 * One movement over time: the latest estimated max (or most reps, for
 * bodyweight work), a line through every session, the records, and every
 * finished session, newest first; a session opens its workout in History.
 */
export default function MovementHistoryScreen() {
  const c = useBlanc();
  const large = useLargeText();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { history, loading, failed, refreshing, refresh } = useMovementHistory(id);
  const todayKey = useCurrentDayKey();
  const title = name || 'Movement';

  const sessions = history?.sessions ?? [];
  const figure = history ? latestFigure(history) : null;
  const latest = history?.trend[history.trend.length - 1] ?? null;
  const records = history ? recordRows(history.records, todayKey) : [];
  // A read that fails over a page already drawn keeps it, and says so.
  const refreshFailed = failed && history ? 'Couldn’t refresh this history. Pull down to try again.' : null;
  useAnnounce(refreshFailed);

  const openSession = (workoutId: string, day: string) => {
    // The workout screen reads History's month: History moves to the session's day first.
    selectHistoryDay(parseISO(day));
    router.push({ pathname: '/train/past', params: { id: workoutId } });
  };

  return (
    <>
      <Stack.Screen options={{ title }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {!history ? (
          loading ? (
            <ActivityIndicator color={c.graphite} style={{ marginTop: 40 }} accessibilityLabel="Loading history" />
          ) : (
            <Label style={{ marginTop: 12, padding: 18, gap: 12, alignItems: 'flex-start' }}>
              <BlancText variant="secondary" tone="graphite">
                History couldn’t load.
              </BlancText>
              <Capsule title="Retry" variant="quiet" onPress={() => void refresh()} />
            </Label>
          )
        ) : sessions.length === 0 ? (
          <Label style={{ marginTop: 12, padding: 18, gap: 2 }}>
            <BlancText variant="headline">No sessions yet</BlancText>
            <BlancText variant="secondary" tone="graphite">
              Finish a workout with {title} and it shows here, with your best sets and records.
            </BlancText>
          </Label>
        ) : (
          <>
            {figure && latest ? (
              // The latest session's figure, as Body weight leads with the latest weigh-in.
              <View
                accessible
                accessibilityLabel={speak(`${figure.what} ${figure.figure} ${figure.unit}, ${sessionDate(latest.day, todayKey)}`)}
                style={{ paddingHorizontal: space.gutter, paddingTop: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                  <BlancText variant="figure" size={56} style={{ ...restingFigure, marginLeft: figureLead(figure.figure, 56, { tabular: false }) }}>
                    {figure.figure}
                  </BlancText>
                  <BlancText variant="secondary" tone="graphite">
                    {figure.unit}
                  </BlancText>
                </View>
                <BlancText variant="secondary" tone="graphite">
                  {`${figure.what} · ${sessionDate(latest.day, todayKey)}`}
                </BlancText>
              </View>
            ) : null}
            {refreshFailed ? (
              <BlancText variant="footnote" tone="live" style={{ marginHorizontal: space.gutter, marginTop: 4 }}>
                {refreshFailed}
              </BlancText>
            ) : null}

            {/* Two sessions draw a line. */}
            {history.trend.length >= 2 ? (
              <Label style={{ marginTop: 24, padding: 18, paddingBottom: 12 }}>
                <TrendChart
                  points={history.trend.map((point) => ({ day: point.day, value: point.value, label: trendPointLabel(point, history.mode) }))}
                  height={160}
                  summary={trendSummary(history, todayKey)}
                  name={history.mode === 'load' ? 'Estimated max by session' : 'Most reps by session'}
                  minSpan={history.mode === 'load' ? 10 : 2}
                />
              </Label>
            ) : null}

            {records.length > 0 ? (
              <Section title="Records">
                <Label>
                  {records.map((record, index) => (
                    <View key={record.key}>
                      {index > 0 ? <Hairline /> : null}
                      <Row title={record.title} value={record.value} detail={record.detail} />
                    </View>
                  ))}
                </Label>
              </Section>
            ) : null}

            <Section title="Sessions">
              <Label>
                {sessions.map((session, index) => (
                  <View key={session.workoutId}>
                    {index > 0 ? <Hairline /> : null}
                    <Row
                      title={sessionDate(session.day, todayKey)}
                      detail={setsLine(session.sets)}
                      chevron
                      onPress={() => openSession(session.workoutId, session.day)}
                    />
                  </View>
                ))}
              </Label>
            </Section>
          </>
        )}
      </TabScroll>
    </>
  );
}
