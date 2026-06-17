import { useThemeStore } from '@/stores/themeStore';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

/** FOLIO theme toggle — a binary Paper/Ink switch set in tracked caps. */
export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const { theme, setTheme } = useThemeStore();

  const options: { mode: 'light' | 'dark'; label: string }[] = [
    { mode: 'light', label: compact ? 'Pa' : 'Paper' },
    { mode: 'dark', label: compact ? 'In' : 'Ink' },
  ];

  return (
    <div
      className={`inline-flex border border-[var(--color-border-strong)] ${className}`}
      role="group"
      aria-label="Theme"
    >
      {options.map((opt) => {
        const active = theme === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            onClick={() => setTheme(opt.mode)}
            aria-pressed={active}
            className={`px-3.5 min-h-9 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors duration-200 ${
              active
                ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                : 'bg-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
