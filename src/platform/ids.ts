/** Short random identifiers. Lowercase hex only, so they are safe as URL host names. */
export function generateId(prefix = '', bytes = 8): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  let hex = '';
  for (const byte of buffer) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return prefix + hex;
}
