import { useWindowDimensions, View } from 'react-native';

import { formatLoad } from '~/lib/format';
import { space, useBlanc } from '~/theme/blanc';

/** Each plate's face, drawn to its size on the bar (taller and thicker as it gets heavier). */
const PLATE_SHAPE: Record<number, { height: number; width: number }> = {
  45: { height: 84, width: 13 },
  25: { height: 64, width: 11 },
  10: { height: 46, width: 8 },
  5: { height: 36, width: 7 },
  2.5: { height: 28, width: 6 },
};
const FALLBACK = { height: 40, width: 7 };
const GAP = 2;
const COLLAR = { width: 5, height: 18 };
const SLEEVE = { width: 14, height: 8 };
const SHAFT = { width: 72, height: 6 };
/** The drawing's height whatever is loaded, so the sheet keeps its size as the weight changes. */
const HEIGHT = 84;

/**
 * A barbell seen from the front with its plates: the shaft in the middle,
 * then each side's collar, plates heaviest first and the sleeve's end. The
 * bar is `mark`, the plates ink. It scales down to fit the card when a heavy
 * load runs wide; the words under it carry the numbers.
 */
export function PlateBar({ perSide, accessibilityLabel }: { perSide: readonly number[]; accessibilityLabel: string }) {
  const c = useBlanc();
  const { width: screen } = useWindowDimensions();
  const plates = perSide.map((plate) => PLATE_SHAPE[plate] ?? FALLBACK);
  const sideWidth = COLLAR.width + plates.reduce((sum, plate) => sum + plate.width + GAP, 0) + SLEEVE.width;
  const needed = SHAFT.width + sideWidth * 2;
  // The card's inner width: the sheet's inset and the card's own padding on each side.
  const room = screen - space.inset * 2 - 36;
  const scale = Math.min(1, room / needed);
  const bar = (size: { width: number; height: number }) => ({
    width: size.width * scale,
    height: size.height * scale,
    backgroundColor: c.mark,
  });
  const side = (mirrored: boolean) => {
    const parts = [
      <View key="collar" style={[bar(COLLAR), { borderRadius: 1.5 * scale }]} />,
      ...plates.map((plate, index) => (
        <View
          key={`${perSide[index]}-${index}`}
          style={{
            width: plate.width * scale,
            height: plate.height * scale,
            marginHorizontal: (GAP / 2) * scale,
            borderRadius: 2.5 * scale,
            borderCurve: 'continuous',
            backgroundColor: c.ink,
          }}
        />
      )),
      <View key="sleeve" style={[bar(SLEEVE), { marginHorizontal: (GAP / 2) * scale, borderRadius: 2 * scale }]} />,
    ];
    // The left side is the right one turned round: its collar meets the shaft.
    return (
      <View style={{ flexDirection: mirrored ? 'row-reverse' : 'row', alignItems: 'center' }}>
        {parts}
      </View>
    );
  };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ height: HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      {side(true)}
      <View style={bar(SHAFT)} />
      {side(false)}
    </View>
  );
}

/** What the drawing shows, in words: "45, 25 and 10 on each side of a 45 pound bar". */
export function spokenPlates(perSide: readonly number[], bar: number): string {
  const barWords = `a ${formatLoad(bar)} pound bar`;
  if (perSide.length === 0) return `Just ${barWords}`;
  const names = perSide.map((plate) => formatLoad(plate));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${list} on each side of ${barWords}`;
}
