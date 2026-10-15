import { Fragment, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { readCommandCapsule, subscribeCommandCapsule, type CommandCapsuleSpec } from '@/lib/commandCapsule';
import { MetalRing } from './MetalRing';

/** Native and web tab bars: 68pt tall, plus the 8pt gap above them. */
const TAB_BAR_LIFT = 68 + 8;
const CAPSULE_HEIGHT = 70;
const GAP = 8;

/**
 * The single floating command capsule, rendered once by the app shell. It
 * shows the newest `useCommandCapsule` registration: content on the left,
 * the 56pt metal ring on the right. It docks above the tab bar (native glass
 * or web) or, on chromeless routes, at the bottom edge above the rest bar.
 * Open sheets and the keyboard hide it (metal.css); the brand intro's veil
 * covers it.
 */
export function CommandCapsule() {
  const spec = useSyncExternalStore(subscribeCommandCapsule, readCommandCapsule, () => null);
  const restHeight = useRestBarHeight();
  const dock = spec?.dock ?? 'tabbar';
  const lift = dock === 'tabbar' ? TAB_BAR_LIFT : restHeight > 0 ? restHeight + GAP : 0;
  const visible = spec !== null;

  // Screens add this to their bottom padding so the last row clears the capsule.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.style.setProperty('--metal-capsule-clearance', `${CAPSULE_HEIGHT + GAP}px`);
    return () => { root.style.removeProperty('--metal-capsule-clearance'); };
  }, [visible]);

  return (
    <AnimatePresence initial={false}>
      {spec && (
        <motion.div
          key="floor"
          className="metal-floor"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ height: `calc(var(--app-safe-bottom) + ${12 + lift + CAPSULE_HEIGHT + 34}px)` }}
        />
      )}
      {spec && (
        <motion.div
          key="capsule"
          className="metal-capsule-host"
          data-command-capsule
          initial={{ opacity: 0, y: 24 - lift }}
          animate={{ opacity: 1, y: -lift }}
          exit={{ opacity: 0, y: 24 - lift }}
          transition={springs.settle}
        >
          <CapsuleBody spec={spec} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CapsuleBody({ spec }: { spec: CommandCapsuleSpec }) {
  const press = () => {
    if (spec.disabled || spec.busy) return;
    tapHaptic();
    spec.onPress();
  };
  const layerKey = `${spec.values ? 'values' : 'label'}:${spec.key}`;

  return (
    <div className="metal-capsule" role="group" aria-label={spec.values ? spec.caption ?? spec.label : spec.label}>
      <AnimatePresence initial={false}>
        <motion.div
          key={layerKey}
          className={`metal-capsule-layer${spec.values ? ' is-values' : ''}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={{ ...springs.settle, delay: 0.06 }}
        >
          {spec.values ? <ValuesLayer spec={spec} /> : (
            <>
              <button type="button" className="metal-capsule-press" tabIndex={-1} aria-hidden onClick={press} />
              <span className="metal-capsule-c1">{spec.label}</span>
              {spec.sublabel && <span className={`metal-capsule-c2${spec.alert ? ' is-alert' : ''}`}>{spec.sublabel}</span>}
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {spec.progress != null && (
        <div className="metal-capsule-progress" aria-hidden>
          <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, spec.progress))})` }} />
        </div>
      )}
      <MetalRing
        glyph={spec.glyph}
        label={spec.ariaLabel ?? spec.label}
        onPress={press}
        disabled={spec.disabled}
        busy={spec.busy}
      />
    </div>
  );
}

function ValuesLayer({ spec }: { spec: CommandCapsuleSpec }) {
  return (
    <>
      {spec.caption && <span className={`metal-capsule-caption${spec.alert ? ' is-alert' : ''}`}>{spec.caption}</span>}
      <span className="metal-capsule-values">
        {spec.values!.map((value, index) => (
          <Fragment key={value.id}>
            {index > 0 && <span className="metal-capsule-dot" aria-hidden />}
            <button
              type="button"
              className={`metal-capsule-value${value.suggested ? ' is-suggested' : ''}`}
              aria-label={value.ariaLabel}
              onClick={() => { if (value.onPress) { tapHaptic(); value.onPress(); } }}
              disabled={!value.onPress}
            >
              {value.unitFirst && <span className="metal-capsule-value-unit">{value.unit}</span>}
              <span className="metal-num">{value.value}</span>
              {!value.unitFirst && <span className="metal-capsule-value-unit">{value.unit}</span>}
            </button>
          </Fragment>
        ))}
      </span>
    </>
  );
}

/** The rest bar (web or its native-dock stand-in) publishes its height. */
function useRestBarHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const value = parseFloat(root.style.getPropertyValue('--workout-rest-height'));
      setHeight(Number.isFinite(value) ? value : 0);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
  return height;
}
