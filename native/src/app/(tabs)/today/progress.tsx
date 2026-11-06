import { format, parseISO, startOfWeek } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { summarizeWeekVolume } from '@/lib/todayModel';
import { averageLoggedDays, useWeeklyNutrition, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { warnsOverTarget } from '@/lib/fuelSummary';
import { fetchTrainingHours } from '@/lib/trainingHours';
import { coachMuscles, type CoachingCall } from '@/lib/volumeCoaching';
import { TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';
import { initialAppData, useAppStore } from '@/stores/appStore';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { MuscleFigure } from '~/components/MuscleFigure';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { useAccountDay, useCurrentDayKey } from '~/lib/accountData';
import { speak, spokenClock, useAnnounce, useIncreaseContrast, useLargeText } from '~/lib/accessibility';
import { formatMinutes, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/** Progress: this week's volume by muscle, training time over eight weeks, and the last week's eating. */
export default function ProgressScreen() {
  const volume = useAppStore((state) => state.weeklyVolume);
  // The account's day, whose week the volume below was read for.
  const dayKey = useAccountDay((state) => state.dayKey);
  // The first read that works always stores a new list (a failed one leaves it
  // as it was), and sign-out puts back initialAppData's, so a different list
  // means this account's week was read, by this screen or any other.
  const volumeRead = useAppStore((state) => state.weeklyVolume !== initialAppData.weeklyVolume);
  const [hours, setHours] = useState<TrainingHoursPoint[] | null>(null);
  const [open, setOpen] = useState<MuscleGroup | null>(null);
  // Pull to refresh reads everything again; the nutrition block remounts to refetch.
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(true);
  const large = useLargeText();

  const load = useCallback(async () => {
    await Promise.all([
      Promise.resolve(useAppStore.getState().calculateWeeklyVolume()).catch(() => {}),
      fetchTrainingHours().then((points) => {
        if (active.current && points) setHours(points);
      }),
      useAppStore.getState().fetchMacroTarget(),
    ]);
  }, []);

  useEffect(() => {
    active.current = true;
    void load().catch(() => {});
    return () => {
      active.current = false;
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setRound((value) => value + 1);
    await load().catch(() => {});
    if (active.current) setRefreshing(false);
  };

  const coached = useMemo(() => coachMuscles(volume), [volume]);
  const week = summarizeWeekVolume(volume);
  const rows = useMemo(() => new Set(volume.map((entry) => entry.muscle_group)), [volume]);

  // A tapped delt with no row of its own opens the general shoulders row.
  const pick = (muscle: MuscleGroup | null) => {
    haptics.select();
    if (!muscle) return setOpen(null);
    setOpen(rows.has(muscle) ? muscle : DELTS.includes(muscle) && rows.has('shoulders') ? 'shoulders' : muscle);
  };
  const chosen = open ? volume.find((entry) => entry.muscle_group === open) ?? null : null;
  const caption = chosen
    ? `${MUSCLE_GROUP_LABELS[chosen.muscle_group]} · ${formatSets(chosen.weekly_sets)}`
    : `${week.inRange} of ${week.trained} muscles in range`;

  return (
    <>
      <Stack.Screen options={{ title: 'Progress' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          Week of {format(startOfWeek(parseISO(dayKey), TRAINING_WEEK), 'MMMM d')}
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
              {/*
                One line either way, so a tap on a muscle never moves the figure
                (at the accessibility text sizes it wraps). No announcement when
                the choice changes: VoiceOver chooses on the figure (which speaks
                its new value) or on a muscle's row.
              */}
              <BlancText
                variant="secondary"
                tone="graphite"
                numberOfLines={large ? undefined : 1}
                style={{ paddingHorizontal: 6, minHeight: 20 }}
                accessibilityLabel={inWords(caption)}>
                {caption}
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
              {coached.some(({ mv }) => mv.landmark) ? (
                <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
                  The band is in range, its darker middle the best range.
                </BlancText>
              ) : null}
            </Section>
          </>
        )}

        <Section title="Training time" note="Last 8 weeks">
          <Label style={{ paddingHorizontal: 18, paddingVertical: 16 }}>{hours ? <HoursChart points={hours} /> : <View style={{ height: 150 }} />}</Label>
        </Section>

        <NutritionSection key={round} />
      </TabScroll>
    </>
  );
}

const formatSets = (sets: number) => `${formatWhole(sets) === String(sets) ? sets : sets.toFixed(1)} ${sets === 1 ? 'set' : 'sets'}`;

function MuscleRow({ mv, call, open, onToggle }: { mv: MuscleVolume; call: CoachingCall; open: boolean; onToggle: () => void }) {
  const c = useBlanc();
  const large = useLargeText();
  // Red only past the ceiling, as on the figure.
  const hot = mv.status === 'above_mrv';
  // Words only when something needs doing: under, over or near the ceiling.
  const words = call.priority <= 2;
  const name = MUSCLE_GROUP_LABELS[mv.muscle_group] ?? mv.muscle_group.replace('_', ' ');
  const landmarks = mv.landmark
    ? `Maintain ${mv.landmark.mv} · grow from ${mv.landmark.mev} · best ${mv.landmark.mav_low}–${mv.landmark.mav_high} · ceiling ${mv.landmark.mrv}`
    : 'No landmarks set for this muscle.';
  // One fact for VoiceOver, the rail's band and best range included, with the
  // words the row shows; an open row adds what it shows.
  const spoken = [
    `${name}, ${formatSets(mv.weekly_sets)}${mv.landmark ? `, in range ${mv.landmark.mev}–${mv.landmark.mrv}, best ${mv.landmark.mav_low}–${mv.landmark.mav_high}` : ''}, ${call.chip}`,
    words ? call.headline : null,
    open ? landmarks : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={inWords(spoken)}
      onPress={onToggle}
      style={({ pressed }) => ({ paddingLeft: 18, paddingRight: 16, paddingVertical: 12, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      {/* At the accessibility text sizes the sets wrap under a long name. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
        <BlancText variant="bodyStrong" style={large ? { flexShrink: 1 } : { flex: 1 }} numberOfLines={large ? undefined : 1}>
          {name}
        </BlancText>
        <BlancText variant="secondary" weight="500" tone={hot ? 'live' : 'ink'} style={{ fontVariant: ['tabular-nums'] }}>
          {formatSets(mv.weekly_sets)}
        </BlancText>
      </View>
      {words ? (
        <BlancText variant="secondary" tone={hot ? 'live' : 'graphite'} numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
          {call.headline}
        </BlancText>
      ) : null}
      {mv.landmark ? <Rail sets={mv.weekly_sets} landmark={mv.landmark} hot={hot} /> : null}
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 10 }}>
          <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {landmarks}
          </BlancText>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/**
 * Weekly sets on a line from zero past the ceiling. The band is in range
 * (from the minimum that grows, MEV, up to the ceiling, MRV), as the week's
 * "in range" counts it; its darker middle is the best range.
 */
function Rail({ sets, landmark, hot }: { sets: number; landmark: NonNullable<MuscleVolume['landmark']>; hot: boolean }) {
  const c = useBlanc();
  // Increase Contrast draws the quiet marks at full strength.
  const contrast = useIncreaseContrast();
  const max = Math.max(landmark.mrv * 1.1, sets, 1);
  const at = (value: number) => `${Math.min(100, (value / max) * 100)}%` as const;
  const span = (from: number, to: number) => `${Math.max(0, ((Math.min(to, max) - from) / max) * 100)}%` as const;
  return (
    <View style={{ height: 10, marginTop: 10, justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      <View style={{ height: 3, borderRadius: 1.5, backgroundColor: c.track }} />
      <View
        style={{
          position: 'absolute',
          left: at(landmark.mev),
          width: span(landmark.mev, landmark.mrv),
          height: 5,
          borderRadius: 2.5,
          backgroundColor: c.graphite,
          opacity: contrast ? 0.45 : 0.28,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: at(landmark.mav_low),
          width: span(landmark.mav_low, landmark.mav_high),
          height: 5,
          borderRadius: 2.5,
          backgroundColor: c.graphite,
          opacity: contrast ? 1 : 0.7,
        }}
      />
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

/**
 * Shorthand in words for VoiceOver, with the coaching lines' "~2 sets" as
 * "about 2 sets" and "5/8 sets" as "5 of 8 sets".
 */
function inWords(text: string): string {
  return speak(text.replace(/~(?=\d)/g, 'about ').replace(/(\d)\/(\d)/g, '$1 of $2'));
}

/** Training time as VoiceOver says it: "1 hour 20 minutes", or "none". */
const spokenMinutes = (minutes: number) => (minutes > 0 ? spokenClock(minutes * 60) : 'none');

/** The width beside a chart that holds its one scale figure. */
const SCALE_COLUMN = 44;

/** A chart's scale figure, beside the line it names. */
function ScaleLabel({ bottom, children }: { bottom: `${number}%`; children: string }) {
  return (
    <View style={{ position: 'absolute', right: 0, width: SCALE_COLUMN, bottom, marginBottom: -8, height: 16, justifyContent: 'center' }}>
      <BlancText
        variant="footnote"
        tone="graphite"
        size={12}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.3}
        style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }}>
        {children}
      </BlancText>
    </View>
  );
}

/** The top of the training chart: the next whole hour at or above the longest week. */
const hoursScale = (peak: number) => Math.max(60, Math.ceil(peak / 60) * 60);

/** Eight weeks of training time; this week in ink, against a scale in whole hours. */
function HoursChart({ points }: { points: TrainingHoursPoint[] }) {
  const c = useBlanc();
  const large = useLargeText();
  // Increase Contrast draws past weeks at full strength, still graphite against this week's ink.
  const contrast = useIncreaseContrast();
  const top = hoursScale(Math.max(0, ...points.map((point) => point.totalMinutes)));
  const current = points[points.length - 1];
  // At the accessibility text sizes a line that no longer fits wraps; the right-hand words stay right.
  const wrap = large ? ({ flexWrap: 'wrap', columnGap: 12 } as const) : null;
  const right = large ? ({ flexGrow: 1, textAlign: 'right' } as const) : undefined;
  return (
    <View
      accessible
      accessibilityLabel={`Training time, last 8 weeks. This week ${spokenMinutes(current?.totalMinutes ?? 0)}. ${points
        .map((point) => `Week of ${format(parseISO(point.weekStart), 'MMMM d')}, ${spokenMinutes(point.totalMinutes)}`)
        .join('; ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...wrap }}>
        <BlancText variant="secondary" tone="graphite">
          This week
        </BlancText>
        <BlancText variant="secondary" weight="500" style={[{ fontVariant: ['tabular-nums'] }, right]}>
          {formatMinutes(current?.totalMinutes ?? 0)}
        </BlancText>
      </View>
      <View style={{ height: 110, marginTop: 18 }}>
        {/* The scale's top and the zero line; a week without training draws nothing on it. */}
        <View style={{ position: 'absolute', left: 0, right: SCALE_COLUMN + 6, top: 0, height: 1, backgroundColor: c.hairline }} />
        <View style={{ position: 'absolute', left: 0, right: SCALE_COLUMN + 6, bottom: 0, height: 1, backgroundColor: c.hairline }} />
        <ScaleLabel bottom="100%">{formatMinutes(top)}</ScaleLabel>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: '100%', marginRight: SCALE_COLUMN + 6 }}>
          {points.map((point, index) => (
            <View key={point.weekStart} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              {point.totalMinutes > 0 ? (
                <View
                  style={{
                    height: `${Math.max(3, (point.totalMinutes / top) * 100)}%`,
                    borderRadius: 3,
                    borderCurve: 'continuous',
                    backgroundColor: index === points.length - 1 ? c.ink : c.graphite,
                    opacity: contrast || index === points.length - 1 ? 1 : 0.5,
                  }}
                />
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginRight: SCALE_COLUMN + 6, ...wrap }}>
        <BlancText variant="footnote" tone="graphite">
          {points[0]?.label}
        </BlancText>
        <BlancText variant="footnote" tone="graphite" style={right}>
          {current?.label}
        </BlancText>
      </View>
    </View>
  );
}

function NutritionSection() {
  const { weeklyNutrition, loading, error } = useWeeklyNutrition();
  const target = useAppStore((state) => state.macroTarget);
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const failed = "Couldn't load your nutrition. Pull down to try again.";
  // The week arrives after the screen does; a failure would pass unheard.
  useAnnounce(!loading && error ? failed : null);
  return (
    <Section title="Nutrition" note="Last 7 days">
      <Label style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
        {loading ? (
          <View style={{ height: 120 }} />
        ) : error ? (
          <BlancText variant="secondary" tone="live">
            {failed}
          </BlancText>
        ) : weeklyNutrition.length === 0 ? (
          <BlancText variant="secondary" tone="graphite">
            Log meals in Fuel to see the week here.
          </BlancText>
        ) : (
          <View style={{ gap: 22 }}>
            <MacroBars days={weeklyNutrition} macro="calories" label="Calories" unit="kcal" target={target?.calories ?? 0} warnOver={warnsOverTarget('calories', goal)} />
            <MacroBars days={weeklyNutrition} macro="protein" label="Protein" unit="g" target={target?.protein ?? 0} warnOver={warnsOverTarget('protein', goal)} />
          </View>
        )}
      </Label>
    </Section>
  );
}

/**
 * One macro across the last seven days, against its daily target (dashed,
 * its figure beside it); today in ink, as in the training chart, and a day
 * with nothing logged left empty. A day well past target is red only where
 * that is a warning for the goal.
 */
function MacroBars({
  days,
  macro,
  label,
  unit,
  target,
  warnOver,
}: {
  days: DailyNutrition[];
  macro: 'calories' | 'protein';
  label: string;
  unit: string;
  target: number;
  warnOver: boolean;
}) {
  const c = useBlanc();
  const large = useLargeText();
  // Increase Contrast draws the target line and past days at full strength.
  const contrast = useIncreaseContrast();
  // The clock's day, so a screen left open past midnight moves today on.
  const todayKey = useCurrentDayKey();
  // Today is still being eaten: the average is of the days before it, or
  // today's own figure while it is the only day logged.
  const pastAverage = averageLoggedDays(days.filter((day) => day.date !== todayKey), macro);
  const todayOnly = pastAverage === 0 && averageLoggedDays(days, macro) > 0;
  const average = todayOnly ? averageLoggedDays(days, macro) : pastAverage;
  const max = Math.max(1, target * 1.3, ...days.map((day) => day[macro]));
  const share = target > 0 && average > 0 ? ` · ${Math.round((average / target) * 100)}%` : '';
  const isOver = (day: DailyNutrition) => warnOver && target > 0 && day[macro] > target * 1.05;
  return (
    <View
      accessible
      accessibilityLabel={speak(
        `${label}, ${todayOnly ? 'today' : 'daily average'} ${formatWhole(average)} ${unit}${share}${target > 0 ? ` · target ${formatWhole(target)}` : ''}. ${days
          .map((day) => `${format(parseISO(day.date), 'EEEE')}, ${formatWhole(day[macro])}${isOver(day) ? ', over' : ''}`)
          .join('; ')}`,
      )}>
      {/* At the accessibility text sizes the average wraps under the name. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null) }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {formatWhole(average)}
          </BlancText>{' '}
          {unit} {todayOnly ? 'today' : 'a day'}{share}
        </BlancText>
      </View>
      <View style={{ height: 72, marginTop: 12 }}>
        {/* The zero line: a day with nothing logged draws nothing on it. */}
        <View style={{ position: 'absolute', left: 0, right: SCALE_COLUMN + 6, bottom: 0, height: 1, backgroundColor: c.hairline }} />
        {target > 0 ? (
          <>
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: SCALE_COLUMN + 6,
                bottom: `${(target / max) * 100}%`,
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderColor: c.graphite,
                opacity: contrast ? 1 : 0.6,
              }}
            />
            <ScaleLabel bottom={`${(target / max) * 100}%`}>{formatWhole(target)}</ScaleLabel>
          </>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: '100%', marginRight: SCALE_COLUMN + 6 }}>
          {days.map((day) => {
            const over = isOver(day);
            const current = day.date === todayKey;
            return (
              <View key={day.date} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                {day[macro] > 0 ? (
                  <View
                    style={{
                      height: `${Math.max(3, (day[macro] / max) * 100)}%`,
                      borderRadius: 3,
                      borderCurve: 'continuous',
                      backgroundColor: over ? c.live : current ? c.ink : c.graphite,
                      opacity: contrast || over || current ? 1 : 0.5,
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, marginRight: SCALE_COLUMN + 6 }}>
        {days.map((day) => (
          <BlancText key={day.date} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {format(parseISO(day.date), 'EEEEE')}
          </BlancText>
        ))}
      </View>
    </View>
  );
}
