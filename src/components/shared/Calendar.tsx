import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { Card } from './Card';
import { springs } from '@/lib/animations';

interface DayIndicator {
  date: Date;
  render: (isSelected: boolean) => React.ReactNode;
}

interface CalendarProps {
  selectedMonth: Date;
  onMonthChange: (direction: 1 | -1) => void;
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  calendarDays: Date[];
  dayIndicators?: Map<string, DayIndicator>;
  layoutId?: string;
  monthDirection: number;
}

function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function Calendar({
  selectedMonth,
  onMonthChange,
  selectedDate,
  onDateSelect,
  calendarDays,
  dayIndicators,
  layoutId = 'calendar-day-selected',
  monthDirection,
}: CalendarProps) {
  return (
    <Card variant="slab" className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <motion.button
          onClick={() => onMonthChange(-1)}
          className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
          whileTap={{ scale: 0.9, x: -2 }}
        >
          <ChevronLeft className="w-4 h-4 text-[#9A9A9A]" />
        </motion.button>
        <AnimatePresence mode="wait">
          <motion.h3
            key={format(selectedMonth, 'yyyy-MM')}
            className="text-xs tracking-[0.15em] uppercase text-[#E8E4DE]"
            initial={{ opacity: 0, x: monthDirection * 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: monthDirection * -20 }}
            transition={{ duration: 0.2 }}
          >
            {format(selectedMonth, 'MMMM yyyy')}
          </motion.h3>
        </AnimatePresence>
        <motion.button
          onClick={() => onMonthChange(1)}
          className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
          whileTap={{ scale: 0.9, x: 2 }}
        >
          <ChevronRight className="w-4 h-4 text-[#9A9A9A]" />
        </motion.button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <div key={`${day}-${i}`} className="text-center text-[10px] text-[#6B6B6B] py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const key = getDateKey(day);
          const isSelected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, selectedMonth);
          const isTodayDate = isToday(day);
          const indicator = dayIndicators?.get(key);

          return (
            <button
              key={key}
              onClick={() => {
                onDateSelect(day);
              }}
              className={`h-10 rounded-[12px] text-xs tabular-nums transition-all relative ${
                isSelected
                  ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                  : inMonth
                  ? 'text-[#E8E4DE] hover:bg-white/5 active:bg-white/10'
                  : 'text-[#5A5A5A] hover:bg-white/5 active:bg-white/10'
              } ${isTodayDate && !isSelected ? 'ring-1 ring-[#C4A484]/30' : ''}`}
            >
              {isSelected && (
                <motion.div
                  className="absolute inset-0 bg-[#E8E4DE] rounded-[12px]"
                  layoutId={layoutId}
                  transition={springs.smooth}
                />
              )}
              <span className="relative z-10">{format(day, 'd')}</span>
              {indicator && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10">
                  {indicator.render(isSelected)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
