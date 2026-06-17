import { Button } from '@/components/shared';
import { buildFixedWeekdays, type PlanMode } from '@/lib/planSchedule';
import type { SplitDay } from '@/types';

interface ScheduleEditorProps {
  title: string;
  description: string;
  daysPerWeek: number;
  splitDays: SplitDay[];
  startChoice: 'today' | 'tomorrow' | 'pick';
  startDate: string;
  mode: PlanMode;
  anchorDay: number;
  flexDayIndex: number;
  onStartChoiceChange: (choice: 'today' | 'tomorrow' | 'pick') => void;
  onStartDateChange: (date: string) => void;
  onModeChange: (mode: PlanMode) => void;
  onAnchorDayChange: (day: number) => void;
  onFlexDayIndexChange: (index: number) => void;
  onSave: () => void;
  onCancel?: () => void;
  saveLabel?: string;
  saving?: boolean;
}

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortWeekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * FOLIO schedule editor — an editorial form. Tracked-caps eyebrows, hairline
 * selectable cells that fill with ink when chosen, square corners, and the
 * resolved weekly rhythm read back as a mono ledger line.
 */
function OptionButton({
  active,
  onClick,
  className = '',
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pressable min-h-11 px-3 border uppercase font-medium tracking-[0.16em] text-[10px] transition-colors ${
        active
          ? 'bg-[var(--color-text)] text-[var(--color-base)] border-[var(--color-text)]'
          : 'bg-transparent text-[var(--color-text-dim)] border-[var(--color-border-strong)] hover:text-[var(--color-text)] hover:border-[var(--color-text)]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function ScheduleEditor({
  title,
  description,
  daysPerWeek,
  splitDays,
  startChoice,
  startDate,
  mode,
  anchorDay,
  flexDayIndex,
  onStartChoiceChange,
  onStartDateChange,
  onModeChange,
  onAnchorDayChange,
  onFlexDayIndexChange,
  onSave,
  onCancel,
  saveLabel = 'Save Changes',
  saving = false,
}: ScheduleEditorProps) {
  return (
    <div className="space-y-8 py-1">
      <div>
        <p className="t-label mb-2">{title}</p>
        <p className="t-caption max-w-[42ch]">{description}</p>
      </div>

      <div className="pt-6 border-t border-[var(--color-border)]">
        <p className="t-label-sm mb-3">When should Day 1 start?</p>
        <div className="grid grid-cols-3 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
          <OptionButton active={startChoice === 'today'} onClick={() => onStartChoiceChange('today')} className="border-0">
            Today
          </OptionButton>
          <OptionButton active={startChoice === 'tomorrow'} onClick={() => onStartChoiceChange('tomorrow')} className="border-0">
            Tomorrow
          </OptionButton>
          <OptionButton active={startChoice === 'pick'} onClick={() => onStartChoiceChange('pick')} className="border-0">
            Pick date
          </OptionButton>
        </div>

        {startChoice === 'pick' && (
          <div className="mt-3 w-full min-w-0 overflow-hidden well px-3 py-2.5">
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="w-full min-w-0 bg-transparent text-[var(--color-text)] t-data outline-none"
            />
          </div>
        )}
      </div>

      <div className="pt-6 border-t border-[var(--color-border)]">
        <p className="t-label-sm mb-3">Schedule style</p>
        <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
          <OptionButton active={mode === 'fixed'} onClick={() => onModeChange('fixed')} className="border-0 min-h-12">
            Fixed weekly rhythm
          </OptionButton>
          <OptionButton active={mode === 'flex'} onClick={() => onModeChange('flex')} className="border-0 min-h-12">
            Flexible sequence
          </OptionButton>
        </div>
      </div>

      {mode === 'fixed' ? (
        <div className="pt-6 border-t border-[var(--color-border)]">
          <p className="t-label-sm mb-3">Choose first training day</p>
          <div className="grid grid-cols-7 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
            {shortWeekdayLabels.map((label, weekday) => {
              const active = anchorDay === weekday;
              return (
                <OptionButton
                  key={`${label}-${weekday}`}
                  active={active}
                  onClick={() => onAnchorDayChange(weekday)}
                  className="border-0 px-0"
                >
                  {label}
                </OptionButton>
              );
            })}
          </div>

          <p className="mt-3 flex items-baseline gap-2">
            <span className="t-label-sm">Auto plan</span>
            <span className="t-data-sm text-[var(--color-text-dim)]">
              {buildFixedWeekdays(anchorDay, daysPerWeek).map((day) => weekdayLabels[day]).join(' / ')}
            </span>
          </p>
        </div>
      ) : (
        <div className="pt-6 border-t border-[var(--color-border)]">
          <p className="t-label-sm mb-2">Active training day</p>
          <p className="t-caption mb-3 max-w-[42ch]">Choose which split day should be next in your sequence.</p>
          <div className="grid grid-cols-2 gap-px bg-[var(--color-border)] border border-[var(--color-border)]">
            {splitDays.map((day, index) => {
              const active = index === flexDayIndex;
              return (
                <button
                  type="button"
                  key={day.id}
                  onClick={() => onFlexDayIndexChange(index)}
                  className={`pressable min-h-12 px-3.5 text-left text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                      : 'bg-[var(--color-surface-1)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {day.day_name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {onCancel ? (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving}>
            {saveLabel}
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={onSave} loading={saving}>
          {saveLabel}
        </Button>
      )}
    </div>
  );
}
