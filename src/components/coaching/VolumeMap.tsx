import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';
import {
  BODY_INK,
  BODY_PATHS,
  MAP_REGIONS,
  inkFill,
  muscleFill,
  primarySide,
  shadeMuscles,
  STATUS_INK,
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

/** Steps of the legend ramp, lightest to heaviest. */
const LEGEND_RAMP = [STATUS_INK.below_mev, STATUS_INK.mev_mav, STATUS_INK.mav, STATUS_INK.approaching_mrv];

interface VolumeMapProps {
  volume: MuscleVolume[];
  /** Full: front and back with readout and legend. Compact: one still view. */
  variant?: 'full' | 'compact';
  /** Compact: the muscle in question; the figure turns to the side that
   *  shows it, toned exactly like the full map. */
  focus?: MuscleGroup | null;
  onSelectMuscle?: (muscle: MuscleGroup | null) => void;
  className?: string;
}

/**
 * This week's volume as a flat, engraved front/back figure. Untrained muscles
 * keep the body's tone and read only by their seams; trained ones deepen in
 * ink by volume status, and only muscles past recoverable volume turn lacquer.
 */
export function VolumeMap({ volume, variant = 'full', focus = null, onSelectMuscle, className = '' }: VolumeMapProps) {
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  const intro = useFirstReveal(`volume-map-${variant}`);

  if (variant === 'compact') {
    const side = focus ? primarySide(focus) : 'front';
    return (
      <div className={className} aria-hidden>
        <Figure side={side} shades={shades} intro={intro} />
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
              <span>{trained.length} {trained.length === 1 ? 'muscle' : 'muscles'} trained</span>
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

      <div className="flex items-center justify-center gap-5 mt-5 t-caption" aria-hidden>
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

function Figure({
  side,
  shades,
  selected = null,
  onPick,
  intro,
  className = 'w-full h-full',
}: {
  side: ViewSide;
  shades: Map<MuscleGroup, MuscleShade>;
  /** The tapped muscle: the others recede. */
  selected?: MuscleGroup | null;
  onPick?: (muscle: MuscleGroup) => void;
  intro: boolean;
  className?: string;
}) {
  const regions = MAP_REGIONS.filter((region) => region.side === side);
  // Every muscle keeps the tone of its own status (lacquer only past MRV), so
  // the figure never contradicts the legend; no outlines.
  const fillFor = (muscle: MuscleGroup) => muscleFill(shades.get(muscle));
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
    return (
      <motion.path
        key={`m${index}`}
        d={region.d}
        stroke="var(--color-base)"
        strokeWidth={SEAM}
        strokeLinejoin="round"
        initial={intro ? { opacity: 0 } : false}
        animate={{ opacity: dimmed ? 0.4 : 1 }}
        transition={intro ? { duration: 0.5, delay: 0.1 + index * 0.025 } : { duration: 0.18 }}
        style={{ fill: fillFor(region.muscle), cursor: onPick ? 'pointer' : undefined }}
        onClick={onPick ? () => onPick(region.muscle) : undefined}
      />
    );
  });

  return (
    <svg className={className} viewBox="-46 0 92 220" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {mirrored(false, body)}
      {mirrored(true, body)}
      {mirrored(false, muscles)}
      {mirrored(true, muscles)}
    </svg>
  );
}
