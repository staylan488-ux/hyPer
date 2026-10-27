import { useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

export type SwipeAction = { label: string; destructive?: boolean; onPress: () => void };

const ACTION_WIDTH = 84;
// Past this drag, letting go runs the destructive action, as in Mail.
const FULL_SWIPE = 210;

/**
 * A row with iOS swipe actions: swipe left for its actions (destructive last,
 * in red); swipe all the way to run the destructive one. The actions are also
 * VoiceOver custom actions. Pair it with an exiting animation on the row's
 * container so a removed row folds away.
 */
export function SwipeRow({ actions, name, children }: { actions: SwipeAction[]; name: string; children: ReactNode }) {
  const swipeable = useRef<SwipeableMethods>(null);
  const armed = useRef(false);
  const destructive = actions.find((action) => action.destructive);
  const run = (action: SwipeAction) => {
    swipeable.current?.close();
    action.onPress();
  };

  return (
    <View
      accessible={false}
      accessibilityActions={actions.map((action) => ({ name: action.label, label: action.label }))}
      onAccessibilityAction={(event) => {
        const action = actions.find((candidate) => candidate.label === event.nativeEvent.actionName);
        if (action) run(action);
      }}>
      <ReanimatedSwipeable
        ref={swipeable}
        friction={1.4}
        rightThreshold={44}
        overshootRight={Boolean(destructive)}
        overshootFriction={1}
        onSwipeableOpen={() => {
          if (armed.current && destructive) {
            armed.current = false;
            haptics.success();
            run(destructive);
          }
        }}
        renderRightActions={(_progress, translation) => (
          <Actions
            actions={actions}
            name={name}
            translation={translation}
            onArm={(next) => {
              if (next !== armed.current) haptics.select();
              armed.current = next;
            }}
            onRun={run}
          />
        )}>
        {children}
      </ReanimatedSwipeable>
    </View>
  );
}

function Actions({ actions, name, translation, onArm, onRun }: {
  actions: SwipeAction[];
  name: string;
  translation: SharedValue<number>;
  onArm: (armed: boolean) => void;
  onRun: (action: SwipeAction) => void;
}) {
  const c = useBlanc();
  const hasDestructive = actions.some((action) => action.destructive);
  useAnimatedReaction(
    () => hasDestructive && translation.value < -FULL_SWIPE,
    (now, before) => {
      if (now !== before) runOnJS(onArm)(now);
    },
  );
  // On a long swipe the red action grows to fill the row, like iOS.
  const grow = useAnimatedStyle(() => ({
    width: Math.max(ACTION_WIDTH, -translation.value - (actions.length - 1) * ACTION_WIDTH),
  }));

  return (
    <View style={{ flexDirection: 'row' }}>
      {actions.map((action) => {
        const face = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ${name}`}
            onPress={() => {
              haptics.tap();
              onRun(action);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: action.destructive ? c.live : c.fill }}>
            <BlancText variant="footnote" weight="600" style={{ color: action.destructive ? '#FFFFFF' : c.ink }}>
              {action.label}
            </BlancText>
          </Pressable>
        );
        return action.destructive ? (
          <Animated.View key={action.label} style={[{ width: ACTION_WIDTH }, grow]}>
            {face}
          </Animated.View>
        ) : (
          <View key={action.label} style={{ width: ACTION_WIDTH }}>
            {face}
          </View>
        );
      })}
    </View>
  );
}
