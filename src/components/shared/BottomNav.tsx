import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { useAppStore } from '@/stores/appStore';
import { useNativeGlassNavigation } from '@/hooks/useNativeGlassNavigation';
import { nativeTabForPath, type NativeTab } from '@/lib/nativeGlassNavigation';
import { useLitSurface } from '@/hooks/useLitSurface';
import { DumbbellGlyph, HomeGlyph, LeafGlyph, PersonGlyph, type TabIconProps } from './TabIcons';

// The selected tab comes from the same mapping the native bar uses, so the
// web fallback and iOS always agree on where a screen lives.
// The selected tab takes its glyph's filled variant.
const navItems: { to: string; icon: (props: TabIconProps) => ReactElement; label: string; tab: NativeTab }[] = [
  { to: '/', icon: HomeGlyph, label: 'Today', tab: 'today' },
  { to: '/train', icon: DumbbellGlyph, label: 'Train', tab: 'train' },
  { to: '/nutrition', icon: LeafGlyph, label: 'Fuel', tab: 'fuel' },
  { to: '/settings', icon: PersonGlyph, label: 'You', tab: 'you' },
];

export function BottomNav() {
  const location = useLocation();
  const hasActiveWorkout = useAppStore((state) => Boolean(state.currentWorkout && !state.currentWorkout.completed));
  // chromeless full-screen routes: in-session training and the live run tracker
  const isSessionRoute =
    location.pathname.startsWith('/train/session') || location.pathname.startsWith('/train/run') ||
    (hasActiveWorkout && ['/train', '/workout'].includes(location.pathname));
  const nativeNavigation = useNativeGlassNavigation(location.pathname, !isSessionRoute);
  const litRef = useLitSurface<HTMLElement>();

  if (isSessionRoute || nativeNavigation) {
    return null;
  }

  const selectedTab = nativeTabForPath(location.pathname);

  return (
    <>
    {/* Bottom scroll edge: content dissolves before it reaches the bar. */}
    <div className="bottom-nav-edge" aria-hidden>
      <span className="bottom-nav-edge-blur" data-layer="1" />
      <span className="bottom-nav-edge-blur" data-layer="2" />
      <span className="bottom-nav-edge-blur" data-layer="3" />
      <span className="bottom-nav-edge-veil" />
    </div>
    <motion.nav
      ref={litRef}
      aria-label="Main navigation"
      className="bottom-nav"
      initial={false}
      transition={springs.settle}
    >
      <div className="relative z-10 max-w-lg mx-auto grid grid-cols-4">
        {navItems.map(({ to, icon: Icon, label, tab }) => {
          const isActive = tab === selectedTab;

          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-col items-center justify-center h-[62px]"
              onClick={() => {
                if (!isActive) tapHaptic();
              }}
            >
              {isActive && (
                <motion.span
                  layoutId="material-nav-selection"
                  className="material-nav-selection pointer-events-none absolute inset-x-0 inset-y-[5px] rounded-[var(--radius-capsule)]"
                  transition={springs.tactile}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.9 }}
                animate={{ scale: isActive ? 1.04 : 1 }}
                transition={springs.tactile}
                className="relative flex flex-col items-center gap-[3px]"
              >
                <Icon
                  filled={isActive}
                  className={`w-6 h-6 transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--material-nav-muted)]'
                  }`}
                />
                <span
                  className={`text-[10.5px] font-semibold leading-none tracking-[0.005em] [font-family:var(--font-sans)] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--material-nav-muted)]'
                  }`}
                >
                  {label}
                </span>
              </motion.span>
            </Link>
          );
        })}
      </div>
    </motion.nav>
    </>
  );
}
