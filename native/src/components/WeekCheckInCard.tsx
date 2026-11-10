import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { checkInWeekLabel, goalPaceKg, hasCheckIn, type WeekCheckIn } from '@/lib/weekCheckIn';
import { useAppStore } from '@/stores/appStore';
import { speak, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { rowEnter } from '~/lib/motion';
import { checkInLines, hideWeekCheckIn } from '~/lib/weekCheckIn';
import { useWeightStore } from '~/lib/you';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { HoldMenu, hasHoldMenu, menuAccessibility, showActionSheet, type MenuAction } from './HoldMenu';
import { Label } from './Label';
import { Section } from './Section';

/**
 * Monday's look back at the week before, under Today's Progress: one card that
 * opens Last week. A hold puts it away until next Monday. Nothing shows until
 * the week is read, or when it holds nothing.
 */
export function WeekCheckInCard({ checkIn, todayKey }: { checkIn: WeekCheckIn; todayKey: string }) {
  const c = useBlanc();
  const large = useLargeText();
  const unit = useWeightStore((state) => state.unit);
  const target = useAppStore((state) => state.macroTarget);
  const profile = useAppStore((state) => state.nutritionProfile);
  if (!hasCheckIn(checkIn)) return null;

  const paceKg = checkIn.weight ? goalPaceKg(profile, checkIn.weight.averageKg) : null;
  const lines = checkInLines(checkIn, unit, target, paceKg);
  const menu: MenuAction[] = [{ title: 'Hide until next week', symbol: 'eye.slash', removes: true, run: () => hideWeekCheckIn(todayKey) }];
  const held = menuAccessibility(menu);
  const open = () => router.push('/today/week');

  return (
    <Section title="Last week" note={checkInWeekLabel(checkIn.week)}>
      <Animated.View entering={rowEnter}>
        <Label style={{ overflow: 'hidden' }}>
          <HoldMenu actions={menu}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speak(lines.map((line) => `${line.label}, ${line.value}${line.after}`).join('. '))}
              accessibilityHint="Opens last week"
              accessibilityActions={held.actions}
              onAccessibilityAction={(event) => held.run(event.nativeEvent.actionName)}
              onPress={() => {
                haptics.tap();
                open();
              }}
              // A build without iOS's context menu shows the same choice as a sheet.
              onLongPress={
                hasHoldMenu
                  ? undefined
                  : () => {
                      haptics.select();
                      showActionSheet(undefined, menu);
                    }
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingLeft: 18,
                paddingRight: 16,
                paddingVertical: 14,
                backgroundColor: pressed ? c.pressed : 'transparent',
              })}>
              <View style={{ flex: 1, gap: 8 }}>
                {lines.map((line) => (
                  // At the accessibility text sizes the figure wraps under its label.
                  <View key={line.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 12, ...(large ? { flexWrap: 'wrap' } : null) }}>
                    <BlancText variant="secondary" tone="graphite">
                      {line.label}
                    </BlancText>
                    <BlancText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: large ? 'left' : 'right' }} numberOfLines={large ? undefined : 1}>
                      {line.value}
                      <BlancText variant="secondary" weight="400" tone="graphite">
                        {line.after}
                      </BlancText>
                    </BlancText>
                  </View>
                ))}
              </View>
              <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} />
            </Pressable>
          </HoldMenu>
        </Label>
      </Animated.View>
    </Section>
  );
}
