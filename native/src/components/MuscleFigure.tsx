import { useMemo, useState } from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import Svg, { Ellipse, G, Path } from 'react-native-svg';

import { mixRgb, parseColor, rgbToCss, shadeMuscles, type MuscleShade, type Rgb } from '@/lib/maquette';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';
import { AB_LINES, BODY, FIGURE, HEAD, REGIONS, regionAt, smoothPath, type ViewSide } from '~/lib/anatomy';
import { useIncreaseContrast, useLargeText } from '~/lib/accessibility';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

const SIDES: ViewSide[] = ['front', 'back'];
const FIGURE_WIDTH = FIGURE.right - FIGURE.left;
const GAP = 26;
const BOX = { width: FIGURE_WIDTH * 2 + GAP, height: FIGURE.bottom - FIGURE.top };
/** A muscle reaches at least this far from its edge to the finger, in points. */
const REACH = 12;
/** The seams between muscles, in the card's colour, in figure units (about a point); a little wider on the dark card. */
const SEAM = 0.8;
const DARK_SEAM = 1.05;

/**
 * The figure's three greys, set by hand for each card so the states stay
 * apart: the bare body (untrained), one light-mid grey (below range) and
 * ink (in range); over is the live red. Each step is at least about 1.4:1
 * from the card and 1.8:1 from its neighbour, more with Increase Contrast.
 */
const TONES = {
  light: { body: '#E4E3DE', below: '#B9B8B2', in: '#4A4A45' },
  lightContrast: { body: '#D3D2CC', below: '#8A8983', in: '#26261F' },
  dark: { body: '#343432', below: '#6E6E69', in: '#C4C4BE' },
  darkContrast: { body: '#4A4A47', below: '#98988F', in: '#E6E6E0' },
} as const;

type FigureState = 'untrained' | 'below' | 'in' | 'over';

/** A muscle's state on the figure; the best range shows only on the rows' bars. */
function stateOf(shade: MuscleShade | undefined): FigureState {
  if (!shade || shade.ink === 0) return 'untrained';
  if (shade.hot) return 'over';
  return shade.status === 'mev_mav' || shade.status === 'mav' || shade.status === 'approaching_mrv' ? 'in' : 'below';
}
const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/** Muscles chest to calves, the order VoiceOver steps through them. */
const DRAWN: MuscleGroup[] = ['chest', 'core', 'traps', 'back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'glutes', 'quads', 'hamstrings', 'calves'];
const drawnPlace = (muscle: MuscleGroup) => {
  const index = DRAWN.indexOf(muscle === 'shoulders' ? 'front_delts' : muscle);
  return index < 0 ? DRAWN.length : index;
};

/** Whether a drawn region is the chosen muscle; general shoulders stand for the three delt heads. */
const isChosen = (selected: MuscleGroup | null, muscle: MuscleGroup) =>
  selected === muscle || (selected === 'shoulders' && DELTS.includes(muscle));

/** Where the two figures sit in a view of this size, as the Svg's "meet" fits them. */
function fit(width: number, height: number) {
  const scale = Math.min(width / BOX.width, height / BOX.height);
  return { scale, left: (width - BOX.width * scale) / 2, top: (height - BOX.height * scale) / 2 };
}

/**
 * The muscle under a touch on the figure, or the nearest one within reach,
 * mapped into the coordinates the shapes are drawn in.
 */
function muscleAt(px: number, py: number, width: number, height: number): MuscleGroup | null {
  if (width <= 0 || height <= 0) return null;
  const { scale, left, top } = fit(width, height);
  const x = (px - left) / scale + FIGURE.left;
  const y = (py - top) / scale + FIGURE.top;
  const side: ViewSide = x < FIGURE.right + GAP / 2 ? 'front' : 'back';
  return regionAt(side === 'front' ? x : x - (FIGURE_WIDTH + GAP), y, side, REACH / scale);
}

/**
 * This week's volume on a flat front and back muscle figure: bare where
 * untrained, light grey below range, ink in range, red past the recoverable
 * ceiling, with the key under it. The shading is the web app's
 * (`src/lib/maquette.ts`); the drawing is the app's own (`lib/anatomy.ts`).
 * Tap a muscle to choose it (a near miss counts; small ones like the side
 * delts reach a fingertip); the others quiet down. Tapping it again, or away
 * from every muscle, clears it. For VoiceOver the figure is one adjustable
 * element: swiping up and down steps through this week's muscles (the rows
 * of the list below it), and down past the first clears the choice.
 */
export function MuscleFigure({ volume, selected, onPick, height = 200 }: {
  volume: MuscleVolume[];
  selected: MuscleGroup | null;
  onPick: (muscle: MuscleGroup | null) => void;
  height?: number;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const dark = useColorScheme() === 'dark';
  const contrast = useIncreaseContrast();
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const tones = TONES[`${dark ? 'dark' : 'light'}${contrast ? 'Contrast' : ''}`];
  const palette = useMemo<Record<FigureState, Rgb>>(
    () => ({
      untrained: parseColor(tones.body, [0.89, 0.88, 0.86]),
      below: parseColor(tones.below, [0.66, 0.66, 0.64]),
      // In range reads strongest without the full weight of ink, which made the figure a silhouette.
      in: parseColor(tones.in, [0.29, 0.29, 0.27]),
      over: parseColor(c.live, [0.82, 0.23, 0.18]),
    }),
    [tones, c.live],
  );
  const body = tones.body;
  const seam = dark ? DARK_SEAM : SEAM;
  const [size, setSize] = useState({ width: 0, height: 0 });

  const pick = (x: number, y: number) => {
    const muscle = muscleAt(x, y, size.width, size.height);
    if (muscle) onPick(isChosen(selected, muscle) ? null : muscle);
    else if (selected !== null) onPick(null);
  };

  const choices = useMemo(() => volume.map((entry) => entry.muscle_group).sort((a, b) => drawnPlace(a) - drawnPlace(b)), [volume]);
  const step = (direction: 1 | -1) => {
    const next = (selected ? choices.indexOf(selected) : -1) + direction;
    if (next >= -1 && next < choices.length) onPick(next === -1 ? null : choices[next]);
  };
  const entry = selected ? volume.find((candidate) => candidate.muscle_group === selected) : undefined;
  const sets = entry ? (Number.isInteger(entry.weekly_sets) ? entry.weekly_sets : entry.weekly_sets.toFixed(1)) : null;
  const spokenValue = selected
    ? `${MUSCLE_GROUP_LABELS[selected]}${entry ? `, ${sets} ${entry.weekly_sets === 1 ? 'set' : 'sets'}` : ''}`
    : 'None chosen';

  const colorOf = (muscle: MuscleGroup) => {
    const state = stateOf(shades.get(muscle));
    const chosen = isChosen(selected, muscle);
    // The others quiet down toward the bare body (red going grey, so the chosen one leads).
    if (selected !== null && !chosen) return rgbToCss(mixRgb(palette[state === 'over' ? 'in' : state], palette.untrained, 0.72));
    // A chosen muscle with nothing this week still shows where it is.
    if (chosen && state === 'untrained') return rgbToCss(mixRgb(palette.untrained, palette.below, 0.5));
    return rgbToCss(palette[state]);
  };
  // The key: one swatch for each state a trained muscle takes.
  const key: Array<{ label: string; swatch: string }> = [
    { label: 'Below range', swatch: rgbToCss(palette.below) },
    { label: 'In range', swatch: rgbToCss(palette.in) },
    { label: 'Over', swatch: rgbToCss(palette.over) },
  ];
  const placed = size.width > 0 ? fit(size.width, size.height) : null;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Muscle figure"
      accessibilityHint="Swipe up or down to choose a muscle."
      accessibilityValue={{ text: spokenValue }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') step(1);
        if (event.nativeEvent.actionName === 'decrement') step(-1);
      }}
      // A double tap would land between the two figures and clear the
      // choice by chance; the figure is chosen by swiping.
      onAccessibilityTap={() => undefined}>
      {/* One touch area for the figure: the shapes themselves are too small to aim at. */}
      <Pressable
        accessible={false}
        onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        onPress={(event) => pick(event.nativeEvent.locationX, event.nativeEvent.locationY)}>
        <Svg
          pointerEvents="none"
          height={height}
          width="100%"
          viewBox={`${FIGURE.left} ${FIGURE.top} ${BOX.width} ${BOX.height}`}
          preserveAspectRatio="xMidYMid meet">
          {SIDES.map((side, index) => (
            <G key={side} transform={`translate(${index * (FIGURE_WIDTH + GAP)} 0)`}>
              <Ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill={body} />
              {BODY.map((outline, i) => (
                <Path key={`b${i}`} d={smoothPath(outline)} fill={body} />
              ))}
              {REGIONS[side].map((region, i) => (
                <Path key={`m${i}`} d={smoothPath(region.points)} fill={colorOf(region.muscle)} stroke={c.label} strokeWidth={seam} strokeLinejoin="round" />
              ))}
              {side === 'front'
                ? AB_LINES.map(([from, to], i) => (
                    <Path key={`a${i}`} d={`M${from[0]} ${from[1]}L${to[0]} ${to[1]}`} stroke={c.label} strokeWidth={seam} />
                  ))
                : null}
            </G>
          ))}
        </Svg>
      </Pressable>
      {/* Front and Back, centred under their figures. */}
      <View style={{ flexDirection: 'row', marginTop: 2, paddingLeft: placed?.left ?? 0 }}>
        {SIDES.map((side, index) => (
          <BlancText
            key={side}
            variant="footnote"
            tone="graphite"
            style={{
              width: placed ? FIGURE_WIDTH * placed.scale : undefined,
              flex: placed ? undefined : 1,
              marginLeft: placed && index > 0 ? GAP * placed.scale : 0,
              textAlign: 'center',
            }}>
            {side === 'front' ? 'Front' : 'Back'}
          </BlancText>
        ))}
      </View>
      {/* What the shades mean. Inside the one adjustable element, so VoiceOver reads the rows below instead. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 4, marginTop: large ? 10 : 8 }}>
        {key.map((item) => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 2.5, borderCurve: 'continuous', backgroundColor: item.swatch }} />
            <BlancText variant="footnote" tone="graphite">
              {item.label}
            </BlancText>
          </View>
        ))}
      </View>
    </View>
  );
}
