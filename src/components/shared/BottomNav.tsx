import { NavLink, useLocation } from 'react-router-dom';
import { Home, Dumbbell, UtensilsCrossed, LayoutGrid, User } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/workout', icon: Dumbbell, label: 'Train' },
  { to: '/nutrition', icon: UtensilsCrossed, label: 'Fuel' },
  { to: '/splits', icon: LayoutGrid, label: 'Program' },
  { to: '/settings', icon: User, label: 'Profile' },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <motion.nav
      className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] backdrop-blur-md border-t border-[var(--color-border)] safe-area-inset-bottom"
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      transition={springs.smooth}
    >
      <div className="flex justify-around items-center h-20 max-w-lg mx-auto px-4">
        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to ||
            (to !== '/' && location.pathname.startsWith(to));

          return (
            <NavLink
              key={to}
              to={to}
              className="relative flex flex-col items-center justify-center py-2 px-4 rounded-[20px] transition-colors duration-200"
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0 bg-[var(--color-surface-high)] rounded-[20px] border border-[var(--color-border)]"
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
