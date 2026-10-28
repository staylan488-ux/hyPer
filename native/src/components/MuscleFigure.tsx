import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Ellipse, G, Line, Path } from 'react-native-svg';

import {
  BODY_SOLIDS,
  latheOutline,
  MUSCLE_PARTS,
  mixRgb,
  muscleColor,
  parseColor,
  projectX,
  rgbToCss,
  shadeMuscles,
  visibleFrom,
  type MaquettePalette,
  type Solid,
  type ViewSide,
} from '@/lib/maquette';
import type { MuscleGroup, MuscleVolume } from '@/types';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

const VIEW = { top: 1.8, bottom: -1.66, half: 0.74 };
const GAP = 0.3;
const SIDES: ViewSide[] = ['front', 'back'];
const FIGURE_WIDTH = VIEW.half * 2;
const BOX = { width: FIGURE_WIDTH * 2 + GAP, height: VIEW.top - VIEW.bottom };
/** A muscle reaches at least this far from its centre to the finger, in points (44 across). */
const REACH = 22;
const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/** Whether a drawn part is the chosen muscle; general shoulders stand for the three delt heads. */
const isChosen = (selected: MuscleGroup | null, muscle: MuscleGroup) =>
  selected === muscle || (selected === 'shoulders' && DELTS.includes(muscle));

/**
 * The muscle under a touch on the figure, or the nearest one within reach.
 * The view box is fitted into the view as the Svg's "meet" does, so the touch
 * maps into the same coordinates the shapes are drawn in.
 */
function muscleAt(px: number, py: number, width: number, height: number): MuscleGroup | null {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(width / BOX.width, height / BOX.height);
  const x = (px - (width - BOX.width * scale) / 2) / scale - VIEW.half;
  const y = (py - (height - BOX.height * scale) / 2) / scale - VIEW.top;
  const side: ViewSide = x < VIEW.half + GAP / 2 ? 'front' : 'back';
  const localX = side === 'front' ? x : x - (FIGURE_WIDTH + GAP);
  const reach = REACH / scale;
  let under: MuscleGroup | null = null;
  let nearest: { muscle: MuscleGroup; distance: number } | null = null;
  for (const part of MUSCLE_PARTS) {
    if (!visibleFrom(part.solid, side)) continue;
    const { center, radii, roll } = part.solid;
    // Into the ellipse's own axes, undoing the rotation it is drawn with.
    const angle = roll ? (side === 'front' ? -roll : roll) : 0;
    const dx = localX - projectX(center[0], side);
    const dy = y + center[1];
    const u = dx * Math.cos(angle) + dy * Math.sin(angle);
    const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
    // Parts drawn later sit on top, so the last one under the finger wins.
    if ((u / radii[0]) ** 2 + (v / radii[1]) ** 2 <= 1) under = part.muscle;
    const distance = Math.hypot(u / Math.max(radii[0], reach), v / Math.max(radii[1], reach));
    if (distance <= 1 && (!nearest || distance < nearest.distance)) nearest = { muscle: part.muscle, distance };
  }
  return under ?? nearest?.muscle ?? null;
}

/**
 * This week's volume on the flat front and back figure the web app draws from
 * the same shapes (`src/lib/maquette.ts`): bare where untrained, darker with
 * more sets, red past the recoverable ceiling. Tap a muscle to choose it (a
 * near miss counts; small ones like the side delts reach a fingertip); the
 * others quiet down. Tapping it again, or away from every muscle, clears it.
 * VoiceOver chooses from the list of muscles below the figure instead.
 */
export function MuscleFigure({ volume, selected, onPick, height = 300 }: {
  volume: MuscleVolume[];
  selected: MuscleGroup | null;
  onPick: (muscle: MuscleGroup | null) => void;
  height?: number;
}) {
  const c = useBlanc();
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const palette = useMemo<MaquettePalette>(() => {
    const ground = parseColor(c.ground, [0.95, 0.95, 0.93]);
    const ink = parseColor(c.ink, [0.04, 0.04, 0.04]);
    return { body: mixRgb(ground, ink, c.ground === '#000000' ? 0.16 : 0.09), ink, accent: parseColor(c.live, [0.82, 0.23, 0.18]) };
  }, [c.ground, c.ink, c.live]);
  const body = rgbToCss(palette.body);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const pick = (x: number, y: number) => {
    const muscle = muscleAt(x, y, size.width, size.height);
    if (muscle) onPick(isChosen(selected, muscle) ? null : muscle);
    else if (selected !== null) onPick(null);
  };

  return (
    <View>
      {/* One touch area for the figure: the shapes themselves are too small to aim at. */}
      <Pressable
        accessible={false}
        onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        onPress={(event) => pick(event.nativeEvent.locationX, event.nativeEvent.locationY)}>
        <Svg
          pointerEvents="none"
          height={height}
          width="100%"
          viewBox={`${-VIEW.half} ${-VIEW.top} ${BOX.width} ${BOX.height}`}
          preserveAspectRatio="xMidYMid meet">
          {SIDES.map((side, index) => (
            <G key={side} transform={`translate(${index * (FIGURE_WIDTH + GAP)} 0)`}>
              {BODY_SOLIDS.map((solid, i) => shape(solid, side, body, `b${i}`))}
              {MUSCLE_PARTS.filter((part) => visibleFrom(part.solid, side)).map((part, i) => {
                const shade = shades.get(part.muscle);
                const chosen = isChosen(selected, part.muscle);
                const quieted = selected !== null && !chosen;
                let color = quieted && shade?.hot ? mixRgb(palette.body, palette.ink, shade.ink) : muscleColor(shade, palette);
                if (quieted) color = mixRgb(color, palette.body, 0.72);
                else if (chosen && (!shade || shade.ink === 0)) color = mixRgb(palette.body, palette.ink, 0.45);
                return shape(part.solid, side, rgbToCss(color), `m${i}`);
              })}
            </G>
          ))}
        </Svg>
      </Pressable>
      <View style={{ flexDirection: 'row', marginTop: 2 }} importantForAccessibility="no-hide-descendants">
        {SIDES.map((side) => (
          <BlancText key={side} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {side === 'front' ? 'Front' : 'Back'}
          </BlancText>
        ))}
      </View>
    </View>
  );
}

function shape(solid: Solid, side: ViewSide, fill: string, key: string) {
  if (solid.kind === 'lathe') return <Path key={key} d={latheOutline(solid)} fill={fill} />;
  if (solid.kind === 'ellipsoid') {
    const x = projectX(solid.center[0], side);
    const y = -solid.center[1];
    const roll = solid.roll ? (side === 'front' ? -solid.roll : solid.roll) : 0;
    return (
      <Ellipse
        key={key}
        cx={x}
        cy={y}
        rx={solid.radii[0]}
        ry={solid.radii[1]}
        fill={fill}
        rotation={roll ? (roll * 180) / Math.PI : 0}
        origin={`${x}, ${y}`}
      />
    );
  }
  return (
    <Line
      key={key}
      x1={projectX(solid.from[0], side)}
      y1={-solid.from[1]}
      x2={projectX(solid.to[0], side)}
      y2={-solid.to[1]}
      stroke={fill}
      strokeWidth={solid.radius * 2}
      strokeLinecap="round"
    />
  );
}
