const SUPPORTED_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function normalizeBarcode(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}

export function hasValidGtinChecksum(rawValue: string): boolean {
  const digits = normalizeBarcode(rawValue);
  if (!SUPPORTED_GTIN_LENGTHS.has(digits.length)) return false;

  const checkDigit = Number(digits.at(-1));
  let sum = 0;

  for (let index = digits.length - 2, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(digits[index]) * (position % 2 === 0 ? 3 : 1);
  }

  return (10 - (sum % 10)) % 10 === checkDigit;
}

/** Expand an 8-digit UPC-E (including number system + check digit) to UPC-A. */
export function expandUpceToUpca(rawValue: string): string | null {
  const digits = normalizeBarcode(rawValue);
  if (digits.length !== 8 || !['0', '1'].includes(digits[0])) return null;

  const payload = digits.slice(1, 7);
  const compressionDigit = payload[5];
  let expandedBody: string;

  if (['0', '1', '2'].includes(compressionDigit)) {
    expandedBody = `${digits[0]}${payload.slice(0, 2)}${compressionDigit}0000${payload.slice(2, 5)}`;
  } else if (compressionDigit === '3') {
    expandedBody = `${digits[0]}${payload.slice(0, 3)}00000${payload.slice(3, 5)}`;
  } else if (compressionDigit === '4') {
    expandedBody = `${digits[0]}${payload.slice(0, 4)}00000${payload[4]}`;
  } else {
    expandedBody = `${digits[0]}${payload.slice(0, 5)}0000${compressionDigit}`;
  }

  const expanded = `${expandedBody}${digits[7]}`;
  return hasValidGtinChecksum(expanded) ? expanded : null;
}

export function normalizeFoodBarcode(rawValue: string, format?: string): string | null {
  const digits = normalizeBarcode(rawValue);

  // UPC-E uses a different compression scheme from EAN-8. The detector's
  // format is authoritative when present, so expand before checksum/lookup.
  if (format === 'upc_e') return expandUpceToUpca(digits);
  if (hasValidGtinChecksum(digits)) return digits;

  // Typed UPC-E has no format metadata. This fallback recovers values that do
  // not also happen to satisfy the EAN-8 checksum.
  return expandUpceToUpca(digits);
}

export function barcodeLookupCandidates(rawValue: string): string[] {
  const digits = normalizeBarcode(rawValue);
  const candidates = new Set<string>();
  if (hasValidGtinChecksum(digits)) candidates.add(digits);

  // Include the expanded GTIN-12 even when the same digits also form a valid
  // EAN-8. This makes exact-match comparison robust for typed UPC-E values.
  const expandedUpca = expandUpceToUpca(digits);
  if (expandedUpca) candidates.add(expandedUpca);
  if (candidates.size === 0) return [];

  // USDA branded foods may store a North American UPC-A as either 12 digits
  // or its equivalent EAN-13/GTIN-14 representation with leading zeroes.
  for (const candidate of [...candidates]) {
    if (candidate.length === 12) {
      candidates.add(`0${candidate}`);
      candidates.add(`00${candidate}`);
    } else if (candidate.length === 13 && candidate.startsWith('0')) {
      candidates.add(candidate.slice(1));
      candidates.add(`0${candidate}`);
    } else if (candidate.length === 14) {
      if (candidate.startsWith('00')) candidates.add(candidate.slice(2));
      if (candidate.startsWith('0')) candidates.add(candidate.slice(1));
    }
  }

  return [...candidates];
}

export function barcodesAreEquivalent(first: string, second: string): boolean {
  const firstCandidates = barcodeLookupCandidates(first);
  if (firstCandidates.length === 0) return false;
  const secondCandidates = new Set(barcodeLookupCandidates(second));
  return firstCandidates.some((candidate) => secondCandidates.has(candidate));
}
