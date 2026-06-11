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
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] safe-area-inset-bottom"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-base) 88%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      transition={springs.smooth}
    >
      <div className="flex items-stretch h-[64px] max-w-lg mx-auto px-3">
        {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
          const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

          return (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className="relative flex-1 flex flex-col items-center justify-center gap-1"
            >
              {/* calibration tick — slides between stations */}
              {isActive && (
                <motion.span
                  layoutId="nav-tick"
                  className="absolute top-0 w-7 h-[2.5px] rounded-b-full bg-[var(--color-accent)]"
                  transition={springs.smooth}
                />
              )}
              <motion.span whileTap={{ scale: 0.86 }} transition={springs.snappy} className="flex flex-col items-center gap-1">
                <Icon
                  className={`w-[21px] h-[21px] transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
                  }`}
                  strokeWidth={isActive ? 2 : 1.6}
                />
                <span
                  className={`text-[10px] font-semibold tracking-[0.04em] transition-colors duration-200 ${
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
