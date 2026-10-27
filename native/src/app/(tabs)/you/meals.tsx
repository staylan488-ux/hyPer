import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { retireSavedMeal } from '@/lib/savedMeals';
import { useAuthStore } from '@/stores/authStore';
import type { Food } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { editSavedMeal, loadYouMeals, useYouMealsStore } from '~/lib/you';
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
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);

  useEffect(() => {
    void loadYouMeals();
  }, []);

  // A deleted meal folds away at once and comes back if retiring it fails.
  const remove = async (meal: Food) => {
    setMessage(null);
    setLeaving((current) => new Set(current).add(meal.id));
    const userId = useAuthStore.getState().user?.id;
    const { error } = userId ? await retireSavedMeal(userId, meal.id) : { error: new Error('signed out') };
    if (error) {
      haptics.error();
      setMessage({ text: 'Could not delete saved meal. Please try again.', alert: true });
    } else {
      await loadYouMeals();
    }
    setLeaving((current) => {
      const next = new Set(current);
      next.delete(meal.id);
      return next;
    });
  };

  const menu = (meal: Food) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: meal.name,
        message: 'Deleting it keeps past logged entries.',
        options: ['Edit', 'Delete', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) editSavedMeal(meal);
        if (index === 1) void remove(meal);
      },
    );
  };

  const shown = (meals ?? []).filter((meal) => !leaving.has(meal.id));

  return (
    <>
      <Stack.Screen options={{ title: 'Saved meals' }} />
      <TabScroll>
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
          <Label style={{ marginTop: 12, overflow: 'hidden' }}>
            {shown.map((meal, index) => (
              <Animated.View key={meal.id} exiting={FadeOut.duration(180)} layout={LinearTransition.duration(220)}>
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
                      onLongPress={{ label: 'More actions', run: () => menu(meal) }}
                    />
                  </View>
                </SwipeRow>
              </Animated.View>
            ))}
          </Label>
        )}
        {message ? <FormNote alert={message.alert}>{message.text}</FormNote> : null}
        {shown.length > 0 ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter + 12, marginTop: 8 }}>
            Deleting a meal keeps past logged entries.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}
