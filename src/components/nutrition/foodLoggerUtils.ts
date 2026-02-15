import { format } from 'date-fns';

export function toLocalTimeInput(dateIso: string | null, fallbackDate: Date): string {
  const source = dateIso ? new Date(dateIso) : new Date(fallbackDate);
  if (Number.isNaN(source.getTime())) return '12:00';
  return format(source, 'HH:mm');
}

export function buildLoggedAt(selectedDate: Date, timeValue: string): string {
  const datePart = format(selectedDate, 'yyyy-MM-dd');
  return `${datePart}T${timeValue || '12:00'}:00`;
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
