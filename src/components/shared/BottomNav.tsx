import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, Leaf, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

const navItems = [
  { to: '/', icon: Home, label: 'Home', matchPaths: ['/'] },
  { to: '/train', icon: Dumbbell, label: 'Train', matchPaths: ['/train', '/workout', '/splits'] },
  { to: '/nutrition', icon: Leaf, label: 'Fuel', matchPaths: ['/nutrition'] },
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
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}
      initial={{ y: 90 }}
      animate={{ y: 0 }}
      transition={springs.smooth}
    >
      <div className="max-w-lg mx-auto px-4">
        <div
          className="relative flex items-stretch h-[68px] rounded-[24px] border border-[var(--color-border)]"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-surface-1) 88%, transparent)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {navItems.map(({ to, icon: Icon, label, matchPaths }) => {
            const isActive = matchPaths.some((path) => isPathMatch(location.pathname, path));

            return (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className="relative flex-1 flex flex-col items-center justify-center gap-1"
              >
                {/* glowing dash above the active station */}
                {isActive && (
                  <motion.span
                    layoutId="nav-tick"
                    className="absolute -top-[1px] w-9 h-[3px] rounded-full bg-[var(--color-accent)]"
                    style={{ boxShadow: '0 0 12px color-mix(in srgb, var(--color-accent) 70%, transparent)' }}
                    transition={springs.smooth}
                  />
                )}
                <motion.span whileTap={{ scale: 0.86 }} transition={springs.snappy} className="flex flex-col items-center gap-1">
                  <Icon
                    className={`w-[22px] h-[22px] transition-colors duration-200 ${
                      isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
                    }`}
                    strokeWidth={isActive ? 2 : 1.6}
                    style={isActive ? { filter: 'drop-shadow(0 0 8px color-mix(in srgb, var(--color-accent) 55%, transparent))' } : undefined}
                  />
                  <span
                    className={`text-[11px] font-semibold transition-colors duration-200 ${
                      isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {label}
                  </span>
                </motion.span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
}
