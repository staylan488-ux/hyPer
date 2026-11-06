import { useMemo, useState } from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';

import { mixRgb, parseColor, rgbToCss, shadeMuscles, type MuscleShade, type Rgb } from '@/lib/maquette';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';
import { FIGURE, HEAD, MUSCLE_EDGES, pathOf, REGIONS, regionAt, SILHOUETTE, type ViewSide } from '~/lib/anatomy';
import { useIncreaseContrast, useLargeText } from '~/lib/accessibility';
import { useBlanc } from '~/theme/blanc';
import { muscleTonesFor } from '~/theme/muscleTones';

import { BlancText } from './BlancText';

const SIDES: ViewSide[] = ['front', 'back'];
const FIGURE_WIDTH = FIGURE.right - FIGURE.left;
/** Between the two figures, in figure units: they sit about a third and two thirds across the card. */
const GAP = 44;
const BOX = { width: FIGURE_WIDTH * 2 + GAP, height: FIGURE.bottom - FIGURE.top };
/** A muscle reaches at least this far from its edge to the finger, in points. */
const REACH = 12;
/**
 * The seams between muscles, in the card's colour, in figure units: about
 * seven tenths of a point at the figure's height; a little wider on the
 * dark card. Neighbouring muscles share one edge (lib/anatomy), so a seam
 * is this wide everywhere.
 */
const SEAM = 1;
const DARK_SEAM = 1.35;
/** Between the caption above and the figures' heads, in points: the caption's baseline sits about 14 pt above them. */
const HEAD_ROOM = 8;

/**
 * The body's edge on the light cards, in points as it shows: half the
 * contour's stroke shows outside the body, so the near-white body stands
 * off the white card. On the dark card the contour is set in figure units,
 * wider (and its tone lighter, in muscleTones), so the edge still reads there.
 */
const BODY_EDGE = 1;
const DARK_CONTOUR = 2.8;
/**
 * The outline that marks a muscle below range, in points as it shows: drawn
 * inside the muscle only, so it never spills onto a neighbour or past the body.
 */
const BELOW_OUTLINE = 1.35;

/** Each view's shapes as path data, the back view moved along beside the front. */
const VIEWS = SIDES.map((side, index) => {
  const dx = index * (FIGURE_WIDTH + GAP);
  return {
    side,
    head: { ...HEAD, cx: HEAD.cx + dx },
    body: pathOf(SILHOUETTE, dx),
    regions: REGIONS[side].map((region) => ({
      muscle: region.muscle,
      d: pathOf(region.cubics, dx),
      seams: region.seams.map((seam) => pathOf(seam, dx, false)).join(''),
    })),
    // Each muscle as one shape, for the outline below range: its outer edge, and its pieces to keep the outline inside.
    muscles: [...MUSCLE_EDGES[side]].map(([muscle, edge]) => ({
      muscle,
      edge: edge.map((cubic) => pathOf([cubic], dx, false)).join(''),
      pieces: REGIONS[side].filter((region) => region.muscle === muscle).map((region) => pathOf(region.cubics, dx)),
    })),
  };
});

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
 * This week's volume on a flat front and back muscle figure: the bare body
 * where untrained; below range, the muscle to act on, a light fill held by a
 * dark outline, the most legible mark; a quieter mid-tone fill in range, and
 * red past the recoverable ceiling. Front and Back are named under their
 * figures, with the key under them. The shading is the web app's
 * (`src/lib/maquette.ts`); the drawing is the app's own (`lib/anatomy.ts`).
 * Tap a muscle to choose it (a near miss counts; small ones like the side
 * delts reach a fingertip); the others quiet down. Tapping it again, or away
 * from every muscle, clears it. For VoiceOver the figure is one adjustable
 * element: swiping up and down steps through this week's muscles (the rows
 * of the list below it), and down past the first clears the choice.
 */
export function MuscleFigure({ volume, selected, onPick, height = 136 }: {
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
  const tones = muscleTonesFor(dark, contrast);
  const palette = useMemo<Record<FigureState, Rgb>>(
    () => ({
      untrained: parseColor(tones.body, [0.96, 0.96, 0.95]),
      below: parseColor(tones.below, [0.89, 0.89, 0.86]),
      // In range is a fill that recedes, so below range's outline, the state to act on, leads.
      in: parseColor(tones.in, [0.52, 0.52, 0.5]),
      over: parseColor(c.live, [0.82, 0.23, 0.18]),
    }),
    [tones, c.live],
  );
  const belowEdge = useMemo(() => parseColor(tones.belowEdge, [0.33, 0.33, 0.31]), [tones]);
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
    if (chosen && state === 'untrained') return rgbToCss(mixRgb(palette.untrained, palette.in, 0.3));
    return rgbToCss(palette[state]);
  };
  // Below range also draws its outline, quieted with the rest while another muscle is chosen.
  const outlineOf = (muscle: MuscleGroup) => {
    if (stateOf(shades.get(muscle)) !== 'below') return null;
    return rgbToCss(selected !== null && !isChosen(selected, muscle) ? mixRgb(belowEdge, palette.untrained, 0.72) : belowEdge);
  };
  // Untrained and not chosen: drawn as the body itself.
  const bare = (muscle: MuscleGroup) => stateOf(shades.get(muscle)) === 'untrained' && !isChosen(selected, muscle);
  // The key: one swatch for each state a trained muscle takes.
  const key: Array<{ label: string; swatch: string; edge?: string }> = [
    { label: 'Below range', swatch: rgbToCss(palette.below), edge: rgbToCss(belowEdge) },
    { label: 'In range', swatch: rgbToCss(palette.in) },
    { label: 'Over', swatch: rgbToCss(palette.over) },
  ];
  const placed = size.width > 0 ? fit(size.width, size.height) : null;
  const scale = placed?.scale ?? height / BOX.height;
  // The outline is stroked on the muscle's outer edge at twice its width and
  // clipped to the muscle, so only its inner half shows; the seam in the
  // card's colour then takes half a seam of it, which the width makes up.
  const outlineWidth = 2 * (BELOW_OUTLINE / scale + seam / 2);
  // The contour is stroked at twice the edge that shows outside the body.
  const contour = dark ? DARK_CONTOUR : (2 * BODY_EDGE) / scale;

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
        style={{ marginTop: HEAD_ROOM }}
        onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
        onPress={(event) => pick(event.nativeEvent.locationX, event.nativeEvent.locationY)}>
        <Svg
          pointerEvents="none"
          height={height}
          width="100%"
          viewBox={`${FIGURE.left} ${FIGURE.top} ${BOX.width} ${BOX.height}`}
          preserveAspectRatio="xMidYMid meet">
          {/* The seams stop at the body's edge, so they never notch its contour. */}
          <Defs>
            {VIEWS.map((view) => (
              <ClipPath key={view.side} id={`figure-${view.side}`}>
                <Path d={view.body} />
              </ClipPath>
            ))}
            {VIEWS.flatMap((view) =>
              view.muscles.map((group) =>
                outlineOf(group.muscle) ? (
                  <ClipPath key={`${view.side}-${group.muscle}`} id={`below-${view.side}-${group.muscle}`}>
                    {group.pieces.map((piece, i) => (
                      <Path key={i} d={piece} />
                    ))}
                  </ClipPath>
                ) : null,
              ),
            )}
          </Defs>
          {VIEWS.map((view) => (
            <G key={view.side}>
              {/* The contour: the head and body stroked, then filled over, so only the silhouette's outer edge shows. */}
              <Ellipse cx={view.head.cx} cy={view.head.cy} rx={view.head.rx} ry={view.head.ry} fill={tones.contour} stroke={tones.contour} strokeWidth={contour} />
              <Path d={view.body} fill={tones.contour} stroke={tones.contour} strokeWidth={contour} strokeLinejoin="round" />
              <Ellipse cx={view.head.cx} cy={view.head.cy} rx={view.head.rx} ry={view.head.ry} fill={body} />
              <Path d={view.body} fill={body} />
              {/* A muscle left as the body draws nothing: the body already shows it. */}
              {view.regions.map((region, i) => (bare(region.muscle) ? null : <Path key={`m${i}`} d={region.d} fill={colorOf(region.muscle)} />))}
              {view.muscles.map((group) => {
                const outline = outlineOf(group.muscle);
                return outline ? (
                  <Path
                    key={`o-${group.muscle}`}
                    d={group.edge}
                    fill="none"
                    stroke={outline}
                    strokeWidth={outlineWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    clipPath={`url(#below-${view.side}-${group.muscle})`}
                  />
                ) : null;
              })}
              <G clipPath={`url(#figure-${view.side})`}>
                {view.regions.map((region, i) =>
                  bare(region.muscle) ? null : (
                    <Path key={`s${i}`} d={region.seams} fill="none" stroke={c.label} strokeWidth={seam} strokeLinecap="round" strokeLinejoin="round" />
                  ),
                )}
              </G>
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
            numberOfLines={large ? undefined : 1}
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 4, marginTop: large ? 8 : 6 }}>
        {key.map((item) => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2.5,
                borderCurve: 'continuous',
                backgroundColor: item.swatch,
                ...(item.edge ? { borderWidth: BELOW_OUTLINE, borderColor: item.edge } : null),
              }}
            />
            <BlancText variant="footnote" tone="graphite">
              {item.label}
            </BlancText>
          </View>
        ))}
      </View>
    </View>
  );
}
