import { format } from 'date-fns';
import { ActionSheetIOS, View } from 'react-native';

import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { FormNote, PickerRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { useNow } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { timeAsDate, usesDayGroups } from '~/lib/foodLogger';

import { useLogger } from './context';

/** Day, time and meal for the entry, as on the web logger's When row. */
export function WhenBlock({ disabled }: { disabled?: boolean }) {
  const { when, setWhen, selectedKey, groups, purpose } = useLogger();
  // Read every render: kept with the entry, a sheet open past midnight couldn't pick the new day.
  const now = useNow();
  if (purpose === 'ingredients') return null;
  const sameDay = usesDayGroups(when, selectedKey);
  const group = sameDay ? groups.find((candidate) => candidate.id === when.groupId) ?? null : null;

  const chooseGroup = () => {
    const options = ['Unassigned', ...groups.map((candidate) => nutritionGroupLabel(candidate, groups)), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add to', options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === options.length - 1) return;
      haptics.select();
      setWhen({ ...when, groupId: index === 0 ? null : groups[index - 1].id });
    });
  };

  return (
    <Section title="When">
      <Label>
        <PickerRow
          label="Day"
          mode="date"
          value={when.date}
          max={now}
          disabled={disabled}
          onChange={(date) => {
            const day = new Date(date);
            day.setHours(12, 0, 0, 0);
            const moved = format(day, 'yyyy-MM-dd') !== format(when.date, 'yyyy-MM-dd');
            // groups belong to the page's day; another day logs Unassigned
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
        <Hairline />
        {sameDay ? (
          <Row
            title="Add to"
            quiet={false}
            value={group ? nutritionGroupLabel(group, groups) : 'Unassigned'}
            chevron={!disabled}
            onPress={disabled ? undefined : chooseGroup}
          />
        ) : (
          <View>
            <Row title="Add to" value={`Unassigned on ${format(when.date, 'MMM d')}`} />
          </View>
        )}
      </Label>
      {!sameDay ? <FormNote>Meals shown here belong to {format(new Date(`${selectedKey}T12:00:00`), 'MMM d')}.</FormNote> : null}
    </Section>
  );
}
