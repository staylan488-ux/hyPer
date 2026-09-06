import { useThemeStore, type ThemePreference } from '@/stores/themeStore';

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

/** Keep the saved preference distinct from the currently resolved appearance. */
export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const { preference, setTheme } = useThemeStore();

  const options: { mode: ThemePreference; label: string }[] = [
    { mode: 'system', label: compact ? 'Auto' : 'Follow system' },
    { mode: 'light', label: compact ? 'Iv' : 'Ivory' },
    { mode: 'dark', label: compact ? 'Bk' : 'Black' },
  ];

  return (
    <div
      className={`inline-flex gap-1 p-1 bg-[var(--color-well)] rounded-[var(--radius-control)] ${className}`}
      role="group"
      aria-label="Theme"
    >
      {options.map((opt) => {
        const active = preference === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            onClick={() => setTheme(opt.mode)}
            aria-label={opt.mode === 'system' ? 'Follow system' : opt.mode === 'light' ? 'Ivory (light)' : 'Black (dark)'}
            aria-pressed={active}
            className={`px-3.5 min-h-11 rounded-[var(--radius-control)] text-[11px] font-medium uppercase tracking-[0.16em] transition-colors duration-200 ${
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
