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
