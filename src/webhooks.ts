/**
 * Inbound webhook verification and typed event construction.
 *
 * Payslice signs each delivery with the SAME canonical scheme as API
 * requests (`src/workers/webhook_outbox.rs`), over the *registered endpoint
 * URL's* path-and-query:
 *
 *   canonical = `${timestamp}\nPOST\n${path_and_query}\n${sha256_hex(body)}`
 *   X-Payslice-Signature: `v1=` + hmac_sha256_hex(endpoint_secret, canonical)
 *
 * IMPORTANT: verify against the RAW request body bytes. If your framework
 * parses JSON first and you re-serialize, the bytes won't match what was
 * signed and verification will fail. Capture the raw body (see examples).
 */
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "./core/crypto.js";
import { PaysliceError } from "./core/errors.js";
import type {
  Advance,
  CollectionsDue,
  IsoDateTime,
  Money,
} from "./types.js";

const SIGNATURE_PREFIX = "v1=";
const DEFAULT_TOLERANCE_SECONDS = 300;

export const TIMESTAMP_HEADER = "x-payslice-timestamp";
export const SIGNATURE_HEADER = "x-payslice-signature";
export const EVENT_ID_HEADER = "x-payslice-event-id";
export const EVENT_TYPE_HEADER = "x-payslice-event-type";

/** Raised when a webhook signature or timestamp fails verification. */
export class WebhookVerificationError extends PaysliceError {
  constructor(message: string) {
    super(message, { code: "webhook_verification_failed" });
  }
}

// --- Typed events --------------------------------------------------------

interface BaseEvent<TType extends string, TData> {
  event_id: string;
  api_version: string;
  type: TType;
  created_at: IsoDateTime;
  data: TData;
}

export interface VaultLowBalanceData {
  balance: Money;
  threshold: Money;
}

export type WebhookEvent =
  | BaseEvent<"advance.approved", Advance>
  | BaseEvent<"advance.released", Advance>
  | BaseEvent<"advance.failed", Advance>
  | BaseEvent<"collection.due", CollectionsDue>
  | BaseEvent<"vault.low_balance", VaultLowBalanceData>;

export type WebhookEventType = WebhookEvent["type"];

// --- Header access -------------------------------------------------------

export type HeaderInput =
  | Headers
  | Record<string, string | string[] | undefined>;

function getHeader(headers: HeaderInput, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  // Node lowercases incoming header keys; match case-insensitively anyway.
  const direct = record[name];
  const value =
    direct ??
    record[Object.keys(record).find((k) => k.toLowerCase() === name) ?? ""];
  return Array.isArray(value) ? value[0] : value;
}

// --- path_and_query (mirrors the server's signer) ------------------------

/**
 * Reduce a registered endpoint URL to the path-and-query string the server
 * signs over. Ported from `path_and_query` in `webhook_outbox.rs`: fragments
 * are stripped, and a bare host with only a query maps to `/?...`.
 */
export function pathAndQuery(url: string): string {
  const schemeSplit = url.indexOf("://");
  if (schemeSplit === -1) {
    const noFragment = stripFragment(url);
    return noFragment.length === 0 ? "/" : noFragment;
  }

  const afterScheme = stripFragment(url.slice(schemeSplit + 3));
  const pathIndex = afterScheme.indexOf("/");
  const queryIndex = afterScheme.indexOf("?");

  if (pathIndex !== -1 && queryIndex !== -1 && queryIndex < pathIndex) {
    return `/${afterScheme.slice(queryIndex)}`;
  }
  if (pathIndex !== -1) {
    return afterScheme.slice(pathIndex);
  }
  if (queryIndex !== -1) {
    return `/${afterScheme.slice(queryIndex)}`;
  }
  return "/";
}

function stripFragment(value: string): string {
  const hash = value.indexOf("#");
  return hash === -1 ? value : value.slice(0, hash);
}

// --- Verification --------------------------------------------------------

export interface VerifyOptions {
  /** Raw request body, exactly as received (string or bytes). */
  payload: string | Uint8Array;
  /** Request headers, or the individual signature/timestamp header values. */
  headers?: HeaderInput;
  signature?: string;
  timestamp?: string | number;
  /** The endpoint secret returned when the webhook was registered. */
  secret: string;
  /**
   * The full URL you registered with Payslice (e.g.
   * `https://partner.example/webhooks/payslice`). The SDK derives the signed
   * path-and-query from it. Prefer this over {@link path}: the server signs
   * over the *registered* URL's path, so passing the URL removes the chance
   * of a hand-copied path drifting out of sync.
   */
  endpointUrl?: string;
  /**
   * The exact path-and-query the signature was computed over. Advanced
   * override; usually pass {@link endpointUrl} instead. Defaults to `/` only
   * when neither is given (correct only for a root-path endpoint).
   */
  path?: string;
  /** Allowed clock skew, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Clock source (seconds since epoch). Overridable for testing. */
  now?: () => number;
}

function resolveSignatureAndTimestamp(opts: VerifyOptions): {
  signature: string;
  timestamp: string;
} {
  const signature =
    opts.signature ??
    (opts.headers ? getHeader(opts.headers, SIGNATURE_HEADER) : undefined);
  const timestamp =
    opts.timestamp !== undefined
      ? String(opts.timestamp)
      : opts.headers
        ? getHeader(opts.headers, TIMESTAMP_HEADER)
        : undefined;

  if (!signature) {
    throw new WebhookVerificationError("Missing X-Payslice-Signature header.");
  }
  if (!timestamp) {
    throw new WebhookVerificationError("Missing X-Payslice-Timestamp header.");
  }
  return { signature, timestamp };
}

/**
 * Verify a webhook signature and timestamp. Throws
 * {@link WebhookVerificationError} on any mismatch; resolves to the raw
 * payload string on success.
 */
export async function verifySignature(opts: VerifyOptions): Promise<string> {
  const { signature, timestamp } = resolveSignatureAndTimestamp(opts);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    throw new WebhookVerificationError("Malformed X-Payslice-Timestamp header.");
  }
  if (Math.abs(now - ts) > tolerance) {
    throw new WebhookVerificationError(
      `Timestamp outside the ±${tolerance}s tolerance window (possible replay).`,
    );
  }

  const body =
    typeof opts.payload === "string"
      ? opts.payload
      : new TextDecoder().decode(opts.payload);

  const signedPath = opts.endpointUrl
    ? pathAndQuery(opts.endpointUrl)
    : (opts.path ?? "/");
  const bodyHash = await sha256Hex(opts.payload);
  const canonical = `${timestamp}\nPOST\n${signedPath}\n${bodyHash}`;
  const expected = await hmacSha256Hex(opts.secret, canonical);
  const provided = signature.startsWith(SIGNATURE_PREFIX)
    ? signature.slice(SIGNATURE_PREFIX.length)
    : signature;

  if (!timingSafeEqualHex(expected, provided)) {
    throw new WebhookVerificationError("Signature mismatch.");
  }
  return body;
}

/**
 * Verify a webhook and parse it into a typed, discriminated event.
 *
 *   const event = await payslice.webhooks.constructEvent({ payload, headers, secret });
 *   switch (event.type) {
 *     case "advance.released": event.data; // Advance
 *   }
 */
export async function constructEvent(
  opts: VerifyOptions,
): Promise<WebhookEvent> {
  const body = await verifySignature(opts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new WebhookVerificationError("Webhook body is not valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new WebhookVerificationError(
      "Webhook body is missing a string `type` field.",
    );
  }
  return parsed as WebhookEvent;
}
