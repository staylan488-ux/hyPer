import { endOfDay, format, parseISO } from 'date-fns';

import { FormNote, PickerRow } from '~/components/Form';
import { useCurrentDayKey } from '~/lib/accountData';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { Section } from '~/components/Section';
import { timeAsDate, usesDayGroups } from '~/lib/foodLogger';

import { useLogger } from './context';

/** Day and time for the entry; the meal is the sheet's destination line, under its title. */
export function WhenBlock({ disabled }: { disabled?: boolean }) {
  const { when, setWhen, selectedKey, purpose } = useLogger();
  // The Day picker ends on today, moving on at midnight while the sheet is open.
  const currentDay = useCurrentDayKey();
  const latestDay = endOfDay(parseISO(currentDay));
  if (purpose === 'ingredients') return null;
  const sameDay = usesDayGroups(when, selectedKey);

  return (
    <Section title="When">
      <Label>
        <PickerRow
          label="Day"
          mode="date"
          value={when.date}
          max={latestDay}
          disabled={disabled}
          onChange={(date) => {
            const day = new Date(date);
            day.setHours(12, 0, 0, 0);
            const moved = format(day, 'yyyy-MM-dd') !== format(when.date, 'yyyy-MM-dd');
            // groups belong to the page's day; another day logs to no meal
            setWhen({ ...when, date: day, groupId: moved && format(day, 'yyyy-MM-dd') !== selectedKey ? null : when.groupId });
          }}
        />
        <Hairline />
        <PickerRow
          label="Time"
          mode="time"
          value={timeAsDate(when.date, when.time)}
          disabled={disabled}
          onChange={(date) => setWhen({ ...when, time: format(date, 'HH:mm') })}
        />
      </Label>
      {/* The meal is chosen on the line under the sheet's title, which names it; another day's food goes in no meal. */}
      {!sameDay ? <FormNote>To add it to one of that day's meals, log it from {format(when.date, 'MMM d')} in Fuel.</FormNote> : null}
    </Section>
  );
}
