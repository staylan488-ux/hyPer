import { router } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { HeroState } from '@/components/dashboard/todayModel';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { useStartSession } from '~/lib/session';

// Today's training in one card: a title, at most one quiet line, at most one
// button. Same rule as the web (todayHero), fewer words. Shown on Today and
// at the top of Train before a session starts.
const PLAN_CARD_HEIGHT = 78;

export function PlanCard({ hero, next, place }: { hero: HeroState; next: string | null; place: 'today' | 'train' }) {
  const { starting, start } = useStartSession();
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
    case 'done':
      title = 'Trained today';
      detail = next ? `Next: ${next}` : null;
      break;
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
