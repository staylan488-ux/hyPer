import { format, parseISO, startOfWeek } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { pickInsight, summarizeWeekVolume } from '@/components/dashboard/todayModel';
import { averageLoggedDays, useWeeklyNutrition, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { fetchTrainingHours } from '@/lib/trainingHours';
import { coachMuscles, type CoachingCall } from '@/lib/volumeCoaching';
import { getVolumeRecommendation } from '@/lib/volumeStatus';
import { TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { MuscleFigure } from '~/components/MuscleFigure';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/** Progress: this week's volume by muscle, training time over eight weeks, and the last week's eating. */
export default function ProgressScreen() {
  const volume = useAppStore((state) => state.weeklyVolume);
  const [volumeRead, setVolumeRead] = useState(false);
  const [hours, setHours] = useState<TrainingHoursPoint[] | null>(null);
  const [open, setOpen] = useState<MuscleGroup | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve(useAppStore.getState().calculateWeeklyVolume())
      .catch(() => {})
      .finally(() => {
        if (active) setVolumeRead(true);
      });
    void fetchTrainingHours().then((points) => {
      if (active) setHours(points);
    });
    void useAppStore.getState().fetchMacroTarget();
    return () => {
      active = false;
    };
  }, []);

  const coached = useMemo(() => coachMuscles(volume), [volume]);
  const week = summarizeWeekVolume(volume);
  const insight = pickInsight(volume);
  const rows = useMemo(() => new Set(volume.map((entry) => entry.muscle_group)), [volume]);

  // A tapped delt with no row of its own opens the general shoulders row.
  const pick = (muscle: MuscleGroup | null) => {
    haptics.select();
    if (!muscle) return setOpen(null);
    setOpen(rows.has(muscle) ? muscle : DELTS.includes(muscle) && rows.has('shoulders') ? 'shoulders' : muscle);
  };
  const chosen = open ? volume.find((entry) => entry.muscle_group === open) ?? null : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Progress' }} />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          Week of {format(startOfWeek(new Date(), TRAINING_WEEK), 'MMMM d')}
        </BlancText>

        {volume.length === 0 ? (
          volumeRead ? (
            <Label style={{ marginTop: 18, paddingHorizontal: 18, paddingVertical: 16, gap: 12 }}>
              <BlancText variant="headline">Nothing trained yet this week</BlancText>
              <BlancText variant="secondary" tone="graphite">
                Log a session and Progress tracks each muscle&apos;s weekly sets against its landmarks.
              </BlancText>
              <View style={{ alignSelf: 'flex-start' }}>
                <Capsule title="Start training" onPress={() => router.navigate('/train')} />
              </View>
            </Label>
          ) : null
        ) : (
          <>
            <Label style={{ marginTop: 18, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12 }}>
              <BlancText variant="secondary" tone="graphite" style={{ paddingHorizontal: 6, minHeight: 20 }} accessibilityLiveRegion="polite">
                {chosen
                  ? `${MUSCLE_GROUP_LABELS[chosen.muscle_group]} · ${formatSets(chosen.weekly_sets)}`
                  : `${week.inRange} of ${week.trained} muscles in range${insight && insight.tone !== 'zone' ? ` · ${insight.muscle} ${insight.flag}` : ''}`}
              </BlancText>
              <MuscleFigure volume={volume} selected={open} onPick={pick} />
            </Label>

            <Section title="By muscle">
              <Label style={{ overflow: 'hidden' }}>
                {coached.map(({ mv, call }, index) => (
                  <Animated.View key={mv.muscle_group} layout={LinearTransition.duration(220)}>
                    {index > 0 ? <Hairline /> : null}
                    <MuscleRow mv={mv} call={call} open={open === mv.muscle_group} onToggle={() => pick(open === mv.muscle_group ? null : mv.muscle_group)} />
                  </Animated.View>
                ))}
              </Label>
            </Section>
          </>
        )}

        <Section title="Training time" note="8 weeks">
          <Label style={{ paddingHorizontal: 18, paddingVertical: 16 }}>{hours ? <HoursChart points={hours} /> : <View style={{ height: 150 }} />}</Label>
        </Section>

        <NutritionSection />
      </TabScroll>
    </>
  );
}

const formatSets = (sets: number) => `${formatWhole(sets) === String(sets) ? sets : sets.toFixed(1)} ${sets === 1 ? 'set' : 'sets'}`;

function MuscleRow({ mv, call, open, onToggle }: { mv: MuscleVolume; call: CoachingCall; open: boolean; onToggle: () => void }) {
  const c = useBlanc();
  const hot = call.tone === 'berry';
  const name = MUSCLE_GROUP_LABELS[mv.muscle_group] ?? mv.muscle_group.replace('_', ' ');
  const recommendation = mv.landmark ? getVolumeRecommendation(mv.weekly_sets, mv.landmark) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${name}, ${formatSets(mv.weekly_sets)}, ${call.chip}. ${call.headline}`}
      onPress={onToggle}
      style={({ pressed }) => ({ paddingLeft: 18, paddingRight: 16, paddingVertical: 12, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <BlancText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {name}
        </BlancText>
        <BlancText variant="secondary" weight="500" tone={hot ? 'live' : 'ink'} style={{ fontVariant: ['tabular-nums'] }}>
          {formatSets(mv.weekly_sets)}
        </BlancText>
      </View>
      <BlancText variant="secondary" tone={hot ? 'live' : 'graphite'} numberOfLines={1} style={{ marginTop: 1 }}>
        {call.headline}
      </BlancText>
      {mv.landmark ? <Rail sets={mv.weekly_sets} landmark={mv.landmark} hot={hot} /> : null}
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 10, gap: 6 }}>
          <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {mv.landmark
              ? `Maintain ${mv.landmark.mv} · grow from ${mv.landmark.mev} · best ${mv.landmark.mav_low}–${mv.landmark.mav_high} · ceiling ${mv.landmark.mrv}`
              : 'No landmarks set for this muscle.'}
          </BlancText>
          {recommendation ? <BlancText variant="secondary">{recommendation.message}</BlancText> : null}
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/** Weekly sets on a line from zero past the ceiling, with the best range drawn in. */
function Rail({ sets, landmark, hot }: { sets: number; landmark: NonNullable<MuscleVolume['landmark']>; hot: boolean }) {
  const c = useBlanc();
  const max = Math.max(landmark.mrv * 1.1, sets, 1);
  const at = (value: number) => `${Math.min(100, (value / max) * 100)}%` as const;
  return (
    <View style={{ height: 10, marginTop: 10, justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      <View style={{ height: 3, borderRadius: 1.5, backgroundColor: c.track }} />
      <View
        style={{
          position: 'absolute',
          left: at(landmark.mav_low),
          width: `${Math.max(0, ((landmark.mav_high - landmark.mav_low) / max) * 100)}%`,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: c.graphite,
          opacity: 0.55,
        }}
      />
      <View style={{ position: 'absolute', left: at(landmark.mrv), width: 1.5, height: 9, backgroundColor: c.graphite, opacity: 0.6 }} />
      <View
        style={{
          position: 'absolute',
          left: at(sets),
          marginLeft: -5,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: hot ? c.live : c.ink,
          borderWidth: 2,
          borderColor: c.label,
        }}
      />
    </View>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Eight weeks of training time; this week in ink. */
function HoursChart({ points }: { points: TrainingHoursPoint[] }) {
  const c = useBlanc();
  const peak = Math.max(60, ...points.map((point) => point.totalMinutes));
  const current = points[points.length - 1];
  return (
    <View
      accessible
      accessibilityLabel={`Training time, last 8 weeks. This week ${formatMinutes(current?.totalMinutes ?? 0)}. ${points
        .map((point) => `${point.label}: ${formatMinutes(point.totalMinutes)}`)
        .join(', ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <BlancText variant="secondary" tone="graphite">
          This week
        </BlancText>
        <BlancText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'] }}>
          {formatMinutes(current?.totalMinutes ?? 0)}
        </BlancText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110, marginTop: 14 }}>
        {points.map((point, index) => (
          <View key={point.weekStart} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <View
              style={{
                height: `${Math.max(point.totalMinutes > 0 ? 3 : 1.5, (point.totalMinutes / peak) * 100)}%`,
                borderRadius: 3,
                borderCurve: 'continuous',
                backgroundColor: index === points.length - 1 ? c.ink : point.totalMinutes > 0 ? c.graphite : c.track,
                opacity: index === points.length - 1 || point.totalMinutes === 0 ? 1 : 0.5,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <BlancText variant="footnote" tone="graphite">
          {points[0]?.label}
        </BlancText>
        <BlancText variant="footnote" tone="graphite">
          This week
        </BlancText>
      </View>
    </View>
  );
}

function NutritionSection() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const target = useAppStore((state) => state.macroTarget);
  return (
    <Section title="Nutrition" note="Last 7 days">
      <Label style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
        {loading ? (
          <View style={{ height: 120 }} />
        ) : error ? (
          <BlancText variant="secondary" tone="live">
            Couldn&apos;t load your nutrition. Open Progress again to retry.
          </BlancText>
        ) : weeklyNutrition.length === 0 ? (
          <BlancText variant="secondary" tone="graphite">
            Log meals in Fuel to see the week here.
          </BlancText>
        ) : (
          <View style={{ gap: 22 }}>
            <MacroBars days={weeklyNutrition} macro="calories" label="Calories" unit="kcal" target={target?.calories ?? 0} />
            <MacroBars days={weeklyNutrition} macro="protein" label="Protein" unit="g" target={target?.protein ?? 0} />
          </View>
        )}
      </Label>
    </Section>
  );
}

/** One macro across the last seven days, against its daily target (dashed). */
function MacroBars({ days, macro, label, unit, target }: { days: DailyNutrition[]; macro: 'calories' | 'protein'; label: string; unit: string; target: number }) {
  const c = useBlanc();
  const average = averageLoggedDays(days, macro);
  const max = Math.max(1, target * 1.3, ...days.map((day) => day[macro]));
  const share = target > 0 && average > 0 ? ` · ${Math.round((average / target) * 100)}%` : '';
  return (
    <View
      accessible
      accessibilityLabel={`${label}, daily average ${formatWhole(average)} ${unit}${share}. ${days
        .map((day) => `${format(parseISO(day.date), 'EEEE')}: ${formatWhole(day[macro])}`)
        .join(', ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <BlancText variant="bodyStrong">{label}</BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {formatWhole(average)}
          </BlancText>{' '}
          {unit} a day{share}
        </BlancText>
      </View>
      <View style={{ height: 72, marginTop: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {target > 0 ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${(target / max) * 100}%`,
              borderTopWidth: 1,
              borderStyle: 'dashed',
              borderColor: c.graphite,
              opacity: 0.6,
            }}
          />
        ) : null}
        {days.map((day) => {
          const over = macro === 'calories' && target > 0 && day.calories > target * 1.05;
          return (
            <View key={day.date} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              <View
                style={{
                  height: `${Math.max(day[macro] > 0 ? 3 : 1.5, (day[macro] / max) * 100)}%`,
                  borderRadius: 3,
                  borderCurve: 'continuous',
                  backgroundColor: day[macro] === 0 ? c.track : over ? c.live : c.ink,
                }}
              />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        {days.map((day) => (
          <BlancText key={day.date} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {format(parseISO(day.date), 'EEEEE')}
          </BlancText>
        ))}
      </View>
    </View>
  );
}
