/**
 * Universal cryptographic primitives built on the Web Crypto API
 * (`globalThis.crypto.subtle`), available on Node 18+, Deno, Bun, edge
 * runtimes, and browsers. No Node `crypto` import, so the package stays
 * runtime-agnostic.
 */

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "Web Crypto API is unavailable. Use Node.js 18+, Deno, Bun, an edge runtime, or a browser.",
    );
  }
  return c.subtle;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Lowercase hex SHA-256 of a UTF-8 string or raw bytes. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  const digest = await subtle().digest("SHA-256", data as BufferSource);
  return toHex(digest);
}

/** Lowercase hex HMAC-SHA256 of `message` under `secret`. */
export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await subtle().importKey(
    "raw",
    encoder.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await subtle().sign(
    "HMAC",
    key,
    encoder.encode(message) as BufferSource,
  );
  return toHex(signature);
}

/**
 * Length-constant comparison of two hex strings. Avoids leaking, via
 * timing, how many leading characters of a signature matched.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** RFC 4122 v4 UUID, used for auto-generated idempotency keys. */
export function randomUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.randomUUID) {
    throw new Error("crypto.randomUUID is unavailable in this runtime.");
  }
  return c.randomUUID();
}
