/**
 * Request signing for the Payslice partner API.
 *
 * The canonical string and HMAC scheme mirror the server exactly
 * (`src/http/auth.rs` in the API repo):
 *
 *   canonical = `${timestamp}\n${METHOD}\n${path_and_query}\n${sha256_hex(body)}`
 *   signature = `v1=` + hmac_sha256_hex(secret, canonical)
 *
 * Sent as the headers:
 *   X-Payslice-Key-Id, X-Payslice-Timestamp, X-Payslice-Signature
 *
 * The server enforces a ±300s timestamp window and verifies with a
 * constant-time comparison. Empty bodies hash to the well-known SHA-256
 * of the empty string.
 */
import { hmacSha256Hex, sha256Hex } from "./crypto.js";

export const SIGNATURE_PREFIX = "v1=";
export const KEY_ID_HEADER = "X-Payslice-Key-Id";
export const TIMESTAMP_HEADER = "X-Payslice-Timestamp";
export const SIGNATURE_HEADER = "X-Payslice-Signature";

/** SHA-256 of the empty string — the body hash used for bodyless requests. */
export const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Build the exact string the server signs. Exposed for testing. */
export async function canonicalString(
  timestamp: number,
  method: string,
  pathAndQuery: string,
  body: string,
): Promise<string> {
  const bodyHash = body.length === 0 ? EMPTY_BODY_SHA256 : await sha256Hex(body);
  return `${timestamp}\n${method.toUpperCase()}\n${pathAndQuery}\n${bodyHash}`;
}

export interface SignedHeaders {
  [KEY_ID_HEADER]: string;
  [TIMESTAMP_HEADER]: string;
  [SIGNATURE_HEADER]: string;
}

/**
 * Produce the three signature headers for an outbound request.
 *
 * @param pathAndQuery Path including the query string, exactly as sent
 *   (e.g. `/v1/advances?limit=25`). The query is part of the signature.
 */
export async function signRequest(params: {
  keyId: string;
  secret: string;
  timestamp: number;
  method: string;
  pathAndQuery: string;
  body: string;
}): Promise<SignedHeaders> {
  const canonical = await canonicalString(
    params.timestamp,
    params.method,
    params.pathAndQuery,
    params.body,
  );
  const digest = await hmacSha256Hex(params.secret, canonical);
  return {
    [KEY_ID_HEADER]: params.keyId,
    [TIMESTAMP_HEADER]: String(params.timestamp),
    [SIGNATURE_HEADER]: `${SIGNATURE_PREFIX}${digest}`,
  };
}
