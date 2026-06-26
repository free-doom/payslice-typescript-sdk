/**
 * Random hex helpers, shared by the client page and the server mock. Uses the
 * Web Crypto API, available both in the browser and in Node 18+ (globalThis.crypto).
 */

/** `len` random bytes as a lowercase hex string (no 0x prefix). */
export function randomHex(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A throwaway 20-byte EVM address (no key) — for unambiguous settlement scans. */
export function freshAddress(): string {
  return "0x" + randomHex(20);
}
