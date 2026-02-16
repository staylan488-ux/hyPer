import { motion, useReducedMotion } from 'motion/react';
import { Contrast } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { springs } from '@/lib/animations';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const reduceMotion = useReducedMotion();
  const { theme, toggleTheme } = useThemeStore();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className={`group inline-flex items-center gap-3 rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-sm text-[var(--color-text)] ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'} ${className}`}
    >
      <motion.span
        className="inline-flex items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
        whileTap={reduceMotion ? undefined : { scale: 0.9 }}
        animate={reduceMotion ? undefined : { rotate: isLight ? 180 : 0 }}
        transition={reduceMotion ? { duration: 0 } : springs.snappy}
        style={{ width: compact ? 24 : 26, height: compact ? 24 : 26 }}
      >
        <Contrast className="w-3.5 h-3.5" strokeWidth={1.8} />
      </motion.span>

      {!compact && (
        <span className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
          {isLight ? 'Light' : 'Dark'}
        </span>
      )}

      <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-[color-mix(in_srgb,var(--color-surface-high)_86%,var(--color-base)_14%)] border border-[var(--color-border)]">
        <motion.span
          className="inline-block h-[18px] w-[18px] rounded-full"
          style={{
            backgroundColor: isLight ? 'var(--color-text)' : 'var(--color-accent)',
            marginLeft: 4,
          }}
          animate={{ x: isLight ? 20 : 0 }}
          transition={reduceMotion ? { duration: 0 } : springs.snappy}
        />
      </span>
    </button>
  );
}
