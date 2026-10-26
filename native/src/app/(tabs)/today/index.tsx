import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { pickInsight, summarizeWeekVolume, type HeroState } from '@/components/dashboard/todayModel';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Tally } from '~/components/Tally';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { formatLoad, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useFuelStore } from '~/lib/fuel';
import { useNow, useSessionModel, useStartSession, type SessionModel } from '~/lib/session';
import { useTodayPlan } from '~/lib/today';
import { space, useBlanc } from '~/theme/blanc';

export default function TodayScreen() {
  const now = useNow(30_000);
  const session = useSessionModel();
  const plan = useTodayPlan();
  const target = useAppStore((state) => state.macroTarget);
  const weekly = useAppStore((state) => state.weeklyVolume);
  const totals = useFuelStore((state) => state.totals);
  const week = summarizeWeekVolume(weekly);
  const insight = pickInsight(weekly);
  const kcalLeft = target ? target.calories - totals.calories : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Today',
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'You',
              accessibilityLabel: 'Your profile',
              icon: { type: 'sfSymbol', name: 'person.crop.circle' },
              onPress: () => {
                haptics.tap();
                router.navigate('/you');
              },
            },
          ],
        }}
      />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {format(now, 'EEEE, MMMM d')}
        </BlancText>

        {session ? <SessionLabel session={session} now={now} /> : <PlanCard hero={plan.hero} next={plan.next} />}

        <Section title="Fuel" action={{ title: 'Log food', onPress: () => router.push('/log-food') }}>
          {target && kcalLeft !== null ? (
            <View style={{ paddingHorizontal: space.gutter }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <BlancText variant="figure" size={68} style={{ letterSpacing: -1.5 }}>
                  {formatWhole(Math.abs(kcalLeft))}
                </BlancText>
                <BlancText variant="secondary" tone="graphite">
                  {kcalLeft >= 0 ? 'kcal left' : 'kcal over'}
                </BlancText>
              </View>
              <View style={{ flexDirection: 'row', gap: 20, marginTop: 14 }}>
                <Meter label="Eaten" value={formatWhole(totals.calories)} of={formatWhole(target.calories)} progress={totals.calories / target.calories} />
                <Meter label="Protein" value={formatWhole(totals.protein)} of={`${formatWhole(target.protein)} g`} progress={totals.protein / target.protein} />
              </View>
            </View>
          ) : (
            <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter }}>
              Set a calorie target in You to see what's left today.
            </BlancText>
          )}
        </Section>

        <Section title="This week">
          <Label>
            <Row
              title="Sessions"
              value={
                plan.weekDone === null
                  ? undefined
                  : plan.weekTarget
                    ? `${plan.weekDone} of ${plan.weekTarget}`
                    : String(plan.weekDone)
              }
            />
            {week.trained > 0 ? (
              <>
                <Hairline />
                <Row
                  title={`${week.inRange} of ${week.trained} muscles in range`}
                  detail={insight ? `${insight.muscle} ${insight.flag}` : muscleCounts(week.under, week.over)}
                />
              </>
            ) : null}
          </Label>
        </Section>
      </TabScroll>
    </>
  );
}

function SessionLabel({ session, now }: { session: SessionModel; now: number }) {
  const c = useBlanc();
  const minutes = Math.max(0, Math.round((now - session.startedAt.getTime()) / 60_000));
  const current = session.current;

  return (
    <Label style={{ marginTop: 18, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BlancText variant="headline">{session.dayName}</BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
          <BlancText variant="footnote" tone="graphite">
            In progress · {minutes} min
          </BlancText>
        </View>
      </View>

      <Tally
        marks={session.sets.map((set) => set.completed)}
        current={current?.index ?? null}
        height={16}
        style={{ marginTop: 14 }}
        accessibilityLabel={`${session.doneCount} of ${session.sets.length} sets done`}
      />

      <View style={{ height: 0.5, backgroundColor: c.hairline, marginTop: 14 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="bodyStrong" numberOfLines={1}>
            {current ? current.movement.name : 'All sets done'}
          </BlancText>
          <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
            {current ? setLine(current.setNumber, current.movement.sets.length, current.set.weight, current.set.reps) : 'Finish to save the session'}
          </BlancText>
        </View>
        <Capsule title={current ? 'Resume' : 'Finish'} onPress={() => router.navigate('/train')} />
      </View>
    </Label>
  );
}

// Today's training in one card: a title, at most one quiet line, at most one
// button. Same rule as the web (todayHero), fewer words.
const PLAN_CARD_HEIGHT = 78;

function PlanCard({ hero, next }: { hero: HeroState; next: string | null }) {
  const { starting, start } = useStartSession();
  const toTrain = () => router.navigate('/train');

  let title: string;
  let detail: string | null = null;
  let action: { title: string; onPress: () => void; primary?: boolean; busy?: boolean } | null = null;
  switch (hero.kind) {
    case 'loading':
    case 'resume':
      // Holds the card's place so Fuel does not jump when the plan arrives.
      return <View style={{ height: PLAN_CARD_HEIGHT, marginTop: 18 }} />;
    case 'planned': {
      const day = hero.day;
      const movements = day.exercises.length;
      title = day.day_name;
      detail = `${movements} ${movements === 1 ? 'movement' : 'movements'}`;
      action = {
        title: 'Start',
        primary: true,
        busy: starting === day.id,
        onPress: () => {
          void start(day.id).then((started) => {
            if (started) toTrain();
          });
        },
      };
      break;
    }
    case 'rest':
      title = 'Rest day';
      detail = next ? `Next: ${next}` : null;
      break;
    case 'done':
      title = 'Trained today';
      detail = next ? `Next: ${next}` : null;
      break;
    case 'flexible':
      title = 'Flexible mode';
      action = { title: 'Train', onPress: toTrain };
      break;
    case 'no-schedule':
      title = 'Choose today’s session';
      action = { title: 'Choose', onPress: toTrain };
      break;
    case 'first-run':
      title = 'No program yet';
      detail = 'Create one on the web for now.';
      break;
    case 'schedule-error':
      title = 'Couldn’t load your plan';
      action = { title: 'Retry', onPress: hero.retry };
      break;
  }

  return (
    <Animated.View key={hero.kind} entering={FadeIn.duration(220)}>
      <Label
        style={{
          marginTop: 18,
          minHeight: PLAN_CARD_HEIGHT,
          paddingHorizontal: 18,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="headline" numberOfLines={1}>
            {title}
          </BlancText>
          {detail ? (
            <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 2 }}>
              {detail}
            </BlancText>
          ) : null}
        </View>
        {action ? (
          <Capsule
            title={action.title}
            variant={action.primary ? 'primary' : 'quiet'}
            busy={action.busy}
            disabled={starting !== null && !action.busy}
            onPress={action.onPress}
          />
        ) : null}
      </Label>
    </Animated.View>
  );
}

function Meter({ label, value, of, progress }: { label: string; value: string; of: string; progress: number }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <BlancText variant="secondary" tone="graphite">
          {label}
        </BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {value}
          </BlancText>{' '}
          / {of}
        </BlancText>
      </View>
      <View style={{ marginTop: 8 }}>
        <Track progress={progress} />
      </View>
    </View>
  );
}

/** "Set 2 of 3", with the load only once it is known. */
function setLine(setNumber: number, sets: number, weight: number | null, reps: number | null): string {
  const base = `Set ${setNumber} of ${sets}`;
  return weight !== null && reps !== null ? `${base} · ${formatLoad(weight)} lb × ${reps}` : base;
}

/** "2 under · 1 over", leaving out zeros. */
function muscleCounts(under: number, over: number): string | undefined {
  return [under ? `${under} under` : null, over ? `${over} over` : null].filter(Boolean).join(' · ') || undefined;
}
