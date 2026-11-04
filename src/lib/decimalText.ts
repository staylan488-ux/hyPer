/**
 * Typed decimals, read the way iOS's decimal pad types them. In regions that
 * write "1,5" (much of Europe and South America) the pad has a comma and no
 * point, so a comma counts as the decimal point. Without this, parseFloat
 * stopped at the comma ("82,5" saved as 82) and Number gave NaN.
 */
export function normalizeDecimalText(text: string): string {
  return text.trim().replace(',', '.');
}

/** parseFloat of a typed decimal, with a comma read as the decimal point. */
export function parseDecimal(text: string): number {
  return Number.parseFloat(normalizeDecimalText(text));
}
