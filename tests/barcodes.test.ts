import { describe, expect, it } from 'vitest';
import {
  barcodeLookupCandidates,
  barcodesAreEquivalent,
  expandUpceToUpca,
  hasValidGtinChecksum,
  normalizeBarcode,
  normalizeFoodBarcode,
} from '@/lib/barcodes';

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

  it('expands UPC-E before validating and comparing it with stored UPC-A', () => {
    expect(hasValidGtinChecksum('04252614')).toBe(false); // not an EAN-8 checksum
    expect(expandUpceToUpca('04252614')).toBe('042100005264');
    expect(normalizeFoodBarcode('04252614', 'upc_e')).toBe('042100005264');
    expect(barcodeLookupCandidates('04252614')).toEqual([
      '042100005264',
      '0042100005264',
      '00042100005264',
    ]);
    expect(barcodesAreEquivalent('04252614', '042100005264')).toBe(true);
  });

  it('keeps EAN-8 unchanged unless the detector identifies UPC-E', () => {
    expect(normalizeFoodBarcode('96385074', 'ean_8')).toBe('96385074');
  });
});
