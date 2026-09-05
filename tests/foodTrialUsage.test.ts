import { describe, expect, it } from 'vitest';
import { summarizeFoodTrialStatus } from '@/lib/foodTrialUsage';

const status = { date: '2026-09-05', attemptsUsed: 3, maxAttempts: 40, attempts: [
  { analysisVersion: 'gemini-tavily-v1', usage: { estimatedTokenUsd: 0.012, modelCalls: 3,
    webResearch: { provider: 'tavily', searchRequests: 1, extractRequests: 1, reportedCredits: 2, knownReportedCredits: 2, estimatedCredits: 1.2, estimatedUsd: 0.0096, complete: true } } },
  { analysisVersion: 'gemini-tavily-v1', usage: { estimatedTokenUsd: null, knownEstimatedTokenUsd: 0.021, modelCalls: 2,
    webResearch: { provider: 'tavily', reportedCredits: null, knownReportedCredits: 1, estimatedCredits: 1.2, estimatedUsd: 0.0096, complete: false } } },
  { analysisVersion: 'gemini-tavily-v1', usage: null },
] };

describe('analysis usage status', () => {
  it('retains observed token and research subtotals across multi-call partial failures without inventing zero usage', () => {
    const message = summarizeFoodTrialStatus(status);
    expect(message).toContain('3/40 attempts used today (2026-09-05, UTC)');
    expect(message).toContain('$0.0330 across 5 recorded model requests');
    expect(message).toContain('2 outcomes lack complete token usage');
    expect(message).toContain('Tavily reported credits (known subtotal): 3.00');
    expect(message).toContain('request-based estimate 2.40 credits / $0.0192');
    expect(message).toContain('2 outcomes have incomplete research usage');
    expect(message).toContain('Unknown usage is not zero');
    expect(message).not.toContain('Google Search');
    expect(message).not.toMatch(/\btrial\b|\baccess\b|invited|\bends\b/i);
  });
  it('keeps old Google Search billing separate from Tavily', () => {
    const message = summarizeFoodTrialStatus({ ...status, attempts: [...status.attempts, {
      analysisVersion: 'legacy-google', usage: { estimatedTokenUsd: 0.003, searchUsdIfAllowanceExhausted: 0.014 },
    }] });
    expect(message).toContain('Gemini known token estimate $0.0360');
    expect(message).toContain('Tavily reported credits (known subtotal): 3.00');
    expect(message).toContain('Earlier Google Search known estimate $0.0140 if its shared allowance is exhausted');
  });
  it('does not double-count deprecated Google fields on a Tavily result', () => {
    const message = summarizeFoodTrialStatus({ ...status, attempts: [{ ...status.attempts[0], usage: { ...status.attempts[0].usage, searchUsdIfAllowanceExhausted: 999 } }] });
    expect(message).not.toContain('Google Search');
    expect(message).not.toContain('999');
  });
  it('shows exhausted daily request quota without enrollment or time-window requirements', () => {
    expect(summarizeFoodTrialStatus({ ...status, attemptsUsed: 40 })).toContain('Daily request limit reached.');
  });
  it('does not present missing or malformed values as complete zero usage', () => {
    expect(() => summarizeFoodTrialStatus({})).toThrow('incomplete');
    expect(() => summarizeFoodTrialStatus({ ...status, date: 'invalid' })).toThrow('incomplete');
    const unknown = summarizeFoodTrialStatus({ ...status, attempts: [{ usage: { estimatedTokenUsd: '0' } }] });
    expect(unknown).toContain('Gemini known token estimate unreported');
    expect(unknown).toContain('1 outcome has unreported research usage');
    expect(unknown).not.toContain('$0.0000');
    const pending = summarizeFoodTrialStatus({ ...status, attempts: [{ analysisVersion: 'gemini-tavily-v1', usage: null }] });
    expect(pending).toContain('Tavily reported credits (known subtotal): unreported');
    expect(pending).not.toContain('$0.0000');
  });
  it('reports a recorded empty day and preview fixtures accurately', () => {
    expect(summarizeFoodTrialStatus({ ...status, attemptsUsed: 0, attempts: [] })).toContain('No analysis usage is recorded today.');
    expect(summarizeFoodTrialStatus({ preview: true })).toBe('Preview fixture only. No hosted usage check or API usage occurred.');
  });
});
