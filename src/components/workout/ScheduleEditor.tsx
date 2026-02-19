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
    <div className="space-y-5 py-1">
      <div>
        <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] mb-1">{title}</p>
        <p className="text-sm text-[#CFC9BF] leading-relaxed">{description}</p>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">When should Day 1 start?</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onStartChoiceChange('today')}
            className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
              startChoice === 'today'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onStartChoiceChange('tomorrow')}
            className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
              startChoice === 'tomorrow'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
            }`}
          >
            Tomorrow
          </button>
          <button
            type="button"
            onClick={() => onStartChoiceChange('pick')}
            className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
              startChoice === 'pick'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
            }`}
          >
            Pick date
          </button>
        </div>

        {startChoice === 'pick' && (
          <div className="w-full min-w-0 overflow-hidden rounded-[12px] bg-[#2A2A2A] border border-white/5 px-3 py-2">
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              className="w-full min-w-0 bg-transparent text-[#E8E4DE] text-sm outline-none"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Schedule style</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onModeChange('fixed')}
            className={`px-3 py-3 rounded-[12px] text-xs transition-colors ${
              mode === 'fixed'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
            }`}
          >
            Fixed weekly rhythm
          </button>
          <button
            type="button"
            onClick={() => onModeChange('flex')}
            className={`px-3 py-3 rounded-[12px] text-xs transition-colors ${
              mode === 'flex'
                ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
            }`}
          >
            Flexible sequence
          </button>
        </div>
      </div>

      {mode === 'fixed' ? (
        <div className="space-y-2">
          <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Choose first training day</p>
          <div className="grid grid-cols-7 gap-1">
            {shortWeekdayLabels.map((label, weekday) => {
              const active = anchorDay === weekday;
              return (
                <button
                  type="button"
                  key={`${label}-${weekday}`}
                  onClick={() => onAnchorDayChange(weekday)}
                  className={`py-2 rounded-[10px] text-xs transition-colors ${
                    active
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-[#6B6B6B]">
            Auto plan: {buildFixedWeekdays(anchorDay, daysPerWeek).map((day) => weekdayLabels[day]).join(' / ')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Active training day</p>
          <p className="text-[10px] text-[#6B6B6B]">Choose which split day should be next in your sequence.</p>
          <div className="grid grid-cols-2 gap-2">
            {splitDays.map((day, index) => {
              const active = index === flexDayIndex;
              return (
                <button
                  type="button"
                  key={day.id}
                  onClick={() => onFlexDayIndexChange(index)}
                  className={`px-3 py-3 rounded-[12px] text-xs text-left transition-colors ${
                    active
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
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
        <div className="grid grid-cols-2 gap-2 pt-1">
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
