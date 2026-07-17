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

export function barcodeLookupCandidates(rawValue: string): string[] {
  const digits = normalizeBarcode(rawValue);
  if (!hasValidGtinChecksum(digits)) return [];

  const candidates = new Set([digits]);

  // USDA branded foods may store a North American UPC-A as either 12 digits
  // or its equivalent EAN-13/GTIN-14 representation with leading zeroes.
  if (digits.length === 12) {
    candidates.add(`0${digits}`);
    candidates.add(`00${digits}`);
  } else if (digits.length === 13 && digits.startsWith('0')) {
    candidates.add(digits.slice(1));
    candidates.add(`0${digits}`);
  } else if (digits.length === 14) {
    if (digits.startsWith('00')) candidates.add(digits.slice(2));
    if (digits.startsWith('0')) candidates.add(digits.slice(1));
  }

  return [...candidates];
}

export function barcodesAreEquivalent(first: string, second: string): boolean {
  const firstCandidates = barcodeLookupCandidates(first);
  if (firstCandidates.length === 0) return false;
  const secondCandidates = new Set(barcodeLookupCandidates(second));
  return firstCandidates.some((candidate) => secondCandidates.has(candidate));
}
