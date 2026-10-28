import { useMemo } from 'react';
import { View } from 'react-native';
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

/**
 * This week's volume on the flat front and back figure the web app draws from
 * the same shapes (`src/lib/maquette.ts`): bare where untrained, darker with
 * more sets, red past the recoverable ceiling. Tap a muscle to choose it; the
 * others quiet down.
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
  const width = VIEW.half * 2;

  return (
    <View>
      <Svg
        height={height}
        width="100%"
        viewBox={`${-VIEW.half} ${-VIEW.top} ${width * 2 + GAP} ${VIEW.top - VIEW.bottom}`}
        preserveAspectRatio="xMidYMid meet">
        {SIDES.map((side, index) => (
          <G key={side} transform={`translate(${index * (width + GAP)} 0)`}>
            {BODY_SOLIDS.map((solid, i) => shape(solid, side, body, `b${i}`))}
            {MUSCLE_PARTS.filter((part) => visibleFrom(part.solid, side)).map((part, i) => {
              const shade = shades.get(part.muscle);
              const quieted = selected !== null && selected !== part.muscle;
              let color = quieted && shade?.hot ? mixRgb(palette.body, palette.ink, shade.ink) : muscleColor(shade, palette);
              if (quieted) color = mixRgb(color, palette.body, 0.72);
              else if (selected === part.muscle && (!shade || shade.ink === 0)) color = mixRgb(palette.body, palette.ink, 0.45);
              return shape(part.solid, side, rgbToCss(color), `m${i}`, () => onPick(selected === part.muscle ? null : part.muscle));
            })}
          </G>
        ))}
      </Svg>
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

function shape(solid: Solid, side: ViewSide, fill: string, key: string, onPress?: () => void) {
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
        onPress={onPress}
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
