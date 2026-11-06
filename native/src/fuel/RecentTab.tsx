import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { decodeMealComposition } from '@/lib/mealComposition';
import { servingLabel } from '@/lib/nutritionLedger';
import { rankRecentFoods, type RecentFood } from '@/lib/recentFoods';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import type { MenuAction } from '~/components/HoldMenu';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { SwipeRow } from '~/components/SwipeRow';
import { useAnnounce } from '~/lib/accessibility';
import { today } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';

import { useLogger } from './context';
import { Empty, FoodRow, foodLine, useQuickAdd, type AddState } from './FoodLists';
import { useHiddenRecentFoods, useRecentLogs } from './recent';

/** "150 g · 31 g protein": what + logs (its kcal sits on the right). */
function usualLine(recent: RecentFood, amount: string): string {
  return foodLine(recent.food, recent.servings, amount);
}

/**
 * Recent: the foods eaten lately, the most often eaten first. + logs the usual
 * amount at once into the sheet's meal; a tap reviews it at that amount; a
 * swipe or hold hides one until it is logged again.
 */
export function RecentTab({ userId }: { userId: string }) {
  const logger = useLogger();
  // Rows get `add` on its own: it stays the same function while `added` changes.
  const { added, add: quickAdd, enabled } = useQuickAdd();
  const { logs, failed, version, settle, retry } = useRecentLogs(userId);
  const { hidden, hide } = useHiddenRecentFoods(userId);
  const foods = useMemo(() => (logs ? rankRecentFoods(logs, today(), { hidden }) : null), [logs, hidden]);
  useAnnounce(!foods && failed ? 'Recent foods could not load.' : null);

  const composed = (recent: RecentFood) => Boolean(decodeMealComposition(recent.food.description));
  const add = (recent: RecentFood) => {
    settle();
    void quickAdd(recent.key, recent.food, { servings: recent.servings, source: recent.source });
  };
  const open = (recent: RecentFood) => {
    settle();
    if (logger.purpose === 'log' && composed(recent)) logger.composeMeal(recent.food);
    else logger.chooseFood(recent.food, null, recent.servings);
  };
  const hideFood = (recent: RecentFood) => {
    settle();
    haptics.success();
    hide(recent.key);
  };

  if (!foods) {
    return failed ? (
      <View style={{ alignItems: 'center', gap: 14, marginTop: 32 }}>
        <BlancText variant="secondary" tone="graphite">
          Recent foods could not load.
        </BlancText>
        <Capsule title="Retry" variant="quiet" onPress={retry} />
      </View>
    ) : (
      <ActivityIndicator style={{ marginTop: 32 }} />
    );
  }

  // The first list shows at once; fresh data swaps it without motion; a hidden food slides away.
  return (
    <LayoutAnimationConfig key={version} skipEntering skipExiting>
      <View>
        {/* The figures' column goes unlabelled, as in Fuel's lists; VoiceOver says calories on each row. */}
        {foods.length > 0 ? (
          <Label style={{ marginTop: 14, overflow: 'hidden' }} exiting={blockExit} layout={rowLayout}>
            {foods.map((recent, index) => (
              <RecentRow
                key={recent.key}
                recent={recent}
                divided={index > 0}
                state={added[recent.key]}
                purpose={logger.purpose}
                quickAdd={enabled}
                onAdd={add}
                onOpen={open}
                onHide={hideFood}
              />
            ))}
          </Label>
        ) : null}
        {foods.length === 0 ? (
          <Animated.View entering={rowEnter} layout={rowLayout}>
            <Empty text={logs && logs.length > 0 ? 'Hidden foods come back when you log them again.' : 'Foods you log show up here, the most eaten first.'} />
          </Animated.View>
        ) : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** One recent food; drawn again only when its own food or state, or the sheet's purpose, changes. */
function RecentRow({ recent, divided, state, purpose, quickAdd, onAdd, onOpen, onHide }: {
  recent: RecentFood;
  divided: boolean;
  state?: AddState;
  purpose: 'log' | 'ingredients';
  quickAdd: boolean;
  onAdd: (recent: RecentFood) => void;
  onOpen: (recent: RecentFood) => void;
  onHide: (recent: RecentFood) => void;
}) {
  // A built meal logs again whole; as an ingredient it goes through the review, as on Saved.
  const canQuickAdd = quickAdd && (purpose === 'log' || !decodeMealComposition(recent.food.description));
  // A hold offers the usual amount at once, the review, and hiding the food.
  const amount = servingLabel({ servings: recent.servings, food: recent.food });
  const menu: MenuAction[] = [
    ...(canQuickAdd
      ? [{ title: purpose === 'ingredients' ? 'Add as ingredient' : `Log ${amount} now`, symbol: 'plus.circle', run: () => onAdd(recent) }]
      : []),
    { title: 'Review and log', symbol: 'list.bullet.rectangle', run: () => onOpen(recent) },
    ...(purpose === 'log'
      ? [{ title: 'Hide from Recent', subtitle: 'It comes back when you log it again', symbol: 'eye.slash', destructive: true, removes: true, run: () => onHide(recent) }]
      : []),
  ];
  const row = (
    <FoodRow
      food={recent.food}
      state={state}
      detail={usualLine(recent, amount)}
      servings={recent.servings}
      onOpen={() => onOpen(recent)}
      onAdd={canQuickAdd ? () => onAdd(recent) : undefined}
      menu={menu}
    />
  );
  return (
    <Animated.View entering={rowEnter} exiting={rowExit} layout={rowLayout}>
      {divided ? <Hairline /> : null}
      {purpose === 'log' ? (
        <SwipeRow name={recent.food.name} actions={[{ label: 'Hide', destructive: true, onPress: () => onHide(recent) }]}>
          {row}
        </SwipeRow>
      ) : (
        row
      )}
    </Animated.View>
  );
}
