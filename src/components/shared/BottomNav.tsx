import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, UtensilsCrossed, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

const navItems = [
  { to: '/', icon: Home, label: 'Home', matchPaths: ['/'] },
  { to: '/train', icon: Dumbbell, label: 'Train', matchPaths: ['/train', '/workout', '/splits'] },
  { to: '/nutrition', icon: UtensilsCrossed, label: 'Fuel', matchPaths: ['/nutrition'] },
  { to: '/settings', icon: User, label: 'You', matchPaths: ['/settings', '/history', '/analysis'] },
];

export function BottomNav() {
  const location = useLocation();
  const isSessionRoute = location.pathname.startsWith('/train/session');

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
      className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] backdrop-blur-md border-t border-[var(--color-border)] safe-area-inset-bottom"
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      transition={springs.smooth}
    >
      <div className="flex justify-around items-center h-20 max-w-lg mx-auto px-4 gap-1">
        {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
          const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

          return (
            <NavLink
              key={to}
              to={to}
              className="relative flex flex-col items-center justify-center py-2 px-4 rounded-[var(--radius-lg)] transition-colors duration-200 min-w-[68px]"
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0 bg-[var(--color-surface-high)] rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                  layoutId="nav-active-pill"
                  transition={springs.smooth}
                />
              )}
              <motion.div
                whileTap={{ scale: 0.85 }}
                transition={springs.snappy}
                className="relative z-10 flex flex-col items-center"
              >
                <Icon
                  className={`w-5 h-5 transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                  strokeWidth={1.5}
                />
                <span
                  className={`text-[9px] mt-1.5 tracking-[0.1em] uppercase transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                >
                  {label}
                </span>
              </motion.div>
            </NavLink>
          );
        })}
      </div>
    </motion.nav>
  );
}
