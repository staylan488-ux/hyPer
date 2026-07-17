import { describe, expect, it } from 'vitest';
import { barcodeLookupCandidates, barcodesAreEquivalent, hasValidGtinChecksum, normalizeBarcode } from '@/lib/barcodes';

describe('barcode helpers', () => {
  it('normalizes camera and typed values to digits', () => {
    expect(normalizeBarcode('0 12345-67890 5')).toBe('012345678905');
  });

  it('validates GTIN checksums for common food barcode lengths', () => {
    expect(hasValidGtinChecksum('012345678905')).toBe(true);
    expect(hasValidGtinChecksum('4006381333931')).toBe(true);
    expect(hasValidGtinChecksum('96385074')).toBe(true);
    expect(hasValidGtinChecksum('012345678904')).toBe(false);
    expect(hasValidGtinChecksum('12345')).toBe(false);
  });

  it('builds equivalent UPC, EAN, and GTIN lookup candidates', () => {
    expect(barcodeLookupCandidates('012345678905')).toEqual([
      '012345678905',
      '0012345678905',
      '00012345678905',
    ]);
    expect(barcodesAreEquivalent('012345678905', '0012345678905')).toBe(true);
    expect(barcodesAreEquivalent('012345678905', '4006381333931')).toBe(false);
  });
});
