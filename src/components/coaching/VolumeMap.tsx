import { useId, useMemo, useState, type ReactNode } from 'react';
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

/** Steps of the legend ramp, lightest to heaviest (under MEV is drawn hollow). */
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
 * keep the body's tone and read only by their seams; trained ones deepen in
 * ink by volume status, muscles still under MEV are drawn hollow (an ink
 * outline, like the ○ status glyph), and only muscles past recoverable
 * volume turn lacquer.
 */
export function VolumeMap({ volume, variant = 'full', focus = null, onSelectMuscle, className = '' }: VolumeMapProps) {
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  const intro = useFirstReveal(`volume-map-${variant}`);

  if (variant === 'compact') {
    const side = focus ? primarySide(focus) : 'front';
    return (
      <div className={className} aria-hidden>
        <Figure side={side} shades={shades} intro={intro} subject={focus} line={COMPACT_LINE} seam={COMPACT_SEAM} />
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
            <Figure side={side} shades={shades} selected={selected} onPick={choose} intro={intro} line={LINE} seam={SEAM} className="h-[264px] w-auto" />
          </figure>
        ))}
      </div>

      {/* The rows' own glyphs and words (a ring for under, a dot in range,
          lacquer only past the ceiling), then the shading ramp on its own
          line: it is a scale, not a status. */}
      <div className="flex flex-col items-center gap-2 mt-5 t-caption" aria-hidden>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ boxShadow: `inset 0 0 0 ${LINE}px ${HOLLOW_INK}` }} />
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

/** The drawing's line weight, in screen pixels at any size: the hollow
 *  outline and, in Ivory, the seam (a gap in the page colour) around and
 *  between muscles. Two-thirds of it on Today's small figure. */
const LINE = 1.5;
const COMPACT_LINE = 1;
/** The seam: the line weight, or Black's thinner `--map-seam` hairline, so a
 *  gap of true black never reads as a keyline round a lighter fill. */
const SEAM = `var(--map-seam, ${LINE}px)`;
/** Today's small figure already draws its seam at the hairline. */
const COMPACT_SEAM = `${COMPACT_LINE}px`;
/** Body tone between the seam and a hollow muscle's inset outline. */
const HOLLOW_INSET = 1;
/** The hollow outline's ink, shared with the legend ring (70% in Black). */
const HOLLOW_INK = 'var(--map-hollow-ink, var(--color-text))';
/** The silhouette's tone: a theme token, so dark mode can lift it. */
const BODY_TONE = `var(--map-body, ${inkFill(BODY_INK)})`;
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
  line,
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
  /** Hollow outline weight in screen pixels. */
  line: number;
  /** Seam weight, a CSS length in screen pixels. */
  seam: string;
  className?: string;
}) {
  // React's ids carry characters a url(#…) reference would need escaped.
  const uid = `vm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const regions = MAP_REGIONS.filter((region) => region.side === side);
  // Every muscle keeps the tone of its own status (lacquer only past MRV), so
  // the figure never contradicts the legend. Illustrating one sentence, only
  // its subject is drawn.
  const bodyFill = inkFill(BODY_INK);
  const tone = (fill: string) => (fill === bodyFill ? BODY_TONE : fill.startsWith('color-mix') ? mapInk(fill) : fill);
  const fillFor = (muscle: MuscleGroup) => tone(subject
    ? subjectFill(shades.get(muscle), isSubjectMuscle(muscle, subject))
    : muscleFill(shades.get(muscle)));
  // Under MEV reads hollow: the body's tone inside an inset ink outline of
  // the same weight as the seams, clipped to the region so it never spills
  // over a seam.
  // Beside a sentence, its muscle uses the same hollow when the sentence is
  // about under-stimulation.
  const hollow = (muscle: MuscleGroup) => subject
    ? isSubjectMuscle(muscle, subject) && isSubjectUnder(shades.get(muscle))
    : isUnderStimulated(shades.get(muscle));
  const clipId = (index: number) => `${uid}-${side}-${index}`;
  // Every stroke keeps its pixel weight whatever the figure's size.
  const seam = {
    stroke: 'var(--color-base)',
    strokeLinejoin: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  // Stroke widths are CSS (style), so the theme's seam token can apply.
  const width = (extra: number) => ({ strokeWidth: `calc(${seamWidth} + ${2 * extra}px)` });
  const mirrored = (mirror: boolean, content: ReactNode) => (
    <g transform={mirror ? 'scale(-1 1)' : undefined}>{content}</g>
  );
  // A hairline of the same tone closes the seam where the halves meet.
  const body = BODY_PATHS.map((d, index) => (
    <path key={`b${index}`} d={d} fill={BODY_TONE} stroke={BODY_TONE} strokeWidth={0.4} />
  ));
  const muscles = regions.map((region, index) => {
    const dimmed = selected !== null && selected !== region.muscle;
    const isHollow = hollow(region.muscle);
    return (
      <motion.g
        key={`m${index}`}
        initial={intro ? { opacity: 0 } : false}
        animate={{ opacity: dimmed ? 0.4 : 1 }}
        transition={intro ? { duration: 0.5, delay: 0.1 + index * 0.025 } : { duration: 0.18 }}
        style={{ cursor: onPick ? 'pointer' : undefined }}
        onClick={onPick ? () => onPick(region.muscle) : undefined}
      >
        <path d={region.d} {...seam} style={{ ...width(0), fill: isHollow ? BODY_TONE : fillFor(region.muscle) }} />
        {isHollow && (
          // Clipped to the region, each stroke shows half its width inside:
          // seam, then body tone, then the ink line, then the body again.
          <g clipPath={`url(#${clipId(index)})`} fill="none">
            <path d={region.d} {...seam} stroke={HOLLOW_INK} style={width(HOLLOW_INSET + line)} />
            <path d={region.d} {...seam} stroke={BODY_TONE} style={width(HOLLOW_INSET)} />
            <path d={region.d} {...seam} style={width(0)} />
          </g>
        )}
      </motion.g>
    );
  });
  const clips = regions.map((region, index) => hollow(region.muscle) && (
    <clipPath key={`c${index}`} id={clipId(index)}>
      <path d={region.d} />
    </clipPath>
  ));

  return (
    <svg className={className} viewBox="-46 0 92 220" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>{clips}</defs>
      {mirrored(false, body)}
      {mirrored(true, body)}
      {mirrored(false, muscles)}
      {mirrored(true, muscles)}
    </svg>
  );
}
