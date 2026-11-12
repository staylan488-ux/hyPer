import { useMemo, useState } from 'react';
import { Pressable, useColorScheme, View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, Path } from 'react-native-svg';

import { mixRgb, parseColor, rgbToCss, shadeMuscles, type MuscleProgressState, type Rgb } from '@/lib/maquette';
import { doneOfPlanned } from '@/lib/muscleProgress';
import { muscleLabel } from '@/lib/muscleVolume';
import type { MuscleGroup } from '@/types';
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
 * The seams between muscles, in the card's colour, in figure units: about a
 * point at the figure's height; a little wider on the dark card. Neighbouring
 * muscles share one edge (lib/anatomy), so a seam is this wide everywhere.
 */
const SEAM = 1;
const DARK_SEAM = 1.35;
/** Between the caption above and the figures' heads, in points: the caption's baseline sits about 12 pt above them. */
const HEAD_ROOM = 6;

/**
 * The body's edge in light, in points as it shows: half the contour's
 * stroke shows outside the body, so the near-white body stands off the
 * chalk page. In dark the contour is set in figure units,
 * wider (and its tone lighter, in muscleTones), so the edge still reads there.
 */
const BODY_EDGE = 1;
const DARK_CONTOUR = 2.8;
/**
 * The graphite outline that marks a muscle under way, in points as it shows:
 * drawn inside the muscle only, so it never spills onto a neighbour or past
 * the body. Graphite, not ink, so the light fill reads at 3:1 or more on the
 * body and stays quieter than a muscle whose planned sets are done.
 */
const UNDER_WAY_OUTLINE = 1.25;
/** The key sits in from the figure's edge as far as the caption above it does (Progress's caption). */
const KEY_INSET = 6;

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
    // Each muscle as one shape, for the outline while under way: its outer edge, and its pieces to keep the outline inside.
    muscles: [...MUSCLE_EDGES[side]].map(([muscle, edge]) => ({
      muscle,
      edge: edge.map((cubic) => pathOf([cubic], dx, false)).join(''),
      pieces: REGIONS[side].filter((region) => region.muscle === muscle).map((region) => pathOf(region.cubics, dx)),
    })),
  };
});

/** Muscles chest to calves, the order VoiceOver steps through them. */
const DRAWN: string[] = ['chest', 'core', 'traps', 'back', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'glutes', 'quads', 'hamstrings', 'calves'];
const drawnPlace = (muscle: string) => {
  const index = DRAWN.indexOf(muscle);
  return index < 0 ? DRAWN.length : index;
};

const isChosen = (selected: string | null, muscle: MuscleGroup) => selected === muscle;

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
 * The week's progress on a flat front and back muscle figure: the bare body
 * where nothing is done yet, a light fill held by a graphite outline while a
 * muscle is under way, and the `mark` fill once its planned sets are done
 * (with no plan, once it is trained). Never red: going past the plan is still
 * done. The pair fills about 70% of Progress's card across. Front and Back are
 * named just under their figures, with the key close under them, on the card
 * title's left edge. The shading is the shared `src/lib/maquette.ts`; the
 * drawing is the app's own (`lib/anatomy.ts`).
 * Tap a muscle to choose it (a near miss counts; small ones like the side
 * delts reach a fingertip); the others quiet down. Tapping it again, or away
 * from every muscle, clears it. For VoiceOver the figure is one adjustable
 * element: swiping up and down steps through `muscles` (the rows of the list
 * below it), and down past the first clears the choice.
 */
export function MuscleFigure({ done, planned, muscles, selected, onPick, height = 204 }: {
  /** Sets done this week per muscle. */
  done: ReadonlyMap<string, number>;
  /** Sets planned this week per muscle; null with no plan. */
  planned: ReadonlyMap<string, number> | null;
  /** The muscles VoiceOver steps through: the list's rows. */
  muscles: readonly string[];
  selected: string | null;
  onPick: (muscle: string | null) => void;
  height?: number;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const dark = useColorScheme() === 'dark';
  const contrast = useIncreaseContrast();
  const shades = useMemo(() => shadeMuscles(done, planned), [done, planned]);
  const tones = muscleTonesFor(dark, contrast);
  const palette = useMemo<Record<MuscleProgressState, Rgb>>(
    () => ({
      untouched: parseColor(tones.body, [0.96, 0.96, 0.95]),
      under_way: parseColor(tones.below, [0.89, 0.89, 0.86]),
      done: parseColor(c.mark, [0.53, 0.53, 0.5]),
    }),
    [tones, c.mark],
  );
  const underWayEdge = useMemo(() => parseColor(c.graphite, [0.4, 0.4, 0.37]), [c.graphite]);
  const body = tones.body;
  const seam = dark ? DARK_SEAM : SEAM;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const stateOf = (muscle: MuscleGroup): MuscleProgressState => shades.get(muscle)?.state ?? 'untouched';

  const pick = (x: number, y: number) => {
    const muscle = muscleAt(x, y, size.width, size.height);
    if (muscle) onPick(isChosen(selected, muscle) ? null : muscle);
    else if (selected !== null) onPick(null);
  };

  const choices = useMemo(() => [...muscles].sort((a, b) => drawnPlace(a) - drawnPlace(b)), [muscles]);
  const step = (direction: 1 | -1) => {
    const next = (selected ? choices.indexOf(selected) : -1) + direction;
    if (next >= -1 && next < choices.length) onPick(next === -1 ? null : choices[next]);
  };
  const plannedFor = (muscle: string) => (planned ? planned.get(muscle) ?? 0 : null);
  const spokenValue = selected
    ? `${muscleLabel(selected)}, ${doneOfPlanned(done.get(selected) ?? 0, plannedFor(selected))}`
    : 'None chosen';

  const colorOf = (muscle: MuscleGroup) => {
    const state = stateOf(muscle);
    const chosen = isChosen(selected, muscle);
    // The others quiet down toward the bare body, so the chosen one leads.
    if (selected !== null && !chosen) return rgbToCss(mixRgb(palette[state], palette.untouched, 0.72));
    // A chosen muscle with nothing this week still shows where it is.
    if (chosen && state === 'untouched') return rgbToCss(mixRgb(palette.untouched, palette.done, 0.3));
    return rgbToCss(palette[state]);
  };
  // Under way also draws its outline, quieted with the rest while another muscle is chosen.
  const outlineOf = (muscle: MuscleGroup) => {
    if (stateOf(muscle) !== 'under_way') return null;
    return rgbToCss(selected !== null && !isChosen(selected, muscle) ? mixRgb(underWayEdge, palette.untouched, 0.72) : underWayEdge);
  };
  // Untouched and not chosen: drawn as the body itself.
  const bare = (muscle: MuscleGroup) => stateOf(muscle) === 'untouched' && !isChosen(selected, muscle);
  // The key: one swatch for each state a trained muscle takes. With no plan, trained is all there is.
  const key: Array<{ label: string; swatch: string; edge?: string }> = planned
    ? [
      { label: 'Under way', swatch: rgbToCss(palette.under_way), edge: rgbToCss(underWayEdge) },
      { label: 'Done', swatch: rgbToCss(palette.done) },
    ]
    : [{ label: 'Trained', swatch: rgbToCss(palette.done) }];
  const placed = size.width > 0 ? fit(size.width, size.height) : null;
  const scale = placed?.scale ?? height / BOX.height;
  // The outline is stroked on the muscle's outer edge at twice its width and
  // clipped to the muscle, so only its inner half shows; the seam in the
  // card's colour then takes half a seam of it, which the width makes up.
  const outlineWidth = 2 * (UNDER_WAY_OUTLINE / scale + seam / 2);
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
                  <ClipPath key={`${view.side}-${group.muscle}`} id={`under-way-${view.side}-${group.muscle}`}>
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
                    clipPath={`url(#under-way-${view.side}-${group.muscle})`}
                  />
                ) : null;
              })}
              <G clipPath={`url(#figure-${view.side})`}>
                {view.regions.map((region, i) =>
                  bare(region.muscle) ? null : (
                    <Path key={`s${i}`} d={region.seams} fill="none" stroke={c.ground} strokeWidth={seam} strokeLinecap="round" strokeLinejoin="round" />
                  ),
                )}
              </G>
            </G>
          ))}
        </Svg>
      </Pressable>
      {/* Front and Back, centred just under their figures. */}
      <View style={{ flexDirection: 'row', paddingLeft: placed?.left ?? 0 }}>
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
      {/*
        What the shades mean, left-aligned with the card's title as every chart key is.
        Inside the one adjustable element, so VoiceOver reads the rows below instead.
      */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: large ? 6 : 4, paddingHorizontal: KEY_INSET }}>
        {key.map((item) => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2.5,
                borderCurve: 'continuous',
                backgroundColor: item.swatch,
                ...(item.edge ? { borderWidth: UNDER_WAY_OUTLINE, borderColor: item.edge } : null),
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
