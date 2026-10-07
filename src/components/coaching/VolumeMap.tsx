import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';
import {
  BODY_INK,
  BODY_PATHS,
  MAP_REGIONS,
  inkFill,
  isSubjectMuscle,
  isSubjectUnder,
  isUnderStimulated,
  muscleFill,
  primarySide,
  shadeMuscles,
  STATUS_INK,
  subjectFill,
  type MuscleShade,
  type ViewSide,
} from '@/lib/volumeMap';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';

const STATUS_WORDS: Record<MuscleVolume['status'], string> = {
  below_mev: 'under',
  mev_mav: 'in range',
  mav: 'in range',
  approaching_mrv: 'near ceiling',
  above_mrv: 'over ceiling',
};

/** Steps of the legend ramp, lightest to heaviest (under MEV is the quieter
 *  under tone below them). */
const LEGEND_RAMP = [STATUS_INK.mev_mav, STATUS_INK.mav, STATUS_INK.approaching_mrv];

interface VolumeMapProps {
  volume: MuscleVolume[];
  /** Full: front and back with readout and legend. Compact: one still view. */
  variant?: 'full' | 'compact';
  /** Compact: the muscle the sentence beside it is about. The figure turns
   *  to the side that shows it and draws only that muscle (primary ink, or
   *  lacquer past MRV); every other muscle keeps the silhouette's tone. */
  focus?: MuscleGroup | null;
  onSelectMuscle?: (muscle: MuscleGroup | null) => void;
  className?: string;
}

/**
 * This week's volume as a flat, engraved front/back figure. Untrained muscles
 * keep the body's tone and read only by their seams; muscles still under MEV
 * take the quietest tone, one step past the body (trained a little, not
 * enough), and trained ones deepen in ink by volume status from there; only
 * muscles past recoverable volume turn lacquer. No outlines: shapes read by
 * tone and the seams between them.
 */
export function VolumeMap({ volume, variant = 'full', focus = null, onSelectMuscle, className = '' }: VolumeMapProps) {
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  const intro = useFirstReveal(`volume-map-${variant}`);

  if (variant === 'compact') {
    const side = focus ? primarySide(focus) : 'front';
    return (
      <div className={className} aria-hidden>
        <Figure side={side} shades={shades} intro={intro} subject={focus} seam={COMPACT_SEAM} />
      </div>
    );
  }

  const trained = [...shades.values()].filter((shade) => shade.sets > 0);
  const selectedShade = selected ? shades.get(selected) : undefined;
  const choose = (muscle: MuscleGroup) => {
    const next = selected === muscle ? null : muscle;
    setSelected(next);
    onSelectMuscle?.(next);
  };

  return (
    <div className={className}>
      <div className="min-h-[2.75rem] flex items-end pb-2" aria-live="polite">
        <motion.p
          key={selected ?? 'summary'}
          className="t-data-sm text-[var(--color-text)] w-full flex justify-between gap-3"
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.tactile}
        >
          {selectedShade ? (
            <>
              <span>{MUSCLE_GROUP_LABELS[selectedShade.muscle]}</span>
              <span className={selectedShade.hot ? 'text-[var(--color-accent)]' : ''}>
                {selectedShade.sets} {selectedShade.sets === 1 ? 'set' : 'sets'}
                {selectedShade.status && selectedShade.sets > 0 ? ` · ${STATUS_WORDS[selectedShade.status]}` : ' · not trained'}
              </span>
            </>
          ) : (
            <>
              <span className="text-[var(--color-text-dim)]">Tap a muscle</span>
              <span className="text-[var(--color-text-dim)]">{trained.length} {trained.length === 1 ? 'muscle' : 'muscles'} trained</span>
            </>
          )}
        </motion.p>
      </div>

      <div
        role="img"
        aria-label={`Front and back figure toned by this week's volume. ${trained
          .map((shade) => `${MUSCLE_GROUP_LABELS[shade.muscle]} ${shade.sets} ${shade.sets === 1 ? 'set' : 'sets'}${shade.status ? `, ${STATUS_WORDS[shade.status]}` : ''}`)
          .join('; ') || 'No muscles trained yet'}.`}
        className="grid grid-cols-2 gap-2 select-none"
      >
        {(['front', 'back'] as const).map((side) => (
          // No captions: the views read as front and back on their own, so the
          // figures' feet are their last ink and, 20px under them, the legend
          // can rest clear of the bar while the figures sit wholly under it.
          <figure key={side} className="m-0 flex flex-col items-center">
            <Figure side={side} shades={shades} selected={selected} onPick={choose} intro={intro} seam={SEAM} className="h-[264px] w-auto" />
          </figure>
        ))}
      </div>

      {/* The figure's own tones (the under tone, in range, lacquer only past
          the ceiling), then the shading ramp on its own line: it is a
          scale, not a status. */}
      <div className="flex flex-col items-center gap-2 mt-5 t-caption" aria-hidden>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: UNDER_TONE }} />
            Under
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-text-dim)]" />
            In range
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
            Over ceiling
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <span className="flex gap-[3px]">
            {LEGEND_RAMP.map((ink) => (
              <span key={ink} className="w-2 h-2 rounded-full" style={{ background: mapInk(inkFill(ink)) }} />
            ))}
          </span>
          Stronger tone = more sets
        </span>
      </div>
    </div>
  );
}

/** The seam, in screen pixels at any size: a gap in the page colour between
 *  muscles, 1.5px in Ivory, or Black's thinner `--map-seam` hairline, so a
 *  gap of true black never reads as a keyline round a lighter fill. */
const SEAM = 'var(--map-seam, 1.5px)';
/** Today's small figure draws its seam at the hairline. */
const COMPACT_SEAM = '1px';
/** The silhouette's tone: a theme token, so dark mode can lift it. */
const BODY_TONE = `var(--map-body, ${inkFill(BODY_INK)})`;
/** Under MEV: the quietest mark, one step past the body and below every
 *  in-range tone (`--map-under`), shared with the legend's swatch. */
const UNDER_TONE = `var(--map-under, ${inkFill(STATUS_INK.below_mev)})`;
/** A status ink as drawn: Black takes it a step toward the page
 *  (`--map-ink-drop`) so trained muscles stay tones, not stickers. */
const mapInk = (fill: string) => `color-mix(in srgb, ${fill}, var(--color-base) var(--map-ink-drop, 0%))`;

function Figure({
  side,
  shades,
  selected = null,
  onPick,
  intro,
  subject = null,
  seam: seamWidth,
  className = 'w-full h-full',
}: {
  side: ViewSide;
  shades: Map<MuscleGroup, MuscleShade>;
  /** Illustrate one sentence: only this muscle is drawn (see subjectFill). */
  subject?: MuscleGroup | null;
  /** The tapped muscle: the others recede. */
  selected?: MuscleGroup | null;
  onPick?: (muscle: MuscleGroup) => void;
  intro: boolean;
  /** Seam weight, a CSS length in screen pixels. */
  seam: string;
  className?: string;
}) {
  const regions = MAP_REGIONS.filter((region) => region.side === side);
  // Every muscle keeps the tone of its own status (lacquer only past MRV), so
  // the figure never contradicts the legend. Illustrating one sentence, only
  // its subject is drawn.
  const bodyFill = inkFill(BODY_INK);
  const tone = (fill: string) => (fill === bodyFill ? BODY_TONE : fill.startsWith('color-mix') ? mapInk(fill) : fill);
  const fillFor = (muscle: MuscleGroup) => tone(subject
    ? subjectFill(shades.get(muscle), isSubjectMuscle(muscle, subject))
    : muscleFill(shades.get(muscle)));
  // Under MEV takes the under tone, the legend's "Under". Beside a
  // sentence, its muscle does when the sentence is about under-stimulation.
  const under = (muscle: MuscleGroup) => subject
    ? isSubjectMuscle(muscle, subject) && isSubjectUnder(shades.get(muscle))
    : isUnderStimulated(shades.get(muscle));
  const mirrored = (mirror: boolean, content: ReactNode) => (
    <g transform={mirror ? 'scale(-1 1)' : undefined}>{content}</g>
  );
  // A hairline of the same tone closes the seam where the halves meet.
  const body = BODY_PATHS.map((d, index) => (
    <path key={`b${index}`} d={d} fill={BODY_TONE} stroke={BODY_TONE} strokeWidth={0.4} />
  ));
  // Fills only; the seams are drawn once, over all of them (below).
  const muscles = regions.map((region, index) => {
    const dimmed = selected !== null && selected !== region.muscle;
    return (
      <motion.path
        key={`m${index}`}
        d={region.d}
        initial={intro ? { opacity: 0 } : false}
        animate={{ opacity: dimmed ? 0.4 : 1 }}
        transition={intro ? { duration: 0.5, delay: 0.1 + index * 0.025 } : { duration: 0.18 }}
        style={{ fill: under(region.muscle) ? UNDER_TONE : fillFor(region.muscle), cursor: onPick ? 'pointer' : undefined }}
        onClick={onPick ? () => onPick(region.muscle) : undefined}
      />
    );
  });
  // Every seam in one path over every fill, so shared edges are drawn once
  // at one weight (no stipple where two regions' strokes overlapped), and
  // it keeps its pixel weight whatever the figure's size.
  const seams = (
    <path
      d={regions.map((region) => region.d).join(' ')}
      fill="none"
      stroke="var(--color-base)"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      style={{ strokeWidth: seamWidth }}
      pointerEvents="none"
    />
  );

  return (
    <svg className={className} viewBox="-46 0 92 220" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {mirrored(false, body)}
      {mirrored(true, body)}
      {mirrored(false, muscles)}
      {mirrored(true, muscles)}
      {mirrored(false, seams)}
      {mirrored(true, seams)}
    </svg>
  );
}
