function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * When the server's daily count starts over (midnight UTC), in local time and
 * ready to follow a verb: "at 5 PM", "tomorrow at 4 PM" or "at midnight".
 * West of UTC an evening's reset falls on the next local day, so a bare
 * "at 4 PM" late at night would read as a time already gone.
 */
export function usageResetLabel(now: Date = new Date()): string {
  const reset = new Date(now.getTime());
  reset.setUTCHours(24, 0, 0, 0);
  const hours = reset.getHours();
  const minutes = reset.getMinutes();
  // Local midnight is the start of the next day, which "at midnight" already says.
  if (hours === 0 && minutes === 0) return 'at midnight';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const time = `${hour12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''} ${hours < 12 ? 'AM' : 'PM'}`;
  return reset.toDateString() === now.toDateString() ? `at ${time}` : `tomorrow at ${time}`;
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
  // Switched off for everyone by the owner.
  if (status.aiEnabled === false) return 'AI estimates are paused for now.';
  // The limit shared by every account (a daily spend ceiling) can run out first.
  if (status.globalLimitReached === true) return `Today’s limit for everyone is reached. It starts over ${reset}.`;
  return (used as number) >= (max as number)
    ? `Daily limit reached: ${used} of ${max} used. It starts over ${reset}.`
    : `${used} of ${max} analyses used. The count starts over ${reset}.`;
}
