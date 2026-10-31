import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { decodeMealComposition } from '@/lib/mealComposition';
import { servingLabel } from '@/lib/nutritionLedger';
import { rankRecentFoods, type RecentFood } from '@/lib/recentFoods';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import type { MenuAction } from '~/components/HoldMenu';
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

  // A hold offers the usual amount at once, the review, and hiding the food.
  const menu = (recent: RecentFood): MenuAction[] => {
    const amount = servingLabel({ servings: recent.servings, food: recent.food });
    return [
      ...(canQuickAdd(recent)
        ? [{ title: logger.purpose === 'ingredients' ? 'Add as ingredient' : `Log ${amount} now`, symbol: 'plus.circle', run: () => add(recent) }]
        : []),
      { title: 'Review and log', symbol: 'list.bullet.rectangle', run: () => open(recent) },
      ...(logger.purpose === 'log'
        ? [{ title: 'Hide from Recent', subtitle: 'It comes back when you log it again', symbol: 'eye.slash', destructive: true, removes: true, run: () => hideFood(recent) }]
        : []),
    ];
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
              menu={menu(recent)}
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
