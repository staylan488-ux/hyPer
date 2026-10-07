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
  below_mev: 'under-stimulated',
  mev_mav: 'effective',
  mav: 'adaptive zone',
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
        <Figure side={side} shades={shades} intro={intro} subject={focus} />
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
          <figure key={side} className="m-0 flex flex-col items-center">
            <Figure side={side} shades={shades} selected={selected} onPick={choose} intro={intro} className="h-[264px] w-auto" />
            <figcaption className="t-caption mt-3">{side === 'front' ? 'Front' : 'Back'}</figcaption>
          </figure>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-5 t-caption" aria-hidden>
        <span className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-[2px]"
            style={{ background: inkFill(BODY_INK), boxShadow: 'inset 0 0 0 1.25px var(--color-text)' }}
          />
          Under
        </span>
        <span className="flex items-center gap-2">
          <span className="flex gap-[2px]">
            {LEGEND_RAMP.map((ink) => (
              <span key={ink} className="w-2.5 h-2.5 rounded-[2px]" style={{ background: inkFill(ink) }} />
            ))}
          </span>
          Fewer to more sets
        </span>
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-[2px] bg-[var(--color-accent)]" />
          Over ceiling
        </span>
      </div>
    </div>
  );
}

/** Seam between engraved regions, in figure units. */
const SEAM = 0.7;
/** Hollow outline: half of it shows inside the region (about 1.3px on the
 *  264px Progress figure). */
const HOLLOW = 2.2;

function Figure({
  side,
  shades,
  selected = null,
  onPick,
  intro,
  subject = null,
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
  className?: string;
}) {
  // React's ids carry characters a url(#…) reference would need escaped.
  const uid = `vm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const regions = MAP_REGIONS.filter((region) => region.side === side);
  // Every muscle keeps the tone of its own status (lacquer only past MRV), so
  // the figure never contradicts the legend. Illustrating one sentence, only
  // its subject is drawn.
  const fillFor = (muscle: MuscleGroup) => subject
    ? subjectFill(shades.get(muscle), isSubjectMuscle(muscle, subject))
    : muscleFill(shades.get(muscle));
  // Under MEV reads hollow: the body's tone inside an ink outline that is
  // clipped to the region, so it never spills over a seam.
  const hollow = (muscle: MuscleGroup) => !subject && isUnderStimulated(shades.get(muscle));
  const clipId = (index: number) => `${uid}-${side}-${index}`;
  const bodyFill = inkFill(BODY_INK);
  const mirrored = (mirror: boolean, content: ReactNode) => (
    <g transform={mirror ? 'scale(-1 1)' : undefined}>{content}</g>
  );
  // A hairline of the same tone closes the seam where the halves meet.
  const body = BODY_PATHS.map((d, index) => (
    <path key={`b${index}`} d={d} fill={bodyFill} stroke={bodyFill} strokeWidth={0.4} />
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
        <path
          d={region.d}
          stroke="var(--color-base)"
          strokeWidth={SEAM}
          strokeLinejoin="round"
          style={{ fill: isHollow ? bodyFill : fillFor(region.muscle) }}
        />
        {isHollow && (
          <path
            d={region.d}
            fill="none"
            stroke="var(--color-text)"
            strokeWidth={HOLLOW}
            strokeLinejoin="round"
            clipPath={`url(#${clipId(index)})`}
          />
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
