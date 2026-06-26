import { signRequest } from "@payslice/sdk";
import { NextResponse } from "next/server";
import { randomHex } from "./rand";

/** How long to wait on the rail before giving up (it's reached over an SSH tunnel). */
const RAIL_TIMEOUT_MS = 15_000;

/**
 * Server-only helper for the Payslice **Vault/Rail** custody service — the
 * non-custodial crypto payout rail (Safe + Allowance Module + AWS-KMS delegate
 * + powerless relayer). This is a DIFFERENT service from the EWA partner API
 * the rest of this demo uses, but it shares the exact same HMAC request signing,
 * so we reuse the SDK's `signRequest` primitive here.
 *
 * Like `lib/payslice.ts`, the secret only ever lives on the server: the crypto
 * page calls `app/api/crypto/*` route handlers, never the rail directly.
 *
 * The rail exposes only `POST /v1/payout-authorizations` (no GET status), so the
 * settlement result is read back off-chain in `app/api/crypto/settlement`.
 */

const PATH = "/v1/payout-authorizations";

export interface RailConfig {
  baseUrl: string; // host only, e.g. http://127.0.0.1:8090 (via SSH tunnel)
  keyId: string;
  secret: string;
  partnerId: string;
  sourceSystem: string;
  network: string; // destination.network — MUST match the rail's EVM_NETWORK_ID + treasury seed
  currency: string;
  token: string; // ERC-20 contract the rail settles in (for the settlement scan)
  decimals: number; // token decimals (6 for mock USDC/EURC)
  rpcUrl: string; // public Base Sepolia RPC for the settlement scan
  explorerBase: string; // e.g. https://sepolia.basescan.org
  safe?: string; // the treasury Safe (display only)
}

/** Live when the rail URL + HMAC creds + settlement token are all configured. */
export function isRailLive(): boolean {
  return Boolean(
    process.env.VAULT_RAIL_BASE_URL &&
      process.env.VAULT_RAIL_KEY_ID &&
      process.env.VAULT_RAIL_SECRET &&
      process.env.VAULT_RAIL_USD_TOKEN_CONTRACT,
  );
}

export function railConfig(): RailConfig {
  return {
    baseUrl: (process.env.VAULT_RAIL_BASE_URL ?? "http://127.0.0.1:8090").replace(/\/$/, ""),
    keyId: process.env.VAULT_RAIL_KEY_ID ?? "",
    secret: process.env.VAULT_RAIL_SECRET ?? "",
    partnerId: process.env.VAULT_RAIL_PARTNER_ID ?? "ptn_soak",
    sourceSystem: process.env.VAULT_RAIL_SOURCE_SYSTEM ?? "soak",
    network: process.env.VAULT_RAIL_NETWORK ?? "base-sepolia",
    currency: process.env.VAULT_RAIL_CURRENCY ?? "USD",
    token: process.env.VAULT_RAIL_USD_TOKEN_CONTRACT ?? "",
    decimals: Number(process.env.VAULT_RAIL_TOKEN_DECIMALS ?? "6"),
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? "https://base-sepolia-rpc.publicnode.com",
    explorerBase: (process.env.VAULT_RAIL_EXPLORER_BASE ?? "https://sepolia.basescan.org").replace(/\/$/, ""),
    safe: process.env.VAULT_RAIL_SAFE_ADDRESS,
  };
}

export interface PayoutAuthorizationResponse {
  reservation_ref: string;
  payout_ref: string;
  status: string;
}

/**
 * Create a payout authorization on the rail. Signs the EXACT body bytes that are
 * sent (the signature covers the sha256 of the body, so they must match), and
 * uses the advance id as the idempotency key — a retry with the same id replays
 * the first response instead of firing a second payout.
 */
export async function createPayoutAuthorization(args: {
  amountMinor: number;
  recipient: string;
  advanceId: string;
}): Promise<PayoutAuthorizationResponse> {
  const cfg = railConfig();
  const body = JSON.stringify({
    source_system: cfg.sourceSystem,
    partner_id: cfg.partnerId,
    advance_id: args.advanceId,
    amount_minor: args.amountMinor,
    currency: cfg.currency,
    destination: {
      type: "crypto_wallet",
      chain: "evm",
      network: cfg.network,
      address: args.recipient,
    },
  });

  const headers = await signRequest({
    keyId: cfg.keyId,
    secret: cfg.secret,
    timestamp: Math.floor(Date.now() / 1000),
    method: "POST",
    pathAndQuery: PATH,
    body,
  });

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${PATH}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": args.advanceId,
      },
      body,
      // Don't hang forever if the rail (via the SSH tunnel) accepts but never responds.
      signal: AbortSignal.timeout(RAIL_TIMEOUT_MS),
    });
  } catch (cause) {
    const reason =
      cause instanceof DOMException && cause.name === "TimeoutError"
        ? `rail did not respond within ${RAIL_TIMEOUT_MS / 1000}s (is the SSH tunnel up?)`
        : `could not reach the rail at ${cfg.baseUrl} (${(cause as Error).message})`;
    const err = new Error(reason) as Error & { status?: number };
    err.status = 504;
    throw err;
  }

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {
      /* keep raw text */
    }
    const err = new Error(message || `rail returned ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text) as PayoutAuthorizationResponse;
}

/** Map a thrown error to the demo's error JSON shape, preserving any `status`. */
export function railErrorResponse(err: unknown, code = "rail_error"): NextResponse {
  const status = (err as { status?: number }).status ?? 502;
  return NextResponse.json(
    { error: { code, message: (err as Error).message } },
    { status },
  );
}

/** Hard server-side cap on a single demo payout (minor units). Bounds the blast
 *  radius even if the route is reached directly. Override with VAULT_RAIL_MAX_AMOUNT_MINOR. */
function maxAmountMinor(): number {
  const v = Number(process.env.VAULT_RAIL_MAX_AMOUNT_MINOR ?? "100000"); // $1,000
  return Number.isFinite(v) && v > 0 ? v : 100_000;
}

/**
 * Validate a payout request body. Throws an Error with `status = 400` on bad input.
 * Returns a stable `idempotencyKey`: the caller's if provided (so a retry replays
 * instead of double-paying), otherwise a freshly generated one.
 */
export function validatePayoutInput(raw: unknown): {
  amountMinor: number;
  recipient: string;
  idempotencyKey: string;
} {
  const body = (raw ?? {}) as {
    amountMinor?: unknown;
    recipient?: unknown;
    idempotencyKey?: unknown;
  };
  const amountMinor = Number(body.amountMinor);
  const recipient = String(body.recipient ?? "");
  const fail = (message: string) => {
    const err = new Error(message) as Error & { status?: number };
    err.status = 400;
    return err;
  };
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw fail("amountMinor must be a positive integer (minor units / cents).");
  }
  if (amountMinor > maxAmountMinor()) {
    throw fail(`amountMinor exceeds the demo cap of ${maxAmountMinor()} minor units.`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw fail("recipient must be a 0x-prefixed 20-byte address.");
  }
  let idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (idempotencyKey) {
    if (!/^[A-Za-z0-9._-]{8,128}$/.test(idempotencyKey)) {
      throw fail("idempotencyKey must be 8-128 chars of [A-Za-z0-9._-].");
    }
  } else {
    idempotencyKey = `demo-${Date.now()}-${randomHex(6)}`;
  }
  return { amountMinor, recipient, idempotencyKey };
}

/**
 * Guard the LIVE money-moving route. The Vault/Rail rail is meant to be reached
 * over an SSH tunnel on the operator's own machine, so by default we only serve
 * the live payout endpoint to localhost — a public deployment with VAULT_RAIL_*
 * set would otherwise be an unauthenticated endpoint that signs real payouts.
 * Set VAULT_RAIL_ALLOW_REMOTE=1 ONLY if you've put your own auth in front of it.
 */
export function assertLiveAllowed(authHeader: string | null): void {
  const deny = (message: string) => {
    const err = new Error(message) as Error & { status?: number };
    err.status = 403;
    throw err;
  };
  // Real gate (recommended for any shared/public deploy): if a demo token is set,
  // require it as a bearer. NOTE: a browser page can't hold a server secret, so
  // setting this restricts the route to programmatic callers that have the token.
  const token = process.env.CRYPTO_DEMO_TOKEN;
  if (token) {
    if (authHeader === `Bearer ${token}`) return;
    deny("Live crypto payouts require a valid CRYPTO_DEMO_TOKEN bearer token.");
  }
  // No token: this route is unauthenticated, so it is DISABLED unless the operator
  // explicitly opts into remote/public exposure. `Host` is intentionally NOT trusted
  // (it is client-supplied and spoofable) — we fail closed instead.
  if (process.env.VAULT_RAIL_ALLOW_REMOTE === "1") return;
  deny(
    "Live crypto payouts are disabled. Set CRYPTO_DEMO_TOKEN (recommended) for a real gate, " +
      "or VAULT_RAIL_ALLOW_REMOTE=1 to run an intentionally-public, cap-bounded demo (incl. local dev).",
  );
}
