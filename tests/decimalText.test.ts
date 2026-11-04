import { describe, expect, it } from 'vitest';

import { normalizeDecimalText, parseDecimal } from '@/lib/decimalText';

describe('typed decimals', () => {
  it('reads a comma as the decimal point', () => {
    expect(parseDecimal('82,5')).toBe(82.5);
    expect(parseDecimal('0,5')).toBe(0.5);
    expect(normalizeDecimalText(' 1,5 ')).toBe('1.5');
  });

  it('keeps point decimals, whole numbers and empty text as before', () => {
    expect(parseDecimal('82.5')).toBe(82.5);
    expect(parseDecimal('80')).toBe(80);
    expect(Number.isNaN(parseDecimal(''))).toBe(true);
    expect(Number(normalizeDecimalText(''))).toBe(0);
  });
});
