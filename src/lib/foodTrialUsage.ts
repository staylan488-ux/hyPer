function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function summarizeFoodTrialStatus(value: unknown): string {
  if (!value || typeof value !== 'object') throw new Error('The analysis usage response was incomplete.');
  if ('preview' in value && value.preview === true) return 'Preview fixture only. No hosted usage check or API usage occurred.';
  const status = record(value);
  if (typeof status.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(status.date)
    || !Number.isFinite(Date.parse(status.date)) || !Number.isInteger(status.maxAttempts)
    || !Number.isInteger(status.attemptsUsed) || !Array.isArray(status.attempts)
    || (status.maxAttempts as number) < 1 || (status.attemptsUsed as number) < 0) {
    throw new Error('The analysis usage response was incomplete.');
  }
  let tokenUsd = 0;
  let tokenKnown = false;
  let missingTokens = 0;
  let modelCalls = 0;
  let knownCalls = false;
  let tavilyAttempts = 0;
  let reportedCredits = 0;
  let reportedCreditsKnown = false;
  let estimatedCredits = 0;
  let estimatedTavilyUsd = 0;
  let estimatedTavilyKnown = false;
  let incompleteTavily = 0;
  let legacySearchUsd = 0;
  let legacySearchKnown = false;
  let legacyAttempts = 0;
  let incompleteLegacy = 0;
  let unclassified = 0;
  for (const raw of status.attempts) {
    const attempt = record(raw);
    const usage = record(attempt.usage);
    const completeTokenCost = amount(usage.estimatedTokenUsd);
    const knownTokenCost = completeTokenCost ?? amount(usage.knownEstimatedTokenUsd);
    if (knownTokenCost !== null) { tokenUsd += knownTokenCost; tokenKnown = true; }
    if (completeTokenCost === null) missingTokens += 1;
    const calls = amount(usage.modelCalls);
    if (calls !== null) { modelCalls += calls; knownCalls = true; }
    const research = record(usage.webResearch);
    if (research.provider === 'tavily') {
      tavilyAttempts += 1;
      const reported = amount(research.reportedCredits);
      const knownReported = reported ?? amount(research.knownReportedCredits);
      if (knownReported !== null) { reportedCredits += knownReported; reportedCreditsKnown = true; }
      const creditEstimate = amount(research.estimatedCredits);
      const usdEstimate = amount(research.estimatedUsd);
      if (creditEstimate !== null && usdEstimate !== null) {
        estimatedCredits += creditEstimate;
        estimatedTavilyUsd += usdEstimate;
        estimatedTavilyKnown = true;
      }
      if (research.complete !== true || reported === null || creditEstimate === null || usdEstimate === null) incompleteTavily += 1;
    } else if (attempt.analysisVersion === 'gemini-serving-v1' || attempt.analysisVersion === 'gemini-coach-v1') {
      // Serving interpretation and target suggestions have no web research step. Token usage is counted above.
    } else if (attempt.analysisVersion === 'legacy-google' || 'searchUsdIfAllowanceExhausted' in usage && !String(attempt.analysisVersion).startsWith('gemini-tavily')) {
      legacyAttempts += 1;
      const searchCost = amount(usage.searchUsdIfAllowanceExhausted);
      if (searchCost === null) incompleteLegacy += 1;
      else { legacySearchUsd += searchCost; legacySearchKnown = true; }
    } else if (String(attempt.analysisVersion).startsWith('gemini-tavily')) {
      tavilyAttempts += 1;
      incompleteTavily += 1;
    } else {
      unclassified += 1;
    }
  }
  const state = (status.attemptsUsed as number) >= (status.maxAttempts as number) ? 'Daily request limit reached. ' : '';
  const lines = [`${state}${status.attemptsUsed}/${status.maxAttempts} attempts used today (${status.date}, UTC).`];
  if (!status.attempts.length) return `${lines[0]} No analysis usage is recorded today.`;
  lines.push(`Gemini known token estimate ${tokenKnown ? `$${tokenUsd.toFixed(4)}` : 'unreported'}${knownCalls ? ` across ${modelCalls} recorded model requests` : ''}; ${missingTokens} ${missingTokens === 1 ? 'outcome lacks' : 'outcomes lack'} complete token usage.`);
  if (tavilyAttempts) {
    lines.push(`Tavily reported credits${incompleteTavily ? ' (known subtotal)' : ''}: ${reportedCreditsKnown ? reportedCredits.toFixed(2) : 'unreported'}; request-based estimate ${estimatedTavilyKnown ? `${estimatedCredits.toFixed(2)} credits / $${estimatedTavilyUsd.toFixed(4)}` : 'unreported'}. ${incompleteTavily} ${incompleteTavily === 1 ? 'outcome has' : 'outcomes have'} incomplete research usage.`);
  }
  if (legacyAttempts) lines.push(`Earlier Google Search known estimate ${legacySearchKnown ? `$${legacySearchUsd.toFixed(4)}` : 'unreported'} if its shared allowance is exhausted; ${incompleteLegacy} ${incompleteLegacy === 1 ? 'outcome lacks' : 'outcomes lack'} complete Google Search usage.`);
  if (unclassified) lines.push(`${unclassified} ${unclassified === 1 ? 'outcome has' : 'outcomes have'} unreported research usage.`);
  lines.push('Unknown usage is not zero. Estimates are not a billing statement; Tavily pricing depends on your plan.');
  return lines.join(' ');
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
