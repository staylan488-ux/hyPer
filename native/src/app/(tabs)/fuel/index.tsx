import { format } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { logMacro } from '@/lib/nutritionMacros';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { formatLoad, formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { today, useFuelStore, type FoodLog } from '~/lib/fuel';
import { space } from '~/theme/blanc';

export default function FuelScreen() {
  const target = useAppStore((state) => state.macroTarget);
  const logs = useFuelStore((state) => state.logs);
  const totals = useFuelStore((state) => state.totals);
  const status = useFuelStore((state) => state.status);
  const load = useFuelStore((state) => state.load);

  useEffect(() => {
    void load(today());
  }, [load]);

  // The day's meal groups in their order, then entries without a group, as on the web.
  const groups = useFuelStore((state) => state.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const sections = [
    ...groups.map((group) => ({
      key: group.id,
      title: nutritionGroupLabel(group, groups),
      logs: logs.filter((log) => log.group_id === group.id),
    })),
    { key: 'unassigned', title: 'Unassigned', logs: logs.filter((log) => !log.group_id || !groupIds.has(log.group_id)) },
  ].filter((section) => section.logs.length > 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Fuel',
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Log food',
              icon: { type: 'sfSymbol', name: 'plus' },
              onPress: () => {
                haptics.tap();
                router.push('/log-food');
              },
            },
          ],
        }}
      />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {format(new Date(), 'EEEE, MMMM d')}
        </BlancText>

        <View style={{ paddingHorizontal: space.gutter, marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <BlancText variant="figure" size={88} style={{ letterSpacing: -2.5 }}>
              {formatWhole(totals.calories)}
            </BlancText>
            <View>
              <BlancText variant="secondary" tone="graphite">
                kcal eaten
              </BlancText>
              {target ? (
                <BlancText variant="secondary" tone="graphite">
                  of {formatWhole(target.calories)}
                </BlancText>
              ) : null}
            </View>
          </View>
          {target ? (
            <View style={{ marginTop: 14 }}>
              <Track progress={totals.calories / target.calories} />
            </View>
          ) : null}
        </View>

        {target ? (
          <Section title="Macros">
            <Label>
              <MacroRow name="Protein" value={totals.protein} goal={target.protein} />
              <Hairline />
              <MacroRow name="Carbs" value={totals.carbs} goal={target.carbs} />
              <Hairline />
              <MacroRow name="Fat" value={totals.fat} goal={target.fat} />
            </Label>
          </Section>
        ) : null}

        {sections.map(({ key, title, logs: mealLogs }) => (
          <Section
            key={key}
            title={title}
            note={`${formatWhole(mealLogs.reduce((sum, log) => sum + (logMacro(log, 'calories') ?? 0), 0))} kcal`}>
            <Label>
              {mealLogs.map((log, index) => (
                <View key={log.id}>
                  {index > 0 ? <Hairline /> : null}
                  <Row title={log.food?.name ?? 'Food'} detail={entryDetail(log)} value={formatWhole(logMacro(log, 'calories') ?? 0)} />
                </View>
              ))}
            </Label>
          </Section>
        ))}

        {status === 'ready' && logs.length === 0 ? (
          <View style={{ marginTop: 40, alignItems: 'center', gap: 16, paddingHorizontal: space.gutter }}>
            <BlancText variant="secondary" tone="graphite">
              Nothing logged today.
            </BlancText>
            <Capsule title="Log food" onPress={() => router.push('/log-food')} />
          </View>
        ) : null}

        {status === 'error' ? (
          <BlancText variant="secondary" tone="live" style={{ margin: space.gutter }}>
            Today's food could not load. Pull down later or check your connection.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}

function MacroRow({ name, value, goal }: { name: string; value: number; goal: number }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingVertical: 14, gap: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <BlancText variant="body">{name}</BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {formatWhole(value)}
          </BlancText>{' '}
          / {formatWhole(goal)} g
        </BlancText>
      </View>
      <Track progress={goal > 0 ? value / goal : 0} />
    </View>
  );
}

function entryDetail(log: FoodLog): string {
  const time = log.logged_at ? format(new Date(log.logged_at), 'h:mm a') : null;
  const food = log.food;
  const servings = Number(log.servings);
  const amount = food
    ? servings === 1
      ? `${formatLoad(food.serving_size)} ${food.serving_unit}`
      : `${formatLoad(servings)} × ${formatLoad(food.serving_size)} ${food.serving_unit}`
    : null;
  return [time, amount].filter(Boolean).join(' · ');
}
