import { signRequest } from "@payslice/sdk";

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

  const res = await fetch(`${cfg.baseUrl}${PATH}`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      "idempotency-key": args.advanceId,
    },
    body,
  });

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
