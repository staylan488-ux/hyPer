import { Link, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Leaf, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { useAppStore } from '@/stores/appStore';
import { useNativeGlassNavigation } from '@/hooks/useNativeGlassNavigation';
import { nativeTabForPath, type NativeTab } from '@/lib/nativeGlassNavigation';
import { useLitSurface } from '@/hooks/useLitSurface';

// The selected tab comes from the same mapping the native bar uses, so the
// web fallback and iOS always agree on where a screen lives.
const navItems: { to: string; icon: typeof Home; label: string; tab: NativeTab }[] = [
  { to: '/', icon: Home, label: 'Today', tab: 'today' },
  { to: '/train', icon: Dumbbell, label: 'Train', tab: 'train' },
  { to: '/nutrition', icon: Leaf, label: 'Fuel', tab: 'fuel' },
  { to: '/settings', icon: User, label: 'You', tab: 'you' },
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
    <div className="bottom-nav-edge" aria-hidden />
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
              className="relative flex flex-col items-center justify-center h-[60px]"
              onClick={() => {
                if (!isActive) tapHaptic();
              }}
            >
              {isActive && (
                <motion.span
                  layoutId="material-nav-selection"
                  className="material-nav-selection pointer-events-none absolute inset-x-0.5 inset-y-1 rounded-[var(--radius-capsule)]"
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
                  className={`w-6 h-6 transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--material-nav-muted)]'
                  }`}
                  strokeWidth={1.6}
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
