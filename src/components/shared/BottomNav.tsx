import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Leaf, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { useAppStore } from '@/stores/appStore';
import { useNativeGlassNavigation } from '@/hooks/useNativeGlassNavigation';

const navItems = [
  { to: '/', icon: Home, label: 'Today', matchPaths: ['/'] },
  { to: '/train', icon: Dumbbell, label: 'Train', matchPaths: ['/train', '/workout', '/splits'] },
  { to: '/nutrition', icon: Leaf, label: 'Fuel', matchPaths: ['/nutrition'] },
  { to: '/settings', icon: User, label: 'You', matchPaths: ['/settings', '/history', '/analysis'] },
];

export function BottomNav() {
  const location = useLocation();
  const hasActiveWorkout = useAppStore((state) => Boolean(state.currentWorkout && !state.currentWorkout.completed));
  // chromeless full-screen routes: in-session training and the live run tracker
  const isSessionRoute =
    location.pathname.startsWith('/train/session') || location.pathname.startsWith('/train/run') ||
    (hasActiveWorkout && ['/train', '/workout'].includes(location.pathname));
  const nativeNavigation = useNativeGlassNavigation(location.pathname, !isSessionRoute);

  if (isSessionRoute || nativeNavigation) {
    return null;
  }

  const isPathMatch = (pathname: string, target: string) => {
    if (target === '/') {
      return pathname === '/';
    }

    return pathname === target || pathname.startsWith(`${target}/`);
  };

  return (
    <motion.nav
      aria-label="Main navigation"
      className="bottom-nav"
      initial={false}
      transition={springs.smooth}
    >
      <div className="relative z-10 max-w-lg mx-auto grid grid-cols-4">
        {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
          const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className="relative flex flex-col items-center justify-center gap-1.5 h-[68px]"
              onClick={() => {
                if (!isActive) tapHaptic();
              }}
            >
              {isActive && (
                <motion.span
                  layoutId="material-nav-selection"
                  className="material-nav-selection pointer-events-none absolute inset-x-1 inset-y-1.5 rounded-[16px]"
                  transition={springs.snappy}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.9 }}
                animate={{ scale: isActive ? 1.04 : 1 }}
                transition={springs.snappy}
                className="relative flex flex-col items-center gap-1.5"
              >
                <Icon
                  className={`w-[19px] h-[19px] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--material-nav-muted)]'
                  }`}
                  strokeWidth={1.5}
                />
                <span
                  className={`text-[11px] font-medium uppercase tracking-[0.12em] [font-family:var(--font-sans)] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--material-nav-muted)]'
                  }`}
                >
                  {label}
                </span>
              </motion.span>
            </NavLink>
          );
        })}
      </div>
    </motion.nav>
  );
}
