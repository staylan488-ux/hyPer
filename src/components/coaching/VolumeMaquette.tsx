import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal, useMotionPolicy } from '@/lib/motionPolicy';
import {
  BODY_SOLIDS,
  MUSCLE_PARTS,
  latheOutline,
  mixRgb,
  muscleColor,
  parseColor,
  projectX,
  rgbToCss,
  shadeMuscles,
  visibleFrom,
  type MaquettePalette,
  type MuscleShade,
  type Solid,
  type ViewSide,
} from '@/lib/maquette';
import { useThemeStore } from '@/stores/themeStore';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type MuscleVolume } from '@/types';
import type { MaquetteController } from '@/components/three/maquetteScene';

const STATUS_WORDS: Record<MuscleVolume['status'], string> = {
  below_mev: 'under-stimulated',
  mev_mav: 'effective',
  mav: 'adaptive zone',
  approaching_mrv: 'near ceiling',
  above_mrv: 'over ceiling',
};

function readPalette(dark: boolean): MaquettePalette {
  const styles = getComputedStyle(document.documentElement);
  const base = parseColor(styles.getPropertyValue('--color-base'), dark ? [0, 0, 0] : [0.96, 0.96, 0.94]);
  const ink = parseColor(styles.getPropertyValue('--color-text'), dark ? [0.95, 0.95, 0.95] : [0.14, 0.15, 0.15]);
  const accent = parseColor(styles.getPropertyValue('--color-accent'), [0.66, 0.21, 0.16]);
  return {
    // Porcelain on Ivory, obsidian on Black.
    body: mixRgb(base, ink, dark ? 0.13 : 0.075),
    ink,
    accent,
  };
}

interface VolumeMaquetteProps {
  volume: MuscleVolume[];
  /** Full: interactive, with readout and controls. Compact: a still figurine. */
  variant?: 'full' | 'compact';
  /** Compact: the muscle to emphasise. */
  focus?: MuscleGroup | null;
  onSelectMuscle?: (muscle: MuscleGroup | null) => void;
  className?: string;
}

/**
 * This week's volume on a sculpted figure. Rich devices get a lazily loaded
 * three.js maquette (drag to turn, tap a muscle); everyone else — and every
 * device until the scene is ready — sees the flat front/back drawing.
 */
export function VolumeMaquette({ volume, variant = 'full', focus = null, onSelectMuscle, className = '' }: VolumeMaquetteProps) {
  const policy = useMotionPolicy();
  const dark = useThemeStore((state) => state.theme) === 'dark';
  const shades = useMemo(() => shadeMuscles(volume), [volume]);
  const intro = useFirstReveal(`maquette-${variant}`);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MaquetteController | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<MuscleGroup | null>(null);
  const onSelectRef = useRef(onSelectMuscle);
  useEffect(() => {
    onSelectRef.current = onSelectMuscle;
  }, [onSelectMuscle]);

  const wants3d = policy.rich && !failed;
  const live = useRef({ shades, dark, focus });
  useEffect(() => {
    live.current = { shades, dark, focus };
  }, [shades, dark, focus]);

  // Load the scene when the figure approaches the viewport.
  useEffect(() => {
    if (!wants3d) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const start = () => {
      observer?.disconnect();
      import('@/components/three/maquetteScene')
        .then(({ createMaquette }) => {
          if (cancelled) return;
          const { shades: s, dark: d, focus: f } = live.current;
          controllerRef.current = createMaquette(canvas, {
            palette: readPalette(d),
            shades: s,
            dark: d,
            focus: f,
            intro,
            still: policy.reducedMotion,
            interactive: variant === 'full',
            onPick: (muscle) => {
              setSelected(muscle);
              onSelectRef.current?.(muscle);
            },
            onReady: () => {
              setReady(true);
              // The compact figurine turns to present its muscle.
              if (variant === 'compact' && live.current.focus) controllerRef.current?.select(live.current.focus);
            },
            onContextLost: () => {
              controllerRef.current?.dispose();
              controllerRef.current = null;
              setReady(false);
              setFailed(true);
            },
          });
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    if (typeof IntersectionObserver === 'undefined') {
      start();
    } else {
      observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) start();
      }, { rootMargin: '240px 0px' });
      observer.observe(wrap);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
    // intro/variant/reducedMotion are fixed for the life of the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants3d]);

  useEffect(() => {
    controllerRef.current?.update({ shades, dark, focus, palette: readPalette(dark) });
  }, [shades, dark, focus]);

  const trained = [...shades.values()].filter((shade) => shade.sets > 0);
  const selectedShade = selected ? shades.get(selected) : undefined;
  const choose = (muscle: MuscleGroup | null) => {
    setSelected(muscle);
    controllerRef.current?.select(muscle);
    onSelectMuscle?.(muscle);
  };

  if (variant === 'compact') {
    const focusPart = focus ? MUSCLE_PARTS.find((part) => part.muscle === focus) : undefined;
    const side: ViewSide = focusPart && !visibleFrom(focusPart.solid, 'front') ? 'back' : 'front';
    return (
      <div ref={wrapRef} className={`relative ${className}`} aria-hidden>
        <FlatFigure shades={shades} dark={dark} focus={focus} sides={[side]} hidden={ready} />
        {wants3d && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-500"
            style={{ opacity: ready ? 1 : 0 }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="min-h-[2.75rem] flex items-end pb-3" aria-live="polite">
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
              <span className="text-[var(--color-text-dim)]">{wants3d ? 'Drag to turn · tap a muscle' : 'Front and back'}</span>
              <span>{trained.length} {trained.length === 1 ? 'muscle' : 'muscles'} trained</span>
            </>
          )}
        </motion.p>
      </div>

      <div
        ref={wrapRef}
        className="relative h-[340px] select-none"
        role="img"
        aria-label={`Figure shaded by this week's volume. ${trained
          .map((shade) => `${MUSCLE_GROUP_LABELS[shade.muscle]} ${shade.sets} sets`)
          .join(', ') || 'No muscles trained yet'}.`}
        style={{ touchAction: 'pan-y' }}
      >
        <FlatFigure shades={shades} dark={dark} selected={selected} sides={['front', 'back']} hidden={ready} onPick={choose} />
        {wants3d && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full transition-opacity duration-500 cursor-grab active:cursor-grabbing"
            style={{ opacity: ready ? 1 : 0, touchAction: 'pan-y' }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mt-3">
        <span className="flex items-center gap-2.5 t-caption" aria-hidden>
          <Legend swatch="color-mix(in srgb, var(--color-text) 20%, var(--color-base))" label="Light" />
          <Legend swatch="color-mix(in srgb, var(--color-text) 84%, var(--color-base))" label="Heavy" />
          <Legend swatch="var(--color-accent)" label="Over" />
        </span>
        {ready && (
          <span className="flex items-center rounded-[var(--radius-capsule)] bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] shadow-[inset_0_1px_1px_color-mix(in_srgb,var(--color-text)_6%,transparent)]">
            <button type="button" className="pressable min-h-11 px-3.5 rounded-[var(--radius-capsule)] text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text)]" onClick={() => controllerRef.current?.turnTo('front')}>
              Front
            </button>
            <span aria-hidden className="w-px h-4 bg-[var(--color-border)]" />
            <button type="button" className="pressable min-h-11 px-3.5 rounded-[var(--radius-capsule)] text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text)]" onClick={() => controllerRef.current?.turnTo('back')}>
              Back
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full shadow-[inset_0_0_0_.5px_color-mix(in_srgb,var(--color-text)_18%,transparent)]" style={{ background: swatch }} />
      {label}
    </span>
  );
}

// ═══════════════════════════════════
// Flat drawing (fallback and placeholder)
// ═══════════════════════════════════

const VIEW = { top: 1.8, bottom: -1.66, half: 0.74 };

function solidShape(solid: Solid, side: ViewSide, fill: string, key: string, onClick?: () => void) {
  if (solid.kind === 'lathe') return <path key={key} d={latheOutline(solid)} fill={fill} />;
  if (solid.kind === 'ellipsoid') {
    const x = projectX(solid.center[0], side);
    const roll = solid.roll ? (side === 'front' ? -solid.roll : solid.roll) : 0;
    return (
      <ellipse
        key={key}
        cx={x}
        cy={-solid.center[1]}
        rx={solid.radii[0]}
        ry={solid.radii[1]}
        fill={fill}
        transform={roll ? `rotate(${(roll * 180) / Math.PI} ${x} ${-solid.center[1]})` : undefined}
        onClick={onClick}
        style={onClick ? { cursor: 'pointer' } : undefined}
      />
    );
  }
  return (
    <line
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

function FlatFigure({
  shades,
  dark,
  sides,
  hidden,
  focus = null,
  selected = null,
  onPick,
}: {
  shades: Map<MuscleGroup, MuscleShade>;
  dark: boolean;
  sides: ViewSide[];
  hidden: boolean;
  focus?: MuscleGroup | null;
  selected?: MuscleGroup | null;
  onPick?: (muscle: MuscleGroup | null) => void;
}) {
  // The theme class is applied before the store updates, so tokens are current.
  const palette = useMemo(() => readPalette(dark), [dark]);
  const bodyFill = rgbToCss(palette.body);
  const width = VIEW.half * 2;
  const gap = 0.25;
  const totalWidth = width * sides.length + gap * (sides.length - 1);

  return (
    <svg
      className="absolute inset-0 w-full h-full transition-opacity duration-500"
      style={{ opacity: hidden ? 0 : 1 }}
      viewBox={`${-VIEW.half} ${-VIEW.top} ${totalWidth} ${VIEW.top - VIEW.bottom}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {sides.map((side, index) => (
        <g key={side} transform={`translate(${index * (width + gap)} 0)`}>
          {BODY_SOLIDS.map((solid, i) => solidShape(solid, side, bodyFill, `b${i}`))}
          {MUSCLE_PARTS.filter((part) => visibleFrom(part.solid, side)).map((part, i) => {
            const shade = shades.get(part.muscle);
            let color = muscleColor(shade, palette);
            if (focus) color = focus === part.muscle ? palette.accent : mixRgb(color, palette.body, 0.85);
            const fill = selected === part.muscle ? rgbToCss(palette.accent) : rgbToCss(color);
            return solidShape(part.solid, side, fill, `m${i}`, onPick ? () => onPick(selected === part.muscle ? null : part.muscle) : undefined);
          })}
          {sides.length > 1 && <text
            x={0}
            y={VIEW.bottom * -1 - 0.02}
            textAnchor="middle"
            fontSize={0.11}
            fill="var(--color-text-dim)"
            style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            {side}
          </text>}
        </g>
      ))}
    </svg>
  );
}
