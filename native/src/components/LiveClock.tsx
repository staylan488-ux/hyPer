import { View } from 'react-native';

import { spokenClock } from '~/lib/accessibility';
import { formatClock } from '~/lib/format';
import { useNow } from '~/lib/session';
import { useBlanc } from '~/theme/blanc';

import { BlancText, type BlancTextProps } from './BlancText';

/**
 * The live workout's clock behind the live dot: one format wherever the dot
 * appears (Today's card, Train, the workout bar), ticking on its own so the
 * screen around it stays still.
 */
export function LiveClock({
  startedAt,
  variant = 'footnote',
  tone = 'graphite',
  weight,
  maxFontSizeMultiplier,
}: {
  startedAt: Date;
  variant?: BlancTextProps['variant'];
  tone?: BlancTextProps['tone'];
  weight?: BlancTextProps['weight'];
  maxFontSizeMultiplier?: number;
}) {
  const c = useBlanc();
  const now = useNow(1000);
  const seconds = Math.max(0, (now - startedAt.getTime()) / 1000);
  return (
    <View
      accessible
      accessibilityLabel={`Workout time, ${spokenClock(seconds)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.live }} />
      <BlancText variant={variant} tone={tone} weight={weight} maxFontSizeMultiplier={maxFontSizeMultiplier} style={{ fontVariant: ['tabular-nums'] }}>
        {formatClock(seconds)}
      </BlancText>
    </View>
  );
}
