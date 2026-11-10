function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** When the server's daily count starts over (midnight UTC), in local time: "5 PM". */
function usageResetLabel(now: Date): string {
  const reset = new Date(now.getTime());
  reset.setUTCHours(24, 0, 0, 0);
  const hours = reset.getHours();
  const minutes = reset.getMinutes();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * One line for a phone: how many hosted analyses the daily limit has left.
 * The limit counts by UTC day, so the line says when it starts over locally.
 */
export function foodTrialUsageLine(value: unknown, now: Date = new Date()): string {
  if (!value || typeof value !== 'object') throw new Error('The analysis usage response was incomplete.');
  if ('preview' in value && value.preview === true) return 'Sample data: no analyses counted.';
  const status = record(value);
  const used = status.attemptsUsed;
  const max = status.maxAttempts;
  if (!Number.isInteger(used) || !Number.isInteger(max) || (max as number) < 1 || (used as number) < 0) {
    throw new Error('The analysis usage response was incomplete.');
  }
  const reset = usageResetLabel(now);
  return (used as number) >= (max as number)
    ? `Daily limit reached: ${used} of ${max} used. It starts over at ${reset}.`
    : `${used} of ${max} analyses used. The count starts over at ${reset}.`;
}
