import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';

import { describeWeightNudge, raisedTarget, weightNudge, type WeightNudge } from '@/lib/weightNudge';
import { useAppStore } from '@/stores/appStore';
import { announce, speak, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { formatWhole } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { loadWeights, useWeightStore } from '~/lib/you';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';
import { dayFromKey } from './TargetChangeRow';

/**
 * The offer to make today while the daily burn is not learned: the weight has
 * sat flat (or fallen) for three weeks on a gaining goal. Null otherwise. Reads
 * the recent weigh-ins once if this launch has not read them yet.
 */
export function useWeightNudge(): WeightNudge | null {
  const dayKey = useCurrentDayKey();
  const profile = useAppStore((state) => state.nutritionProfile);
  const target = useAppStore((state) => state.macroTarget);
  const history = useWeightStore((state) => state.history);
  const neverRead = useWeightStore((state) => state.historySince === null);
  const mayApply = Boolean(profile?.adaptive_enabled && (profile.goal === 'bulk' || profile.goal === 'lean_bulk'));
  useEffect(() => {
    if (mayApply && neverRead) void loadWeights();
  }, [mayApply, neverRead]);
  return useMemo(
    () => weightNudge({ profile, target, weightSamples: history, now: dayFromKey(dayKey) }),
    [profile, target, history, dayKey],
  );
}

/**
 * One title, one quiet line and the raise on offer, laid out as the target
 * change row is. Nothing moves until the button is tapped; the new target is
 * then the figure on the screen, and the row goes. Plain news, never red.
 * Renders nothing when there is no offer. `after` shows only with it.
 */
export function WeightNudgeRow({ after }: { after?: ReactNode }) {
  const nudge = useWeightNudge();
  const unit = useWeightStore((state) => state.unit);
  const large = useLargeText();
  const [saving, setSaving] = useState(false);
  if (!nudge) return null;
  const { title, line, action } = describeWeightNudge(nudge, unit);

  const raise = async () => {
    if (saving) return;
    const target = useAppStore.getState().macroTarget;
    if (!target) return;
    setSaving(true);
    try {
      const next = raisedTarget(target, nudge.raiseKcal);
      await useAppStore.getState().updateMacroTarget(next);
      haptics.success();
      announce(`Target now ${formatWhole(next.calories)} kcal a day.`);
    } catch {
      haptics.error();
      Alert.alert('Not saved', 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: large ? 'column' : 'row', alignItems: large ? 'flex-start' : 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingLeft: 18, paddingRight: 16 }}>
        <View accessible accessibilityLabel={speak(`${title}. ${line}`)} style={{ flex: large ? undefined : 1, minWidth: 0, gap: 1 }}>
          <BlancText variant="bodyStrong">{title}</BlancText>
          <BlancText variant="secondary" tone="graphite">
            {line}
          </BlancText>
        </View>
        <Capsule title={action} variant="quiet" size="small" busy={saving} accessibilityLabel={`${action} a day to your target`} onPress={() => void raise()} />
      </View>
      {after}
    </View>
  );
}
