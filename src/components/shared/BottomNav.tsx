import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Leaf, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { useAppStore } from '@/stores/appStore';
import { useNativeGlassNavigation } from '@/hooks/useNativeGlassNavigation';
import { useLitSurface } from '@/hooks/useLitSurface';

const navItems = [
  { to: '/', icon: Home, label: 'Today', matchPaths: ['/', '/analysis'] },
  { to: '/train', icon: Dumbbell, label: 'Train', matchPaths: ['/train', '/workout', '/splits', '/history'] },
  { to: '/nutrition', icon: Leaf, label: 'Fuel', matchPaths: ['/nutrition'] },
  { to: '/settings', icon: User, label: 'You', matchPaths: ['/settings'] },
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

  const isPathMatch = (pathname: string, target: string) => {
    if (target === '/') {
      return pathname === '/';
    }

    return pathname === target || pathname.startsWith(`${target}/`);
  };

  return (
    <motion.nav
      ref={litRef}
      aria-label="Main navigation"
      className="bottom-nav metal-nav"
      initial={false}
      transition={springs.settle}
    >
      <div className="relative z-10 max-w-lg mx-auto grid grid-cols-4">
        {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
          const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className={`metal-nav-item${isActive ? ' is-active' : ''}`}
              onClick={() => {
                if (!isActive) tapHaptic();
              }}
            >
              <motion.span
                whileTap={{ scale: 0.9 }}
                transition={springs.tactile}
                className="relative flex flex-col items-center gap-[3px] transition-colors duration-200"
              >
                <Icon strokeWidth={1.5} aria-hidden />
                <span className="metal-nav-label">{label}</span>
              </motion.span>
              {isActive && <span className="metal-nav-dot" aria-hidden />}
            </NavLink>
          );
        })}
      </div>
    </motion.nav>
  );
}
