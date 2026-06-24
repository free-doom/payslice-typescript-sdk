import { randomUuid } from "./crypto.js";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const MAX_IDEMPOTENCY_KEY_BYTES = 255;

/**
 * Resolve the idempotency key for a money-moving request: use the
 * caller-supplied key when present, otherwise mint a fresh UUID. The server
 * scopes keys per partner and replays the original response on reuse — so a
 * stable key is what makes a retry safe.
 */
export function resolveIdempotencyKey(provided?: string): string {
  if (provided === undefined) return randomUuid();
  validateIdempotencyKey(provided);
  return provided;
}

function validateIdempotencyKey(key: string): void {
  const byteLength = new TextEncoder().encode(key).length;
  if (byteLength === 0 || byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
    throw new Error(
      `idempotencyKey must be 1 to ${MAX_IDEMPOTENCY_KEY_BYTES} bytes (got ${byteLength}).`,
    );
  }
  // Visible ASCII only, matching the server's parser.
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new Error("idempotencyKey must contain only visible ASCII characters.");
  }
}
