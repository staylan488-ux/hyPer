import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Leaf, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

const navItems = [
  { to: '/', icon: Home, label: 'Today', matchPaths: ['/'] },
  { to: '/train', icon: Dumbbell, label: 'Train', matchPaths: ['/train', '/workout', '/splits'] },
  { to: '/nutrition', icon: Leaf, label: 'Fuel', matchPaths: ['/nutrition'] },
  { to: '/settings', icon: User, label: 'You', matchPaths: ['/settings', '/history', '/analysis'] },
];

export function BottomNav() {
  const location = useLocation();
  // chromeless full-screen routes: in-session training and the live run tracker
  const isSessionRoute =
    location.pathname.startsWith('/train/session') || location.pathname.startsWith('/train/run');

  if (isSessionRoute) {
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
      className="fixed bottom-0 left-0 right-0 z-40 isolate overflow-hidden border-t border-[var(--color-border-strong)]"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        backgroundColor: 'var(--color-base)',
      }}
      initial={{ y: 90 }}
      animate={{ y: 0 }}
      transition={springs.smooth}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-[var(--color-base)]" />
      <div className="relative z-10 max-w-lg mx-auto grid grid-cols-4 bg-[var(--color-base)]">
        {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
          const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className="relative flex flex-col items-center justify-center gap-1.5 h-[62px]"
              onClick={() => {
                if (!isActive) tapHaptic();
              }}
            >
              {/* lacquer tick over the active station — the one accent */}
              {isActive && (
                <motion.span
                  layoutId="nav-tick"
                  className="absolute top-0 w-7 h-[2px] bg-[var(--color-accent)]"
                  transition={springs.smooth}
                />
              )}
              <motion.span
                whileTap={{ scale: 0.9 }}
                animate={{ y: isActive ? -1 : 0, scale: isActive ? 1.04 : 1 }}
                transition={springs.snappy}
                className="flex flex-col items-center gap-1.5"
              >
                <Icon
                  className={`w-[19px] h-[19px] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                  strokeWidth={1.5}
                />
                <span
                  className={`text-[9px] font-medium uppercase tracking-[0.2em] [font-family:var(--font-sans)] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
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
