export async function createRequestIdempotencyKey(scope: string, body: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${scope}:${hex}`;
  }
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `${scope}:${random.replace(/[^a-zA-Z0-9.-]/g, '')}`;
}

