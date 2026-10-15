import { Button } from '@/components/shared';
import { tapHaptic } from '@/lib/haptics';
import { buildFixedWeekdays, type PlanMode } from '@/lib/planSchedule';
import type { SplitDay } from '@/types';

interface ScheduleEditorProps {
  /** Shown as an eyebrow with the description; the setup page titles itself. */
  title?: string;
  description?: string;
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
  /** The page's command capsule carries Save instead. */
  hideSave?: boolean;
}

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortWeekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Metal schedule choices: hairline capsules in sentence case; the selected
 * one fills with ink.
 */
function OptionButton({
  active,
  onClick,
  className = '',
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => { tapHaptic(); onClick(); }}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`metal-chip pressable min-h-11 px-3 text-[13.5px] font-medium transition-colors ${
        active
          ? 'is-selected bg-[var(--metal-ink)] text-[var(--color-base)]'
          : 'text-[var(--metal-ink-2)] hover:text-[var(--metal-ink)]'
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
  saveLabel = 'Save changes',
  saving = false,
  hideSave = false,
}: ScheduleEditorProps) {
  return (
    <div className="py-1">
      {(title || description) && (
        <div className="mb-6">
          {title && <p className="metal-eyebrow mb-2">{title}</p>}
          {description && <p className="metal-note mt-0 max-w-[42ch]">{description}</p>}
        </div>
      )}

      <div className="metal-rule pt-3 pb-6">
        <p className="metal-eyebrow mb-3 min-h-8">When should Day 1 start?</p>
        <div className="grid grid-cols-3 gap-2">
          <OptionButton active={startChoice === 'today'} onClick={() => onStartChoiceChange('today')}>
            Today
          </OptionButton>
          <OptionButton active={startChoice === 'tomorrow'} onClick={() => onStartChoiceChange('tomorrow')}>
            Tomorrow
          </OptionButton>
          <OptionButton active={startChoice === 'pick'} onClick={() => onStartChoiceChange('pick')}>
            Pick date
          </OptionButton>
        </div>

        {startChoice === 'pick' && (
          <div className="mt-3 w-full min-w-0 overflow-hidden metal-input px-3.5 py-2.5">
            <input
              type="date"
              aria-label="Plan start date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="w-full min-w-0 bg-transparent text-[var(--metal-ink)] text-[1rem] tabular-nums outline-none"
            />
          </div>
        )}
      </div>

      <div className="metal-rule pt-3 pb-6">
        <p className="metal-eyebrow mb-3 min-h-8">Schedule style</p>
        <div className="grid grid-cols-2 gap-2">
          <OptionButton active={mode === 'fixed'} onClick={() => onModeChange('fixed')}>
            Fixed weekly rhythm
          </OptionButton>
          <OptionButton active={mode === 'flex'} onClick={() => onModeChange('flex')}>
            Flexible sequence
          </OptionButton>
        </div>
      </div>

      {mode === 'fixed' ? (
        <div className="metal-rule pt-3 pb-6">
          <p className="metal-eyebrow mb-3 min-h-8">Choose first training day</p>
          <div className="grid grid-cols-7 gap-1.5">
            {shortWeekdayLabels.map((label, weekday) => {
              const active = anchorDay === weekday;
              return (
                <OptionButton
                  key={`${label}-${weekday}`}
                  active={active}
                  onClick={() => onAnchorDayChange(weekday)}
                  ariaLabel={weekdayLabels[weekday]}
                  className="px-0"
                >
                  {label}
                </OptionButton>
              );
            })}
          </div>

          <p className="metal-line mt-4">
            <span className="text-[var(--metal-ink-2)]">Auto plan</span>
            <span className="metal-sep" aria-hidden>·</span>
            {buildFixedWeekdays(anchorDay, daysPerWeek).map((day) => weekdayLabels[day]).join(' / ')}
          </p>
        </div>
      ) : (
        <div className="metal-rule pt-3 pb-6">
          <p className="metal-eyebrow mb-2 min-h-8">Active training day</p>
          <p className="metal-note mt-0 mb-3 max-w-[42ch]">Choose which split day should be next in your sequence.</p>
          <div className="grid grid-cols-2 gap-2">
            {splitDays.map((day, index) => {
              const active = index === flexDayIndex;
              return (
                <OptionButton key={day.id} active={active} onClick={() => onFlexDayIndexChange(index)} className="min-h-12 px-3.5">
                  {day.day_name}
                </OptionButton>
              );
            })}
          </div>
        </div>
      )}

      {hideSave ? null : onCancel ? (
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
