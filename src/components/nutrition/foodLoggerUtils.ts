import { format } from 'date-fns';

export function toLocalTimeInput(dateIso: string | null, fallbackDate: Date): string {
  const source = dateIso ? new Date(dateIso) : new Date(fallbackDate);
  if (Number.isNaN(source.getTime())) return '12:00';
  return format(source, 'HH:mm');
}

export function buildLoggedAt(selectedDate: Date, timeValue: string): string {
  const [hoursRaw = '12', minutesRaw = '00'] = (timeValue || '12:00').split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  const localDate = new Date(selectedDate);
  localDate.setHours(
    Number.isFinite(hours) ? hours : 12,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );

  return localDate.toISOString();
}

export function hasMissingColumnError(error: unknown, columnName: string): boolean {
  const message = (error as { message?: string } | null)?.message?.toLowerCase() || '';
  return (
    message.includes(columnName.toLowerCase()) &&
    (message.includes('does not exist') || message.includes('schema cache'))
  );
}

export function shouldDropColumn(error: unknown, columnName: string): boolean {
  return hasMissingColumnError(error, columnName);
}
