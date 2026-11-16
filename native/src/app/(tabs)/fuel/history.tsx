import { format, parseISO } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { averageLoggedDays, fetchWeeklyNutrition, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { speak, useAnnounce } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { formatWhole } from '~/lib/format';
import { useFuelStore } from '~/lib/fuel';
import { historySpan, historyWeeks, historyWeekTitle, readFirstLoggedDay } from '~/lib/fuelHistory';
import { space, useBlanc } from '~/theme/blanc';

/** Weeks read at first, and added by each Show earlier weeks. */
const PAGE_WEEKS = 12;

/** A day's or a week's figures: "2,870 kcal · 135 g", leaving out a macro with nothing logged. */
function figures(calories: number, protein: number) {
  return [calories > 0 ? `${formatWhole(calories)} kcal` : null, protein > 0 ? `${formatWhole(protein)} g` : null].filter(Boolean).join(' · ');
}

/** Opens a past day in Fuel, to see or change what was eaten. */
function openDay(day: string) {
  useFuelStore.getState().select(day);
  router.back();
}

/**
 * Fuel's history (from the clock beside Log food): the days with food logged,
 * newest first, as weeks headed by their daily averages. Only logged days are
 * listed and counted, so a day without entries is simply not there. Today is
 * Fuel's own page and still under way, so the list starts yesterday. A day
 * opens in Fuel.
 */
export default function FuelHistoryScreen() {
  const c = useBlanc();
  const todayKey = useCurrentDayKey();
  const [weeks, setWeeks] = useState(PAGE_WEEKS);
  const [days, setDays] = useState<DailyNutrition[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The first day ever logged, so Show earlier weeks stops where the logging began.
  const [firstLogged, setFirstLogged] = useState<string | null | undefined>(undefined);
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const span = historySpan(todayKey, weeks);

  useEffect(() => {
    void readFirstLoggedDay().then(setFirstLogged);
  }, [round]);

  useEffect(() => {
    const read = (latest.current += 1);
    setBusy(true);
    void fetchWeeklyNutrition(span.lastKey, span.days).then((result) => {
      if (read !== latest.current) return;
      setBusy(false);
      setRefreshing(false);
      if (result) {
        setDays(result.weeklyNutrition);
        setFailed(false);
      } else setFailed(true);
    });
  }, [span.lastKey, span.days, round]);

  const failure = days ? 'Couldn’t refresh your history. Pull down to try again.' : 'Couldn’t load your history. Pull down to try again.';
  useAnnounce(failed && !busy ? failure : null);

  const grouped = historyWeeks(days ?? []);
  const more = firstLogged === undefined ? grouped.length > 0 : firstLogged !== null && firstLogged < span.firstKey;

  return (
    <>
      <Stack.Screen options={{ title: 'History' }} />
      <TabScroll
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setRound((value) => value + 1);
            }}
          />
        }>
        {days === null ? (
          failed ? (
            <BlancText variant="secondary" tone="live" style={{ marginHorizontal: space.gutter, marginTop: 24 }}>
              {failure}
            </BlancText>
          ) : (
            <View style={{ height: 160, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={c.graphite} accessibilityLabel="Loading history" />
            </View>
          )
        ) : (
          <>
            {failed ? (
              <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 12 }}>
                {failure}
              </BlancText>
            ) : null}
            {grouped.length === 0 ? (
              <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 24 }}>
                Days you log show here once they’re over.
              </BlancText>
            ) : null}
            {grouped.map((week, index) => {
              // One logged day is its own figure: an average of it would only repeat its row.
              const note = week.days.length > 1 ? `Avg ${figures(averageLoggedDays(week.days, 'calories'), averageLoggedDays(week.days, 'protein'))}` : undefined;
              return (
                <Section key={week.start} title={historyWeekTitle(week.start, todayKey)} note={note} style={index === 0 ? { marginTop: 12 } : undefined}>
                  <Label style={{ overflow: 'hidden' }}>
                    {week.days.map((day, row) => (
                      <View key={day.date}>
                        {row > 0 ? <Hairline /> : null}
                        <Row
                          title={format(parseISO(day.date), 'EEE, MMM d')}
                          value={figures(day.calories, day.protein)}
                          chevron
                          accessibilityLabel={speak(`${format(parseISO(day.date), 'EEEE, MMMM d')}, ${figures(day.calories, day.protein)}`)}
                          onPress={() => openDay(day.date)}
                        />
                      </View>
                    ))}
                  </Label>
                </Section>
              );
            })}
            {more ? (
              <View style={{ alignItems: 'center', marginTop: 24 }}>
                <Capsule title="Show earlier weeks" variant="quiet" busy={busy} disabled={busy} onPress={() => setWeeks((value) => value + PAGE_WEEKS)} />
              </View>
            ) : null}
          </>
        )}
      </TabScroll>
    </>
  );
}
