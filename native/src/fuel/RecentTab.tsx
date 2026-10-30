import { useMemo } from 'react';
import { ActionSheetIOS, ActivityIndicator, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { decodeMealComposition } from '@/lib/mealComposition';
import { servingLabel } from '@/lib/nutritionLedger';
import { rankRecentFoods, type RecentFood } from '@/lib/recentFoods';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Hairline } from '~/components/Row';
import { SwipeRow } from '~/components/SwipeRow';
import { formatWhole } from '~/lib/format';
import { today } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';

import { useLogger } from './context';
import { Empty, FoodRow, useQuickAdd } from './FoodLists';
import { useHiddenRecentFoods, useRecentLogs } from './recent';

/** "150 g · 248 kcal · 31 g protein": what + logs. */
function usualLine(recent: RecentFood): string {
  const protein = Math.round(recent.food.protein * recent.servings);
  return [
    servingLabel({ servings: recent.servings, food: recent.food }),
    `${formatWhole(recent.food.calories * recent.servings)} kcal`,
    protein > 0 ? `${protein} g protein` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Recent: the foods eaten lately, the most often eaten first. + logs the usual
 * amount at once into the sheet's meal; a tap reviews it at that amount; a
 * swipe or hold hides one until it is logged again.
 */
export function RecentTab({ userId }: { userId: string }) {
  const logger = useLogger();
  const quick = useQuickAdd();
  const { logs, failed, version, settle, retry } = useRecentLogs(userId);
  const { hidden, hide } = useHiddenRecentFoods(userId);
  const foods = useMemo(() => (logs ? rankRecentFoods(logs, today(), { hidden }) : null), [logs, hidden]);

  const composed = (recent: RecentFood) => Boolean(decodeMealComposition(recent.food.description));
  // A built meal logs again whole; as an ingredient it goes through the review, as on Saved.
  const canQuickAdd = (recent: RecentFood) => quick.enabled && (logger.purpose === 'log' || !composed(recent));
  const add = (recent: RecentFood) => {
    settle();
    void quick.add(recent.key, recent.food, { servings: recent.servings, source: recent.source });
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

  const menu = (recent: RecentFood) => {
    const actions: { label: string; run: () => void }[] = [];
    if (canQuickAdd(recent)) {
      const amount = servingLabel({ servings: recent.servings, food: recent.food });
      actions.push({ label: logger.purpose === 'ingredients' ? 'Add as ingredient' : `Log ${amount} now`, run: () => add(recent) });
    }
    actions.push({ label: 'Review and log', run: () => open(recent) });
    const hides = logger.purpose === 'log';
    if (hides) actions.push({ label: 'Hide from Recent', run: () => hideFood(recent) });
    const options = [...actions.map((action) => action.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: recent.food.name,
        message: hides ? 'A hidden food comes back when you log it again.' : undefined,
        options,
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: hides ? actions.length - 1 : undefined,
      },
      (index) => {
        if (index < actions.length) actions[index].run();
      },
    );
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
      <View style={{ marginTop: 8 }}>
        {foods.map((recent, index) => {
          const row = (
            <FoodRow
              food={recent.food}
              state={quick.added[recent.key]}
              detail={usualLine(recent)}
              servings={recent.servings}
              onOpen={() => open(recent)}
              onAdd={canQuickAdd(recent) ? () => add(recent) : undefined}
              onLongPress={() => menu(recent)}
            />
          );
          return (
            <Animated.View key={recent.key} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline inset={20} /> : null}
              {logger.purpose === 'log' ? (
                <SwipeRow name={recent.food.name} actions={[{ label: 'Hide', destructive: true, onPress: () => hideFood(recent) }]}>
                  {row}
                </SwipeRow>
              ) : (
                row
              )}
            </Animated.View>
          );
        })}
        {foods.length === 0 ? (
          <Animated.View entering={rowEnter} layout={rowLayout}>
            <Empty text={logs && logs.length > 0 ? 'Hidden foods come back when you log them again.' : 'Foods you log show up here, the most eaten first.'} />
          </Animated.View>
        ) : null}
      </View>
    </LayoutAnimationConfig>
  );
}
