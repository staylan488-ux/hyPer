import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { retireSavedMeal } from '@/lib/savedMeals';
import { useAuthStore } from '@/stores/authStore';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { editSavedMeal, loadYouMeals, usePullRefresh, useYouMealsStore } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Saved meals: the meals kept for quick logging. Tap to edit; swipe for Edit
 * and Delete (a full swipe deletes); hold for the same. Deleting keeps past
 * logged entries as they were.
 */
export default function SavedMealsScreen() {
  const c = useBlanc();
  const meals = useYouMealsStore((state) => state.meals);
  const failed = useYouMealsStore((state) => state.failed);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const { refreshing, refresh } = usePullRefresh(loadYouMeals);

  useEffect(() => {
    void loadYouMeals();
  }, []);

  // A deleted meal folds away at once and comes back if retiring it fails.
  const remove = async (meal: Food) => {
    setLeaving((current) => new Set(current).add(meal.id));
    const userId = useAuthStore.getState().user?.id;
    const { error } = userId ? await retireSavedMeal(userId, meal.id) : { error: new Error('signed out') };
    if (error) {
      haptics.error();
      Alert.alert('Not deleted', 'Check your connection and try again.');
    } else {
      haptics.success();
      // Gone from the list even if the reload after it fails.
      useYouMealsStore.setState((state) => ({ meals: state.meals?.filter((candidate) => candidate.id !== meal.id) ?? null }));
      await loadYouMeals();
    }
    setLeaving((current) => {
      const next = new Set(current);
      next.delete(meal.id);
      return next;
    });
  };

  const shown = (meals ?? []).filter((meal) => !leaving.has(meal.id));

  return (
    <>
      <Stack.Screen options={{ title: 'Saved meals' }} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {meals === null ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : shown.length === 0 ? (
          <Label style={{ marginTop: 12, padding: 18, gap: failed ? 14 : 2 }}>
            <BlancText variant="headline">{failed ? 'Saved meals not loaded' : 'No saved meals yet'}</BlancText>
            {failed ? (
              <Capsule title="Try again" fill onPress={() => void loadYouMeals()} />
            ) : (
              <BlancText variant="secondary" tone="graphite">
                Meals you save while logging food show up here.
              </BlancText>
            )}
          </Label>
        ) : (
          <Label style={{ marginTop: 12, overflow: 'hidden' }} layout={rowLayout}>
            {shown.map((meal, index) => (
              <Animated.View key={meal.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                {index > 0 ? <Hairline /> : null}
                <SwipeRow
                  name={meal.name}
                  actions={[
                    { label: 'Edit', onPress: () => editSavedMeal(meal) },
                    { label: 'Delete', destructive: true, onPress: () => void remove(meal) },
                  ]}>
                  <View style={{ backgroundColor: c.label }}>
                    <Row
                      title={meal.name}
                      value={`${formatWhole(Number(meal.calories) || 0)} kcal`}
                      onPress={() => editSavedMeal(meal)}
                      menu={[
                        { title: 'Edit', symbol: 'pencil', run: () => editSavedMeal(meal) },
                        { title: 'Delete', subtitle: 'Past logged entries stay', symbol: 'trash', destructive: true, removes: true, run: () => void remove(meal) },
                      ]}
                    />
                  </View>
                </SwipeRow>
              </Animated.View>
            ))}
          </Label>
        )}
        {shown.length > 0 ? (
          <Animated.View layout={rowLayout}>
            <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter + 12, marginTop: 8 }}>
              Deleting a meal keeps past logged entries.
            </BlancText>
          </Animated.View>
        ) : null}
      </TabScroll>
    </>
  );
}
