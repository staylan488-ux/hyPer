import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { HeroState } from '@/lib/todayModel';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Tally } from '~/components/Tally';
import { formatMinutes } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useStartSession } from '~/lib/session';
import { useFinishedToday } from '~/lib/today';
import { useBlanc } from '~/theme/blanc';

// Today's training in one card: a title, at most one quiet line, at most one
// button. Same rule as the web (todayHero), fewer words. Shown on Today and
// at the top of Train before a session starts. A finished day stays as its
// record: the session's name and time, and its tally, opening the workout.
const PLAN_CARD_HEIGHT = 78;
// A finished day's record: padding 14 + headline 22 + 2 + line 20 + 8 + tally 24 + 14.
const RECORD_HEIGHT = 104;

export function PlanCard({ hero, next, place }: { hero: HeroState; next: string | null; place: 'today' | 'train' }) {
  const c = useBlanc();
  const { starting, start } = useStartSession();
  const finished = useFinishedToday(hero.kind === 'done');
  const toTrain = () => router.navigate('/train');
  const openSchedule = () => router.push('/schedule');

  let title: string;
  let detail: string | null = null;
  let action: { title: string; onPress: () => void; primary?: boolean; busy?: boolean } | null = null;
  switch (hero.kind) {
    case 'loading':
    case 'resume':
      // Holds the card's place so what follows does not jump when the plan arrives.
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
            if (started && place === 'today') toTrain();
          });
        },
      };
      break;
    }
    case 'rest':
      title = 'Rest day';
      detail = next ? `Next: ${next}` : null;
      break;
    case 'done': {
      // Holds the record's place while History is read for the workout.
      if (finished === undefined) return <View style={{ height: RECORD_HEIGHT, marginTop: 18 }} />;
      if (!finished) {
        title = 'Trained today';
        detail = next ? `Next: ${next}` : null;
        break;
      }
      // The next session by name only ("Tomorrow · Lower A" → "Lower A"), so the line fits.
      const at = next ? next.indexOf(' · ') : -1;
      const nextName = next && at >= 0 ? next.slice(at + 3) : next;
      title = finished.title;
      // No set count: the tally under the line shows it.
      detail = [
        'Trained today',
        finished.minutes ? formatMinutes(finished.minutes) : null,
        nextName ? `Next: ${nextName}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      break;
    }
    case 'flexible':
      title = 'Flexible mode';
      action = { title: 'Train', onPress: toTrain };
      break;
    case 'no-schedule':
      // Train sets up Day 1 and the rhythm; Today points there.
      title = place === 'train' ? 'Set your schedule' : 'Choose today’s session';
      detail = place === 'train' ? 'Day 1 and how sessions follow' : null;
      action = place === 'train' ? { title: 'Set up', primary: true, onPress: openSchedule } : { title: 'Choose', onPress: toTrain };
      break;
    case 'first-run':
      title = 'No program yet';
      detail = 'Five questions, or start blank';
      action = { title: 'Create', primary: true, onPress: () => router.push('/train/program') };
      break;
    case 'schedule-error':
      title = 'Couldn’t load your plan';
      action = { title: 'Retry', onPress: hero.retry };
      break;
  }

  const record = hero.kind === 'done' ? finished : null;
  const openRecord = record ? () => router.push({ pathname: '/train/past', params: { id: record.id } }) : null;
  const face = { minHeight: PLAN_CARD_HEIGHT, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
  const content = (
    <>
        <View style={{ flex: 1, minWidth: 0 }}>
          <BlancText variant="headline" numberOfLines={1}>
            {title}
          </BlancText>
          {detail ? (
            <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 2 }}>
              {detail}
            </BlancText>
          ) : null}
          {record && record.marks.length > 0 ? (
            // The finished session's tally, closed: no set is next. Its strokes sit
            // 8 pt under the room it keeps for a next stroke, so 16 pt below the line.
            <Tally marks={record.marks} current={null} height={16} style={{ marginTop: 8 }} accessibilityLabel={`${record.sets} of ${record.marks.length} sets logged`} />
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
    </>
  );

  return (
    <Animated.View key={record ? 'record' : hero.kind} entering={FadeIn.duration(220)}>
      {place === 'today' || openRecord ? (
        // On Today the whole card leads to Train, where the day is; its button still acts.
        // A finished day's record opens that workout, on Today and on Train.
        <Label style={{ marginTop: 18, overflow: 'hidden' }}>
          <Pressable
            // With a button inside, VoiceOver reaches the button on its own.
            accessible={!action}
            accessibilityRole="button"
            // VoiceOver reads the record as a whole, so the tally's count joins its label.
            accessibilityLabel={[title, detail, record && record.marks.length > 0 ? `${record.sets} of ${record.marks.length} sets logged` : null]
              .filter(Boolean)
              .join(', ')}
            accessibilityHint={openRecord ? 'Opens the workout' : 'Opens Train'}
            onPress={() => {
              haptics.tap();
              (openRecord ?? toTrain)();
            }}
            style={({ pressed }) => [face, { backgroundColor: pressed ? c.pressed : 'transparent' }]}>
            {content}
          </Pressable>
        </Label>
      ) : (
        <Label style={[{ marginTop: 18 }, face]}>{content}</Label>
      )}
    </Animated.View>
  );
}
