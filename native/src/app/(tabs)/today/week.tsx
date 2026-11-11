import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { checkInWeekLabel, goalPaceKg, hasCheckIn, paceCall } from '@/lib/weekCheckIn';
import { formatWeight } from '@/lib/weightDisplayCore';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { TargetChangeRow, useShownTargetChange } from '~/components/TargetChangeRow';
import { useAnnounce } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { formatSet, formatWhole } from '~/lib/format';
import { loadWeekCheckIn, muscleNote, paceWeekLabel, recordDetail, signedWeight, useWeekCheckIn } from '~/lib/weekCheckIn';
import { useWeightStore } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Last week (from Monday's card on Today): the training week before this one,
 * Monday to Sunday. Body weight against the goal's pace, calories and protein
 * a day (led by this week's calorie target change, when there is one), sets
 * per muscle and the records set. Each section shows only when the week
 * holds it.
 */
export default function LastWeekScreen() {
  const todayKey = useCurrentDayKey();
  const { checkIn, loading, failed } = useWeekCheckIn(todayKey);
  const unit = useWeightStore((state) => state.unit);
  const target = useAppStore((state) => state.macroTarget);
  const profile = useAppStore((state) => state.nutritionProfile);
  const targetChange = useShownTargetChange();
  const [refreshing, setRefreshing] = useState(false);

  // Read again on opening, so an edit made in History since shows.
  useEffect(() => {
    void loadWeekCheckIn(todayKey);
  }, [todayKey]);
  useAnnounce(failed ? 'Last week couldn’t load.' : null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadWeekCheckIn(todayKey);
    setRefreshing(false);
  }, [todayKey]);

  const weight = checkIn?.weight ?? null;
  const paceKg = weight ? goalPaceKg(profile, weight.averageKg) : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Last week' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {!checkIn ? (
          <View style={{ marginTop: 24 }}>
            {failed ? <Failed onRetry={() => void loadWeekCheckIn(todayKey)} /> : loading ? <Waiting /> : null}
          </View>
        ) : !hasCheckIn(checkIn) ? (
          <Section title={checkInWeekLabel(checkIn.week)} style={{ marginTop: 6 }}>
            <Label style={{ paddingLeft: 18, paddingRight: 16, paddingVertical: 16 }}>
              <BlancText variant="secondary" tone="graphite">
                Nothing was logged that week.
              </BlancText>
            </Label>
          </Section>
        ) : (
          <>
            <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
              {checkInWeekLabel(checkIn.week)}
            </BlancText>

            {weight ? (
              // The call sits on the heading; each row is one figure.
              <Section title="Weight" note={weight.changeKg !== null && paceKg !== null ? capitalise(paceCall(weight.changeKg, paceKg)) : undefined}>
                <Label style={{ overflow: 'hidden' }}>
                  {weight.changeKg !== null ? (
                    <>
                      <Row title="Change" value={signedWeight(weight.changeKg, unit)} />
                      <Hairline />
                    </>
                  ) : null}
                  {paceKg !== null ? (
                    <>
                      <Row title="Pace" value={paceWeekLabel(paceKg, unit)} />
                      <Hairline />
                    </>
                  ) : null}
                  <Row title="Average" value={`${formatWeight(weight.averageKg, unit)} ${unit}`} />
                  <Hairline />
                  <Row title="Weigh-ins" value={`${weight.days} of 7 days`} />
                </Label>
              </Section>
            ) : null}

            {checkIn.eating || targetChange ? (
              // Past target is never red here: averages say how the week went,
              // not a warning. Monday's target change leads, as plain news.
              <Section title="Fuel" note={checkIn.eating ? `${checkIn.eating.days} of 7 days logged` : undefined}>
                <Label style={{ overflow: 'hidden' }}>
                  <TargetChangeRow after={checkIn.eating ? <Hairline /> : null} />
                  {checkIn.eating ? (
                    <>
                      <Row title="Calories a day" value={target ? `${formatWhole(checkIn.eating.calories)} of ${formatWhole(target.calories)} kcal` : `${formatWhole(checkIn.eating.calories)} kcal`} />
                      <Hairline />
                      <Row title="Protein a day" value={target ? `${formatWhole(checkIn.eating.protein)} of ${formatWhole(target.protein)} g` : `${formatWhole(checkIn.eating.protein)} g`} />
                    </>
                  ) : null}
                </Label>
              </Section>
            ) : null}

            {checkIn.muscles.length > 0 ? (
              <Section title="Muscles" note={`${formatWhole(checkIn.sets)} ${checkIn.sets === 1 ? 'set' : 'sets'}`}>
                <Label style={{ overflow: 'hidden' }}>
                  {checkIn.muscles.map((volume, index) => (
                    <View key={volume.muscle_group}>
                      {index > 0 ? <Hairline /> : null}
                      <Row
                        title={MUSCLE_GROUP_LABELS[volume.muscle_group] ?? volume.muscle_group}
                        detail={muscleNote(volume)}
                        value={`${formatSets(volume.weekly_sets)} ${volume.weekly_sets === 1 ? 'set' : 'sets'}`}
                      />
                    </View>
                  ))}
                </Label>
              </Section>
            ) : null}

            {checkIn.records.length > 0 ? (
              <Section title="Records">
                <Label style={{ overflow: 'hidden' }}>
                  {checkIn.records.map((record, index) => (
                    <View key={record.exerciseId}>
                      {index > 0 ? <Hairline /> : null}
                      <Row title={record.name} detail={recordDetail(record)} value={formatSet(record.set.weight, record.set.reps)} />
                    </View>
                  ))}
                </Label>
              </Section>
            ) : null}
          </>
        )}
      </TabScroll>
    </>
  );
}

/** "12", or "4.5" with a secondary muscle's half sets. */
function formatSets(sets: number): string {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1);
}

function capitalise(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Waiting() {
  const c = useBlanc();
  return (
    <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.graphite} accessibilityLabel="Loading last week" />
    </View>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={{ height: 120, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <BlancText variant="secondary" tone="graphite">
        Last week couldn’t load.
      </BlancText>
      <Capsule title="Retry" variant="quiet" onPress={onRetry} />
    </View>
  );
}
