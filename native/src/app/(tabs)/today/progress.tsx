import { format, parseISO, startOfWeek } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
import { useBlanc } from '~/theme/blanc';
import { useMuscleTones } from '~/theme/useMuscleTones';

const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/**
 * Progress: this week's volume by muscle, training time over eight weeks, and
 * the last seven days' eating. Each section names its own span, since they differ.
 */
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
    : `${week.inRange} of ${week.trained} trained muscles in range`;

  return (
    <>
      <Stack.Screen options={{ title: 'Progress' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Section title="Muscles" note={`Week of ${format(startOfWeek(parseISO(dayKey), TRAINING_WEEK), 'MMMM d')}`} style={{ marginTop: 6 }}>
          {volume.length === 0 ? (
            volumeRead ? (
              <Label style={{ paddingHorizontal: 18, paddingVertical: 16, gap: 12 }}>
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
              <Label style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 }}>
                {/*
                  One line either way, so a tap on a muscle never moves the figure
                  (at the accessibility text sizes it wraps). No announcement when
                  the choice changes: VoiceOver chooses on the figure (which speaks
                  its new value) or on a muscle's row.
                */}
                <BlancText
                  variant="headline"
                  numberOfLines={large ? undefined : 1}
                  style={{ paddingHorizontal: 6, minHeight: 22 }}
                  accessibilityLabel={inWords(caption)}>
                  {caption}
                </BlancText>
                <MuscleFigure volume={volume} selected={open} onPick={pick} />
              </Label>

              {/* Each muscle's sets against its range; a tap opens its landmarks. */}
              <Label style={{ overflow: 'hidden', marginTop: 12 }}>
                {coached.map(({ mv, call }, index) => (
                  <Animated.View key={mv.muscle_group} layout={LinearTransition.duration(220)}>
                    {index > 0 ? <Hairline /> : null}
                    <MuscleRow mv={mv} call={call} open={open === mv.muscle_group} onToggle={() => pick(open === mv.muscle_group ? null : mv.muscle_group)} />
                  </Animated.View>
                ))}
                {coached.some(({ mv }) => mv.landmark) ? (
                  <Animated.View layout={LinearTransition.duration(220)}>
                    <Hairline />
                    <RailKey />
                  </Animated.View>
                ) : null}
              </Label>
            </>
          )}
        </Section>

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
  const advice = asFragment(call.headline);
  // An open row names the rail's marks by what they mean.
  const marks = mv.landmark
    ? [`Minimum ${mv.landmark.mev}`, `Best ${mv.landmark.mav_low}–${mv.landmark.mav_high}`, `Ceiling ${mv.landmark.mrv}`]
    : null;
  const landmarks = marks ? marks.join(' · ') : 'No landmarks set for this muscle';
  // One fact for VoiceOver, the rail's band included, with the words the row
  // shows; an open row adds what it shows.
  const spoken = [
    `${name}, ${formatSets(mv.weekly_sets)}${mv.landmark ? `, in range ${mv.landmark.mev}–${mv.landmark.mrv}` : ''}, ${call.chip}`,
    words ? advice : null,
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
        {/* The name with a small chevron that turns as the row opens, so the row reads as one that expands. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, ...(large ? { flexShrink: 1 } : { flex: 1 }) }}>
          <BlancText variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={large ? undefined : 1}>
            {name}
          </BlancText>
          <Disclosure open={open} />
        </View>
        <BlancText variant="secondary" weight="500" tone={hot ? 'live' : 'ink'} style={{ fontVariant: ['tabular-nums'] }}>
          {formatSets(mv.weekly_sets)}
        </BlancText>
      </View>
      {words ? (
        // Red stays on the count and the rail's tick; the advice is quiet.
        <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
          {advice}
        </BlancText>
      ) : null}
      {mv.landmark ? <Rail sets={mv.weekly_sets} landmark={mv.landmark} hot={hot} open={open} /> : null}
      {open ? (
        // The marks wrap a whole mark at a time when they no longer fit on one line.
        <Animated.View entering={FadeIn.duration(180)} style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2 }}>
          {marks ? (
            marks.map((mark) => (
              <BlancText key={mark} variant="meta" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
                {mark}
              </BlancText>
            ))
          ) : (
            <BlancText variant="footnote" tone="graphite">
              {landmarks}
            </BlancText>
          )}
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

/** A row's disclosure chevron: down while closed, turning up as the row opens (Reduce Motion: at once). */
function Disclosure({ open }: { open: boolean }) {
  const c = useBlanc();
  // The turn follows `open` through a shared value: on native, Reanimated ignores a dependency list.
  const angle = useSharedValue(open ? 180 : 0);
  useEffect(() => {
    angle.value = withTiming(open ? 180 : 0, { duration: 200 });
  }, [open, angle]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  return (
    <Animated.View style={turn} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <SymbolView name="chevron.down" size={11} weight="semibold" tintColor={c.graphite} />
    </Animated.View>
  );
}

/** The rail's marker for this week's sets: a short upright tick, a reading on a scale rather than a handle to drag. */
const TICK = { width: 2, height: 12 } as const;
/** The card-coloured edge either side of the tick that keeps it clear of the band under it. */
const TICK_EDGE = 1;
/** The rail's band as the key draws it. */
const BAND = { width: 14, height: 5 } as const;

/** This week's reading on a rail: ink, the one red when over. */
function Tick({ hot }: { hot: boolean }) {
  const c = useBlanc();
  return (
    <View style={{ width: TICK.width + TICK_EDGE * 2, height: TICK.height, paddingHorizontal: TICK_EDGE, backgroundColor: c.label }}>
      <View style={{ flex: 1, borderRadius: TICK.width / 2, backgroundColor: hot ? c.live : c.ink }} />
    </View>
  );
}

/**
 * The one key for every rail, at the foot of the list: the band is the
 * range, the tick this week's sets. Each row already says both to VoiceOver.
 */
function RailKey() {
  const tones = useMuscleTones();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 4, paddingLeft: 18, paddingRight: 16, paddingVertical: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: BAND.width, height: BAND.height, borderRadius: BAND.height / 2, backgroundColor: tones.band }} />
        <BlancText variant="footnote" tone="graphite">
          In range
        </BlancText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Tick hot={false} />
        <BlancText variant="footnote" tone="graphite">
          This week
        </BlancText>
      </View>
    </View>
  );
}

/**
 * Weekly sets on a line from zero past the ceiling. The band is in range
 * (from the minimum that grows, MEV, up to the ceiling, MRV), as the week's
 * "in range" counts it, in the figure's in-range tone at reduced strength
 * (at least 2:1 against the track in every palette). An open row adds the
 * band's middle, the best range, at that tone's full strength, and names the
 * marks under the rail. The tick is this week's reading, in ink (red over);
 * the list's foot keys both once.
 */
function Rail({ sets, landmark, hot, open }: { sets: number; landmark: NonNullable<MuscleVolume['landmark']>; hot: boolean; open: boolean }) {
  const c = useBlanc();
  const tones = useMuscleTones();
  const max = Math.max(landmark.mrv * 1.1, sets, 1);
  const share = (value: number) => Math.min(100, (value / max) * 100);
  const at = (value: number) => `${share(value)}%` as const;
  const span = (from: number, to: number) => `${Math.max(0, ((Math.min(to, max) - from) / max) * 100)}%` as const;
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ height: TICK.height, marginTop: 9, justifyContent: 'center' }}>
        <View style={{ height: 3, borderRadius: 1.5, backgroundColor: c.track }} />
        <View
          style={{
            position: 'absolute',
            left: at(landmark.mev),
            width: span(landmark.mev, landmark.mrv),
            height: 5,
            borderRadius: 2.5,
            backgroundColor: tones.band,
          }}
        />
        {open ? (
          <Animated.View
            entering={FadeIn.duration(180)}
            style={{
              position: 'absolute',
              left: at(landmark.mav_low),
              width: span(landmark.mav_low, landmark.mav_high),
              height: 5,
              borderRadius: 2.5,
              backgroundColor: tones.in,
            }}
          />
        ) : null}
        <View style={{ position: 'absolute', left: at(sets), marginLeft: -(TICK.width / 2 + TICK_EDGE) }}>
          <Tick hot={hot} />
        </View>
      </View>
    </View>
  );
}

/**
 * Shared coaching shorthand as one quiet fragment, with no full stop, as iOS
 * writes a secondary line: "Over its ceiling · pull back" reads "Over its
 * ceiling, pull back a little". A single phrase stays as it is.
 */
function asFragment(headline: string): string {
  return FRAGMENTS[headline] ?? headline.split(' · ').join(', ');
}
const FRAGMENTS: Record<string, string> = {
  'Over its ceiling · pull back': 'Over its ceiling, pull back a little',
  'Near its ceiling · hold here': 'Near its ceiling, hold here',
};

/**
 * Shorthand in words for VoiceOver, with the coaching lines' "~2 sets" as
 * "about 2 sets" and "5/8 sets" as "5 of 8 sets".
 */
function inWords(text: string): string {
  return speak(text.replace(/~(?=\d)/g, 'about ').replace(/(\d)\/(\d)/g, '$1 of $2'));
}

/**
 * A figure with its units, inside a graphite line: the numbers in ink, the
 * units ("h", "min") left graphite, as "1,342 kcal" reads. One run of text,
 * so VoiceOver and the line's wrapping treat it as the parent's.
 */
function FigureWithUnits({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d[\d,.]*)/).map((part, index) =>
        index % 2 === 1 ? (
          <BlancText key={index} variant="secondary" weight="500">
            {part}
          </BlancText>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Training time as VoiceOver says it: "1 hour 20 minutes", or "none". */
const spokenMinutes = (minutes: number) => (minutes > 0 ? spokenClock(minutes * 60) : 'none');

/**
 * A chart's scale or target figure, in Menlo like Train's numeric details:
 * just above the line it names, at the plot's right end, so every plot runs
 * the card's full width and stacked charts line up. `bottom` is where it
 * sits, normally its line.
 */
function ScaleLabel({ bottom, children }: { bottom: `${number}%`; children: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom, marginBottom: 3 }}>
      <BlancText
        variant="meta"
        tone="graphite"
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.3}
        style={{ textAlign: 'right' }}>
        {children}
      </BlancText>
    </View>
  );
}

/** Between a chart's header line and its plot: room for the figure above the plot's top line. */
const HOURS_GAP = 24;
const MACRO_GAP = 20;

/** The width the training chart's middle date centres in. */
const MIDDLE_TICK = 64;

/**
 * The shortest bar a chart draws for any amount, so a small day or week
 * never reads as an empty one.
 */
const MIN_BAR = 4;

/** The mark for nothing recorded. */
const RING = 6;

/**
 * A chart's mark for a column with nothing recorded, the same on every chart:
 * a small hollow ring just above the zero line, so it never reads as a
 * recorded zero (a bar, however short, is something recorded).
 */
function NothingMark({ onPlot = true }: { onPlot?: boolean }) {
  const c = useBlanc();
  return (
    <View
      style={{
        ...(onPlot ? { alignSelf: 'center', marginBottom: 2 } : null),
        width: RING,
        height: RING,
        borderRadius: RING / 2,
        borderWidth: 1.25,
        borderColor: c.mark,
      }}
    />
  );
}

/** What the ring means, once under a chart that draws it. VoiceOver hears each column's own "none". */
function NothingKey({ children }: { children: string }) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
      <NothingMark onPlot={false} />
      <BlancText variant="footnote" tone="graphite">
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
  // One date between the first and last week's, the middle week's.
  const middle = points.length >= 3 ? Math.floor(points.length / 2) : null;
  return (
    <View
      accessible
      accessibilityLabel={`Training time, last 8 weeks. Week to date ${spokenMinutes(current?.totalMinutes ?? 0)}. ${points
        .map((point) => `Week of ${format(parseISO(point.weekStart), 'MMMM d')}, ${spokenMinutes(point.totalMinutes)}`)
        .join('; ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...wrap }}>
        {/* This week is still under way. */}
        <BlancText variant="secondary" tone="graphite">
          Week to date
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={[{ fontVariant: ['tabular-nums'] }, right]}>
          <FigureWithUnits text={formatMinutes(current?.totalMinutes ?? 0)} />
        </BlancText>
      </View>
      <View style={{ height: 110, marginTop: HOURS_GAP }}>
        {/* The scale's top, named above its right end, and the zero line; a week without training draws the ring for nothing recorded. */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: c.hairline }} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: c.hairline }} />
        <ScaleLabel bottom="100%">{formatMinutes(top)}</ScaleLabel>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: '100%' }}>
          {points.map((point, index) => (
            <View key={point.weekStart} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
              {point.totalMinutes > 0 ? (
                <View
                  style={{
                    height: `${(point.totalMinutes / top) * 100}%`,
                    minHeight: MIN_BAR,
                    borderRadius: 3,
                    borderCurve: 'continuous',
                    backgroundColor: index === points.length - 1 ? c.ink : c.graphite,
                    opacity: contrast || index === points.length - 1 ? 1 : 0.5,
                  }}
                />
              ) : (
                <NothingMark />
              )}
            </View>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, ...wrap }}>
        <BlancText variant="meta" tone="graphite">
          {points[0]?.label}
        </BlancText>
        <BlancText variant="meta" tone="graphite" style={right}>
          {current?.label}
        </BlancText>
        {/*
          The middle week's date, centred under its bar in a row laid out as
          the bars are. Left out at the accessibility text sizes, where the
          three no longer fit on one line.
        */}
        {middle !== null && !large ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', gap: 6 }}>
            {points.map((point, index) => (
              <View key={point.weekStart} style={{ flex: 1 }}>
                {index === middle ? (
                  <BlancText
                    variant="meta"
                    tone="graphite"
                    numberOfLines={1}
                    style={{ position: 'absolute', left: '50%', width: MIDDLE_TICK, marginLeft: -MIDDLE_TICK / 2, textAlign: 'center' }}>
                    {point.label}
                  </BlancText>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {points.some((point) => point.totalMinutes <= 0) ? <NothingKey>No training</NothingKey> : null}
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
  // How many of the seven days have anything logged, said once for both charts while some are missing.
  const logged = weeklyNutrition.filter((day) => day.calories > 0 || day.protein > 0).length;
  const shown = !loading && !error && logged > 0 && logged < weeklyNutrition.length;
  const note = `Last 7 days${shown ? ` · ${logged} ${logged === 1 ? 'day' : 'days'} logged` : ''}`;
  return (
    <Section title="Nutrition" note={note}>
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
          <View>
            <View style={{ gap: 22 }}>
              <MacroBars days={weeklyNutrition} macro="calories" label="Calories" unit="kcal" target={target?.calories ?? 0} warnOver={warnsOverTarget('calories', goal)} />
              <MacroBars days={weeklyNutrition} macro="protein" label="Protein" unit="g" target={target?.protein ?? 0} warnOver={warnsOverTarget('protein', goal)} />
            </View>
            {weeklyNutrition.some((day) => day.calories <= 0 || day.protein <= 0) ? <NothingKey>No entry</NothingKey> : null}
          </View>
        )}
      </Label>
    </Section>
  );
}

/**
 * One macro across the last seven days, against its daily target (dashed,
 * named above its right end, "2,600 target"); today in ink, as in the
 * training chart, and a day with nothing logged marked by the same ring as
 * an empty training week. A day well past target is red only where that is
 * a warning for the goal. The header is the daily average of the logged
 * days before today (Fuel already shows today); a single logged day is
 * given as its figure, since an average of one day is no average. How many
 * days are logged is said once, in the section's note.
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
  const earlier = days.filter((day) => day.date !== todayKey);
  const pastAverage = averageLoggedDays(earlier, macro);
  const todayOnly = pastAverage === 0 && averageLoggedDays(days, macro) > 0;
  const average = todayOnly ? averageLoggedDays(days, macro) : pastAverage;
  // The days the average is of.
  const counted = todayOnly ? 1 : earlier.filter((day) => day[macro] > 0).length;
  // One day is said plainly ("1,342 kcal"): an average of one day is no average.
  const single = counted === 1;
  const max = Math.max(1, target * 1.3, ...days.map((day) => day[macro]));
  const isOver = (day: DailyNutrition) => warnOver && target > 0 && day[macro] > target * 1.05;
  // The target's figure sits above its line at the plot's right end, or just
  // above the last few days' bars where one stands past the line, so a bar
  // never runs into it.
  const targetLabelAt = Math.max(target, ...days.slice(-3).map((day) => day[macro]));
  return (
    <View
      accessible
      accessibilityLabel={speak(
        `${label}, ${single ? `${formatWhole(average)} ${unit}` : counted > 0 ? `daily average ${formatWhole(average)} ${unit}` : 'none logged'}${target > 0 ? ` · target ${formatWhole(target)}` : ''}. ${days
          .map((day) => `${format(parseISO(day.date), 'EEEE')}, ${day[macro] > 0 ? formatWhole(day[macro]) : 'nothing logged'}${isOver(day) ? ', over' : ''}`)
          .join('; ')}`,
      )}>
      {/* At the accessibility text sizes the average wraps under the name. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null) }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        {single ? (
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            <BlancText variant="secondary" weight="500">
              {formatWhole(average)}
            </BlancText>{' '}
            {unit}
          </BlancText>
        ) : counted > 0 ? (
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            Avg{' '}
            <BlancText variant="secondary" weight="500">
              {formatWhole(average)}
            </BlancText>{' '}
            {unit}
          </BlancText>
        ) : (
          <BlancText variant="secondary" tone="graphite">
            None logged
          </BlancText>
        )}
      </View>
      <View style={{ height: 72, marginTop: MACRO_GAP }}>
        {/* The zero line; a day with nothing logged draws the ring for nothing recorded, as an empty week does on the training chart. */}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: c.hairline }} />
        {target > 0 ? (
          <>
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: `${(target / max) * 100}%`,
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderColor: c.graphite,
                opacity: contrast ? 1 : 0.6,
              }}
            />
            <ScaleLabel bottom={`${(targetLabelAt / max) * 100}%`}>{`${formatWhole(target)} target`}</ScaleLabel>
          </>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: '100%' }}>
          {days.map((day) => {
            const over = isOver(day);
            const current = day.date === todayKey;
            return (
              <View key={day.date} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
                {day[macro] > 0 ? (
                  <View
                    style={{
                      height: `${(day[macro] / max) * 100}%`,
                      minHeight: MIN_BAR,
                      borderRadius: 3,
                      borderCurve: 'continuous',
                      backgroundColor: over ? c.live : current ? c.ink : c.graphite,
                      opacity: contrast || over || current ? 1 : 0.5,
                    }}
                  />
                ) : (
                  <NothingMark />
                )}
              </View>
            );
          })}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        {days.map((day) => (
          <BlancText key={day.date} variant="meta" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {format(parseISO(day.date), 'EEEEE')}
          </BlancText>
        ))}
      </View>
    </View>
  );
}
