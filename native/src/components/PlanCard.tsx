import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { HeroState } from '@/lib/todayModel';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Tally } from '~/components/Tally';
import { speak, useLargeText } from '~/lib/accessibility';
import { formatMinutes } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { newProgram } from '~/lib/program';
import { useStartSession } from '~/lib/session';
import { useFinishedToday, type FinishedToday } from '~/lib/today';
import { useBlanc } from '~/theme/blanc';
import { openTrain } from '~/lib/openTrain';

// Today's training in one card: a title, at most one quiet line, at most one
// button. The shared todayHero rule (src/lib/todayModel), in few words. Shown
// on Today and at the top of Train before a session starts. A finished day
// stays as its record, in the live session's skeleton (SessionCard): the
// session's name and length, its tally, "Done", opening the workout.
const PLAN_CARD_HEIGHT = 78;
// A finished day's record, as tall as the live card: padding 16 + the day's
// line 20 + 14 + tally 24 + 16 + the title line 44 (an action's height) + 18.
const RECORD_HEIGHT = 152;
/** The title line's height: a button's, so a card without one keeps the live card's height. */
const TITLE_LINE = 44;

export function PlanCard({
  hero,
  next,
  place,
  seeded = false,
}: {
  hero: HeroState;
  next: string | null;
  place: 'today' | 'train';
  /** The hero comes from the phone's copy (useTodayPlan's seeded). */
  seeded?: boolean;
}) {
  const c = useBlanc();
  // At the accessibility text sizes the button moves under the words.
  const large = useLargeText();
  const { starting, start } = useStartSession();
  const hasPrograms = useAppStore((state) => state.splits.length > 0);
  const finished = useFinishedToday(hero.kind === 'done');
  // A finished day first shown from the phone's copy keeps saying so until
  // History's record lands, also once this launch's own reads decide it again.
  const [doneFromCopy, setDoneFromCopy] = useState(false);
  const sayDone = hero.kind === 'done' && (seeded || doneFromCopy);
  if (sayDone !== doneFromCopy) setDoneFromCopy(sayDone);
  const toTrain = openTrain;
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
      // Holds the record's place while History is read for the workout. A day
      // shown from the phone's copy says "Trained today" from the first frame
      // instead (History is never kept), at the record's height, so the record
      // fills in without the card changing size.
      if (finished === undefined && !sayDone) return <View style={{ height: RECORD_HEIGHT, marginTop: 18 }} />;
      if (!finished) {
        title = 'Trained today';
        detail = next ? `Next: ${next}` : null;
        break;
      }
      return <FinishedCard record={finished} next={next} />;
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
      title = hasPrograms ? 'No active program' : 'No program yet';
      detail = hasPrograms ? 'Choose a program to use' : 'Five questions, or start blank';
      // Create goes straight to the questions (Program's own card would only ask again); Choose lists the programs.
      action = { title: hasPrograms ? 'Choose' : 'Create', primary: true, onPress: () => (hasPrograms ? router.push('/train/program') : newProgram()) };
      break;
    case 'schedule-error':
      title = 'Couldn’t load your plan';
      action = { title: 'Retry', onPress: hero.retry };
      break;
  }

  // A seeded finished day keeps the record's place while History is read.
  const holdingRecord = hero.kind === 'done' && finished === undefined;
  const face = {
    minHeight: holdingRecord ? RECORD_HEIGHT : PLAN_CARD_HEIGHT,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: large ? ('column' as const) : ('row' as const),
    alignItems: large ? ('stretch' as const) : ('center' as const),
    gap: 12,
  };
  const content = (
    <>
        <View style={large ? undefined : { flex: 1, minWidth: 0 }}>
          <BlancText variant="headline" numberOfLines={large ? undefined : 1}>
            {title}
          </BlancText>
          {detail ? (
            <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 2 }}>
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
    </>
  );

  return (
    <Animated.View key={hero.kind} entering={FadeIn.duration(220)}>
      {place === 'today' ? (
        // On Today the whole card leads to Train, where the day is; its button still acts.
        <Label style={{ marginTop: 18, overflow: 'hidden' }}>
          <Pressable
            // With a button inside, VoiceOver reaches the button on its own.
            accessible={!action}
            accessibilityRole="button"
            accessibilityLabel={speak([title, detail].filter(Boolean).join(', '))}
            accessibilityHint="Opens Train"
            onPress={() => {
              haptics.tap();
              toTrain();
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

/**
 * A finished day's record, on Today and on Train, in the live card's
 * skeleton: the session and its length where the live clock was, the closed
 * tally, then "Done" where the movement was and the next session under it.
 * No button: the card opens the workout, and says so with a chevron where the
 * live card's button was, as every card that opens a screen does.
 */
function FinishedCard({ record, next }: { record: FinishedToday; next: string | null }) {
  const c = useBlanc();
  // At the accessibility sizes the action slot stacks under the words, where a lone chevron would float.
  const large = useLargeText();
  // The next session by name only ("Tomorrow · Lower A" → "Lower A"), so the line fits.
  const at = next ? next.indexOf(' · ') : -1;
  const nextName = next && at >= 0 ? next.slice(at + 3) : next;
  const total = record.marks.length;
  // Every set logged, the tally says so; a count only for sets left unlogged.
  const outcome = total > 0 && record.sets < total ? `Done · ${record.sets} of ${total} sets` : 'Done';
  const length = record.minutes ? formatMinutes(record.minutes) : null;
  const line = nextName ? `Next: ${nextName}` : null;
  const counted = total > 0 ? `${record.sets} of ${total} sets logged` : null;
  return (
    <Animated.View key="record" entering={FadeIn.duration(220)}>
      <SessionCard
        day={record.title}
        aside={
          length ? (
            <BlancText variant="footnote" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
              {length}
            </BlancText>
          ) : null
        }
        // Closed: no set is next.
        tally={counted ? { marks: record.marks, current: null, label: counted } : null}
        title={outcome}
        line={line}
        action={large ? undefined : <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
        // VoiceOver reads the record as one stop, its length in words ("1 h 5 min" as "1 hour 5 minutes").
        spoken={[record.title, length, 'Done', counted, line].filter(Boolean).join(', ')}
        hint="Opens the workout"
        onPress={() => router.push({ pathname: '/train/past', params: { id: record.id } })}
      />
    </Animated.View>
  );
}

/**
 * Today's session in one skeleton, live or finished, so finishing changes
 * the words and not the layout: a quiet header line (the session's name, and
 * at its right the live clock or, once done, its length), the tally, then the
 * title line (the movement up now, or "Done") with its quiet line and the
 * card's one button. The whole card is a button. With `spoken` it is one
 * VoiceOver stop (a record); without, VoiceOver reads its parts and reaches
 * the button on its own.
 */
export function SessionCard({
  day,
  daySpoken,
  aside,
  tally,
  title,
  line,
  action,
  spoken,
  hint,
  onPress,
}: {
  day: string;
  /** What VoiceOver hears for the header line, when its parts are read one by one. */
  daySpoken?: string;
  /** At the header line's right: the live clock, or the finished session's length. */
  aside?: ReactNode;
  tally: { marks: boolean[]; current: number | null; label: string } | null;
  title: string;
  line: string | null;
  action?: ReactNode;
  /** The whole card's words for VoiceOver, read as one stop. */
  spoken?: string;
  hint?: string;
  onPress: () => void;
}) {
  const c = useBlanc();
  // At the accessibility text sizes the day wraps, the clock moves under it, and the button under the words.
  const large = useLargeText();
  return (
    <Label style={{ marginTop: 18, overflow: 'hidden' }}>
      <Pressable
        accessible={spoken !== undefined}
        accessibilityRole="button"
        accessibilityLabel={spoken === undefined ? undefined : speak(spoken)}
        accessibilityHint={hint}
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={({ pressed }) => ({ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
        <View
          accessible
          accessibilityLabel={speak(daySpoken ?? day)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, ...(large ? { flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 4 } : null) }}>
          {/* The session names the card quietly; a long name gives way, the clock always shows. */}
          <BlancText variant="secondary" weight="500" tone="graphite" numberOfLines={large ? undefined : 1} style={large ? undefined : { flex: 1, minWidth: 0 }}>
            {day}
          </BlancText>
          {aside}
        </View>

        {tally ? (
          // Its strokes sit 8 pt under the room it keeps for a next stroke.
          <Tally marks={tally.marks} current={tally.current} height={16} style={{ marginTop: 14 }} accessibilityLabel={tally.label} />
        ) : null}

        <View style={large ? { gap: 12, marginTop: 16 } : { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, minHeight: TITLE_LINE }}>
          <View accessible accessibilityLabel={speak(line ? `${title} · ${line}` : title)} style={large ? undefined : { flex: 1, minWidth: 0 }}>
            <BlancText variant="headline" numberOfLines={large ? undefined : 1}>
              {title}
            </BlancText>
            {line ? (
              <BlancText variant="secondary" tone="graphite" numberOfLines={large ? undefined : 1} style={{ marginTop: 1 }}>
                {line}
              </BlancText>
            ) : null}
          </View>
          {action}
        </View>
      </Pressable>
    </Label>
  );
}
